//! Puts the recommended build into the in-game shop as a League client item
//! set (`/lol-item-sets/v1/item-sets/{summonerId}/sets`). League Bro owns
//! one set, replaced on each lock-in (in Swiftplay, one per lobby slot); the
//! user's own sets are left alone.

use crate::util::{list, text};
use crate::lcu::Lcu;
use crate::opgg::{ItemSet, Recommendation};
use anyhow::{Context, Result};
use serde::Serialize;
use serde_json::{json, Value};
use std::path::{Path, PathBuf};

const TITLE_PREFIX: &str = "League Bro:";

fn block(label: &str, set: &ItemSet) -> Option<Value> {
    let mut items: Vec<(i64, u32)> = Vec::new();
    for &id in set.ids.iter().filter(|id| **id > 0) {
        match items.iter_mut().find(|(i, _)| *i == id) {
            Some((_, count)) => *count += 1,
            None => items.push((id, 1)),
        }
    }
    if items.is_empty() {
        return None;
    }
    // Plain ASCII: these headers are drawn by the in-game shop's font.
    let header = if set.games > 0 { format!("{label} - {:.0}% WR", set.win_rate * 100.0) } else { label.to_string() };
    Some(json!({
        "type": header,
        "hideIfSummonerSpell": "",
        "showIfSummonerSpell": "",
        "items": items.iter().map(|(id, count)| json!({ "id": id.to_string(), "count": count })).collect::<Vec<_>>(),
    }))
}

/// Builds the item set for a recommendation, or None if it has no items.
pub fn build_set(rec: &Recommendation, champion_name: &str, role_label: &str, map_id: i64, uid: &str) -> Option<Value> {
    // The full purchase order (what the overlay reminds you of), right after the starter.
    let order = (!rec.build_order.is_empty()).then(|| ItemSet { ids: rec.build_order.clone(), ..Default::default() });
    let mut blocks: Vec<Value> = [("Starter", rec.starter.as_ref()), ("Build order (left to right)", order.as_ref())]
        .into_iter()
        .filter_map(|(label, set)| set.and_then(|s| block(label, s)))
        .collect();
    // Every core build and pair of boots the rec card offers, the picked one first.
    let others = |picked: Option<&ItemSet>, options: &[ItemSet]| -> Vec<ItemSet> {
        options.iter().filter(|o| picked.is_none_or(|p| p.ids != o.ids)).cloned().collect()
    };
    blocks.extend(rec.core.as_ref().and_then(|c| block("Core build", c)));
    for (i, core) in others(rec.core.as_ref(), &rec.core_options).iter().enumerate() {
        blocks.extend(block(&format!("Core option {}", i + 2), core));
    }
    let mut boots = rec.boots.clone().unwrap_or_default();
    let picked = boots.ids.len();
    for b in others(rec.boots.as_ref(), &rec.boots_options) {
        for id in b.ids {
            if !boots.ids.contains(&id) {
                boots.ids.push(id);
            }
        }
    }
    if boots.ids.len() > picked {
        // One win rate in the header would only describe the first pair.
        boots.games = 0;
    }
    blocks.extend(block("Boots", &boots));
    for (i, options) in rec.later.iter().enumerate() {
        let mut merged = ItemSet::default();
        for opt in options {
            for id in &opt.ids {
                if !merged.ids.contains(id) {
                    merged.ids.push(*id);
                }
            }
        }
        if let Some(b) = block(&format!("{} item options", ["4th", "5th", "6th"].get(i).unwrap_or(&"Later")), &merged) {
            blocks.push(b);
        }
    }
    if blocks.is_empty() {
        return None;
    }
    let map = match map_id {
        11 => "SR",
        12 => "HA",
        _ => "any",
    };
    Some(json!({
        "uid": uid,
        "title": format!("{TITLE_PREFIX} {champion_name} {role_label}").trim_end(),
        "mode": "any",
        "map": map,
        "type": "custom",
        "sortrank": 0,
        "startedFrom": "blank",
        "associatedChampions": [rec.champion_id],
        "associatedMaps": [map_id],
        "blocks": blocks,
        "preferredItemSlots": [],
    }))
}

/// Replaces League Bro's sets in the client's item-set list, keeping every other set.
pub fn merge(mut existing: Value, ours: Vec<Value>, now_ms: u64) -> Value {
    let mut sets: Vec<Value> =
        list(&existing, "itemSets").iter().filter(|s| !text(s, "title").starts_with(TITLE_PREFIX)).cloned().collect();
    sets.splice(0..0, ours);
    if !existing.is_object() {
        existing = json!({ "accountId": 0 });
    }
    existing["itemSets"] = Value::Array(sets);
    existing["timestamp"] = json!(now_ms);
    existing
}

fn uid(now_ms: u64, n: usize) -> String {
    // The client only needs a unique id; shaped like a UUID to match its own.
    format!("1eadb0d1-0000-4000-{:04x}-{:012x}", 0x8000 + n, now_ms & 0xffff_ffff_ffff)
}

/// Writes the set to the client. Returns the set's title.
pub async fn apply(lcu: &Lcu, rec: &Recommendation, champion_name: &str, role_label: &str, map_id: i64) -> Result<Option<String>> {
    Ok(apply_many(lcu, &[(rec, champion_name, role_label)], map_id).await?.into_iter().next())
}

/// Writes one set per (recommendation, champion name, role label), replacing
/// League Bro's earlier sets. Returns the titles written.
///
/// Sets go into the game's folder as global files (see `write_own_global`), which
/// the shop lists first and opens on, like Blitz's. If League's folder can't be
/// found, they go into the client's item-set list instead, where the shop lists
/// them after any of the player's own sets that apply to every champion.
pub async fn apply_many(lcu: &Lcu, recs: &[(&Recommendation, &str, &str)], map_id: i64) -> Result<Vec<String>> {
    let now_ms = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0);
    let sets: Vec<Value> = recs
        .iter()
        .enumerate()
        .filter_map(|(n, (rec, name, role))| build_set(rec, name, role, map_id, &uid(now_ms, n)))
        .collect();
    if sets.is_empty() {
        return Ok(Vec::new());
    }
    let titles = sets.iter().map(|s| s["title"].as_str().unwrap_or("").to_string()).collect();
    let me = lcu.summoner_ids().await?;
    let summoner_id = me.get("summonerId").and_then(Value::as_i64).context("no summonerId")?;
    let path = format!("/lol-item-sets/v1/item-sets/{summoner_id}/sets");
    let existing = lcu.get(&path).await?.unwrap_or(Value::Null);
    match install_dir(lcu, None).await {
        Some(dir) => {
            write_own_global(&dir, &sets)?;
            // Drop any League Bro set from the client's list so the shop doesn't show it twice.
            if list(&existing, "itemSets").iter().any(|s| text(s, "title").starts_with(TITLE_PREFIX)) {
                lcu.put(&path, &merge(existing, Vec::new(), now_ms)).await?;
            }
        }
        None => {
            lcu.put(&path, &merge(existing, sets, now_ms)).await?;
        }
    }
    Ok(titles)
}

/// League's install folder: as the client reports it, else `configured` (Settings).
pub async fn install_dir(lcu: &Lcu, configured: Option<&str>) -> Option<PathBuf> {
    if let Ok(Some(Value::String(dir))) = lcu.get("/data-store/v1/install-dir").await {
        if !dir.trim().is_empty() {
            return Some(dir.into());
        }
    }
    configured.filter(|d| !d.trim().is_empty()).map(Into::into)
}

// ---------- League Bro's own global files ----------
//
// "!!!!" sorts first among the game's global sets, the trick Blitz uses
// (`!!!blitz-<n>.json`) plus one, so the shop lists League Bro's build first and opens on
// it. Global files show for every champion and outlive the app, so they're
// removed when champ select starts (lock-in writes the new one), when League Bro
// quits, and when it connects outside a game (after a crash). Not at game end:
// Swiftplay writes them in the lobby and only rewrites when a pick changes, so
// they must survive into the next game. Each file also names its champion
// (`associatedChampions`), in case the game honors that for global files.

/// Four "!" so it sorts ahead of Blitz's "!!!blitz-" too.
const OWN_FILE_PREFIX: &str = "!!!!league-bro-";

/// The install folder League Bro last wrote global files to, for cleanup on quit.
static WRITTEN_TO: std::sync::Mutex<Option<PathBuf>> = std::sync::Mutex::new(None);

/// Replaces League Bro's global files with one file per set.
pub fn write_own_global(install: &Path, sets: &[Value]) -> Result<()> {
    let dir = global_dir(install);
    std::fs::create_dir_all(&dir).with_context(|| format!("couldn't create {}", dir.display()))?;
    remove_own_global(install)?;
    for (n, set) in sets.iter().enumerate() {
        let path = dir.join(format!("{OWN_FILE_PREFIX}{}.json", n + 1));
        std::fs::write(&path, serde_json::to_string_pretty(set)?).with_context(|| format!("couldn't write {}", path.display()))?;
    }
    *WRITTEN_TO.lock().unwrap() = Some(install.to_path_buf());
    Ok(())
}

/// Removes the files from the folder League Bro wrote to this session (on quit).
pub fn remove_written_global() {
    if let Some(dir) = WRITTEN_TO.lock().unwrap().take() {
        let _ = remove_own_global(&dir);
    }
}

fn is_own_file(name: &str) -> bool {
    name.starts_with(OWN_FILE_PREFIX) && name.to_ascii_lowercase().ends_with(".json")
}

/// Deletes League Bro's global files. Returns how many there were.
pub fn remove_own_global(install: &Path) -> Result<usize> {
    let Ok(entries) = std::fs::read_dir(global_dir(install)) else { return Ok(0) };
    let mut removed = 0;
    for path in entries.filter_map(|e| e.ok().map(|e| e.path())) {
        if path.file_name().and_then(|n| n.to_str()).is_some_and(is_own_file) {
            std::fs::remove_file(&path).with_context(|| format!("couldn't remove {}", path.display()))?;
            removed += 1;
        }
    }
    Ok(removed)
}

// ---------- other apps' global item sets ----------
//
// The game reads item sets from files under `<install>\Config`. The client writes
// its own list there as `RIOT_ItemSet_<n>.json`; some apps (Blitz, checked October
// 2026) also drop files straight into `Config\Global\Recommended`. Those show for
// every champion, stay after the app is closed, and are listed before
// champion-specific sets, which pushes League Bro's set out of the shop's dropdown.

/// Next to `Recommended`, so the game doesn't read it.
const MOVED_DIR: &str = "Recommended-moved-by-league-bro";

#[derive(Debug, Clone, Serialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct GlobalSets {
    /// Titles of other apps' sets currently shown for every champion.
    pub found: Vec<String>,
    /// Titles of sets League Bro moved aside earlier.
    pub moved: Vec<String>,
}

fn global_dir(install: &Path) -> PathBuf {
    install.join("Config").join("Global").join("Recommended")
}

fn moved_dir(install: &Path) -> PathBuf {
    install.join("Config").join("Global").join(MOVED_DIR)
}

/// JSON files not written by the League client itself.
fn foreign_files(dir: &Path) -> Vec<PathBuf> {
    let Ok(entries) = std::fs::read_dir(dir) else { return Vec::new() };
    let mut files: Vec<PathBuf> = entries
        .filter_map(|e| e.ok().map(|e| e.path()))
        .filter(|p| p.is_file())
        .filter(|p| {
            let name = p.file_name().and_then(|n| n.to_str()).unwrap_or("");
            name.to_ascii_lowercase().ends_with(".json") && !name.starts_with("RIOT_ItemSet_") && !is_own_file(name)
        })
        .collect();
    files.sort();
    files
}

fn title_of(path: &Path) -> String {
    std::fs::read_to_string(path)
        .ok()
        .and_then(|t| serde_json::from_str::<Value>(&t).ok())
        .and_then(|v| v.get("title").and_then(Value::as_str).map(str::to_string))
        .filter(|t| !t.is_empty())
        .unwrap_or_else(|| path.file_stem().and_then(|s| s.to_str()).unwrap_or("").to_string())
}

pub fn scan_global(install: &Path) -> GlobalSets {
    GlobalSets {
        found: foreign_files(&global_dir(install)).iter().map(|p| title_of(p)).collect(),
        moved: foreign_files(&moved_dir(install)).iter().map(|p| title_of(p)).collect(),
    }
}

/// `dir\name`, or `dir\stem-2.ext` etc. if that's taken. Never overwrites.
fn free_path(dir: &Path, name: &str) -> PathBuf {
    let first = dir.join(name);
    if !first.exists() {
        return first;
    }
    let (stem, ext) = name.rsplit_once('.').unwrap_or((name, ""));
    (2..).map(|n| dir.join(format!("{stem}-{n}.{ext}"))).find(|p| !p.exists()).unwrap()
}

/// Moves other apps' global sets next to `Recommended`. Returns how many moved.
pub fn move_global_aside(install: &Path) -> Result<usize> {
    let files = foreign_files(&global_dir(install));
    if files.is_empty() {
        return Ok(0);
    }
    let to = moved_dir(install);
    std::fs::create_dir_all(&to).with_context(|| format!("couldn't create {}", to.display()))?;
    for f in &files {
        let name = f.file_name().and_then(|n| n.to_str()).unwrap_or("set.json");
        std::fs::rename(f, free_path(&to, name)).with_context(|| format!("couldn't move {}", f.display()))?;
    }
    Ok(files.len())
}

/// Puts moved sets back. Skips any whose name is in use again (the app rewrote
/// it), leaving that copy in the moved folder. Returns how many went back.
pub fn restore_global(install: &Path) -> Result<usize> {
    let to = global_dir(install);
    let mut restored = 0;
    for f in foreign_files(&moved_dir(install)) {
        let target = to.join(f.file_name().unwrap());
        if target.exists() {
            continue;
        }
        std::fs::create_dir_all(&to).with_context(|| format!("couldn't create {}", to.display()))?;
        std::fs::rename(&f, &target).with_context(|| format!("couldn't move {} back", f.display()))?;
        restored += 1;
    }
    Ok(restored)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn set(ids: &[i64], games: i64, win_rate: f64) -> ItemSet {
        ItemSet { ids: ids.to_vec(), games, win_rate, ..Default::default() }
    }

    fn rec() -> Recommendation {
        Recommendation {
            champion_id: 103,
            starter: Some(set(&[1056, 2003, 2003], 7944, 0.514)),
            boots: Some(set(&[3020], 4455, 0.51)),
            core: Some(set(&[3118, 4645, 3157], 619, 0.53)),
            later: vec![vec![set(&[3089], 10, 0.5), set(&[3135], 8, 0.5)], vec![set(&[3135], 5, 0.5)]],
            build_order: vec![3118, 3020, 4645, 3157, 3089],
            ..Default::default()
        }
    }

    #[test]
    fn blocks_in_shop_order() {
        let s = build_set(&rec(), "Ahri", "Mid", 11, "u").unwrap();
        assert_eq!(s["title"], "League Bro: Ahri Mid");
        assert_eq!(s["map"], "SR");
        assert_eq!(s["associatedChampions"], json!([103]));
        let blocks = s["blocks"].as_array().unwrap();
        let headers: Vec<&str> = blocks.iter().map(|b| b["type"].as_str().unwrap()).collect();
        // Merged options have no single win rate.
        assert_eq!(
            headers,
            ["Starter - 51% WR", "Build order (left to right)", "Core build - 53% WR", "Boots - 51% WR", "4th item options", "5th item options"]
        );
        assert_eq!(blocks[0]["items"], json!([{ "id": "1056", "count": 1 }, { "id": "2003", "count": 2 }]));
        let order: Vec<&str> = blocks[1]["items"].as_array().unwrap().iter().map(|i| i["id"].as_str().unwrap()).collect();
        assert_eq!(order, ["3118", "3020", "4645", "3157", "3089"]);
        assert_eq!(blocks[4]["items"], json!([{ "id": "3089", "count": 1 }, { "id": "3135", "count": 1 }]));
    }

    #[test]
    fn every_core_and_boots_option() {
        // The player picked the second core build on the rec card.
        let mut r = rec();
        let top = set(&[3118, 4645, 3157], 619, 0.53);
        let picked = set(&[3118, 4645, 3089], 300, 0.55);
        r.core_options = vec![top, picked.clone(), set(&[6655, 4645, 3157], 120, 0.5)];
        r.core = Some(picked);
        r.boots_options = vec![set(&[3020], 4455, 0.51), set(&[3158], 900, 0.52)];
        let s = build_set(&r, "Ahri", "Mid", 11, "u").unwrap();
        let blocks = s["blocks"].as_array().unwrap();
        let ids = |b: &Value| -> Vec<String> { b["items"].as_array().unwrap().iter().map(|i| i["id"].as_str().unwrap().to_string()).collect() };
        let headers: Vec<&str> = blocks.iter().map(|b| b["type"].as_str().unwrap()).collect();
        assert_eq!(&headers[2..6], ["Core build - 55% WR", "Core option 2 - 53% WR", "Core option 3 - 50% WR", "Boots"]);
        assert_eq!(ids(&blocks[2]), ["3118", "4645", "3089"]);
        assert_eq!(ids(&blocks[3]), ["3118", "4645", "3157"]);
        assert_eq!(ids(&blocks[5]), ["3020", "3158"]);
    }

    #[test]
    fn no_items_no_set() {
        assert_eq!(build_set(&Recommendation::default(), "Ahri", "", 12, "u"), None);
    }

    #[test]
    fn merge_keeps_your_sets_and_replaces_ours() {
        let existing = json!({ "accountId": 7, "timestamp": 1, "itemSets": [
            { "title": "My Ahri set" },
            { "title": "League Bro: Zed Mid" },
        ]});
        let out = merge(existing, vec![json!({ "title": "League Bro: Ahri Mid" })], 99);
        let titles: Vec<&str> = out["itemSets"].as_array().unwrap().iter().map(|s| s["title"].as_str().unwrap()).collect();
        assert_eq!(titles, ["League Bro: Ahri Mid", "My Ahri set"]);
        assert_eq!((out["accountId"].as_i64(), out["timestamp"].as_u64()), (Some(7), Some(99)));
    }

    #[test]
    fn merge_into_empty_client() {
        let out = merge(json!({ "accountId": 0, "itemSets": [], "timestamp": 0 }), vec![json!({ "title": "League Bro: Ahri" })], 5);
        assert_eq!(out["itemSets"].as_array().unwrap().len(), 1);
    }

    /// A fake install folder with the files found on Dom's PC (October 2026).
    fn fake_install(tag: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!("lb-globalsets-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let g = global_dir(&root);
        std::fs::create_dir_all(&g).unwrap();
        std::fs::write(g.join("!!!blitz-0.json"), r#"{"title":"Blitz: Bruiser Sylas","champion":"","map":"any","blocks":[]}"#).unwrap();
        std::fs::write(g.join("!!!blitz-1.json"), r#"{"title":"Blitz: AP Sylas","blocks":[]}"#).unwrap();
        std::fs::write(g.join("RIOT_ItemSet_8.json"), r#"{"title":"New Item Set","map":"SR","blocks":[]}"#).unwrap();
        std::fs::write(g.join("notes.txt"), "not an item set").unwrap();
        root
    }

    #[test]
    fn finds_only_other_apps_sets() {
        let root = fake_install("scan");
        let s = scan_global(&root);
        assert_eq!(s.found, ["Blitz: Bruiser Sylas", "Blitz: AP Sylas"]);
        assert!(s.moved.is_empty());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn move_aside_and_back() {
        let root = fake_install("move");
        assert_eq!(move_global_aside(&root).unwrap(), 2);
        let s = scan_global(&root);
        assert!(s.found.is_empty());
        assert_eq!(s.moved, ["Blitz: Bruiser Sylas", "Blitz: AP Sylas"]);
        // The client's own export and other files stay put.
        assert!(global_dir(&root).join("RIOT_ItemSet_8.json").exists());
        assert!(global_dir(&root).join("notes.txt").exists());
        assert_eq!(move_global_aside(&root).unwrap(), 0);

        // Blitz writes one of them again before the user restores.
        std::fs::write(global_dir(&root).join("!!!blitz-0.json"), r#"{"title":"Blitz: Bruiser Sylas (new)"}"#).unwrap();
        assert_eq!(restore_global(&root).unwrap(), 1);
        let s = scan_global(&root);
        assert_eq!(s.found, ["Blitz: Bruiser Sylas (new)", "Blitz: AP Sylas"]);
        assert_eq!(s.moved, ["Blitz: Bruiser Sylas"]);

        // Moving again doesn't overwrite the copy already in the moved folder.
        assert_eq!(move_global_aside(&root).unwrap(), 2);
        assert_eq!(scan_global(&root).moved.len(), 3);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn own_global_files() {
        let root = fake_install("own");
        let g = global_dir(&root);
        let ahri = build_set(&rec(), "Ahri", "Mid", 11, "u").unwrap();
        write_own_global(&root, &[ahri.clone(), ahri]).unwrap();
        let mut names: Vec<String> = std::fs::read_dir(&g).unwrap().map(|e| e.unwrap().file_name().into_string().unwrap()).collect();
        names.sort();
        // "!!!!league-bro" sorts ahead of Blitz's files and the client's RIOT_ItemSet_*.
        assert_eq!(names, ["!!!!league-bro-1.json", "!!!!league-bro-2.json", "!!!blitz-0.json", "!!!blitz-1.json", "RIOT_ItemSet_8.json", "notes.txt"]);
        let file: Value = serde_json::from_str(&std::fs::read_to_string(g.join("!!!!league-bro-1.json")).unwrap()).unwrap();
        assert_eq!((file["title"].as_str(), file["associatedChampions"].clone()), (Some("League Bro: Ahri Mid"), json!([103])));

        // Not counted as another app's set.
        assert_eq!(scan_global(&root).found, ["Blitz: Bruiser Sylas", "Blitz: AP Sylas"]);

        // A new write replaces both files; removing leaves everyone else's.
        write_own_global(&root, &[build_set(&rec(), "Zed", "Mid", 11, "u").unwrap()]).unwrap();
        assert!(g.join("!!!!league-bro-1.json").exists() && !g.join("!!!!league-bro-2.json").exists());
        assert_eq!(remove_own_global(&root).unwrap(), 1);
        assert_eq!(remove_own_global(&root).unwrap(), 0);
        assert!(g.join("!!!blitz-0.json").exists() && g.join("RIOT_ItemSet_8.json").exists());
        let _ = std::fs::remove_dir_all(&root);
    }
}
