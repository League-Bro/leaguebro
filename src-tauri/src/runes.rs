//! Rune page import.
//!
//! The page comes from OP.GG's most popular page (when there's enough data),
//! or else the League client's built-in recommended pages (the ones in the
//! client's rune editor). League Bro keeps a single page named
//! "League Bro: ..." and overwrites it each time.

use crate::util::{flag, text};
use crate::config::Config;
use crate::lcu::Lcu;
use crate::opgg::{RuneRec, MIN_GAMES};
use anyhow::{anyhow, Result};
use serde_json::{json, Value};

#[derive(Debug, Clone, PartialEq)]
pub struct RunePage {
    pub name: String,
    pub primary_style_id: i64,
    pub sub_style_id: i64,
    pub selected_perk_ids: Vec<i64>,
}

pub const PAGE_PREFIX: &str = "League Bro";
/// Pages made by earlier versions (when the app was called Riftlight) are
/// cleaned up too.
const OLD_PREFIXES: &[&str] = &["Riftlight"];
/// Keep page names short enough for the client's rune page name field.
const MAX_NAME_CHARS: usize = 25;

pub fn page_name(champion_name: &str, label: &str) -> String {
    let full = format!("{PAGE_PREFIX}: {champion_name} {label}").trim_end().to_string();
    if full.chars().count() <= MAX_NAME_CHARS {
        return full;
    }
    let short = format!("{PAGE_PREFIX}: {champion_name}");
    if short.chars().count() <= MAX_NAME_CHARS {
        return short;
    }
    format!("LB: {champion_name} {label}").trim_end().chars().take(MAX_NAME_CHARS).collect()
}

fn is_ours(name: &str) -> bool {
    // Match "<prefix>:" so a page of the user's like "League Brownie" is left alone.
    let has_prefix = |p: &str| name.strip_prefix(p).is_some_and(|rest| rest.starts_with(':'));
    has_prefix(PAGE_PREFIX) || has_prefix("LB") || OLD_PREFIXES.iter().any(|p| has_prefix(p))
}

/// Turns champ select / live client position names into what the perks
/// endpoint expects.
pub fn normalize_position(pos: &str) -> String {
    match pos.to_ascii_lowercase().as_str() {
        "top" => "top",
        "jungle" => "jungle",
        "middle" | "mid" => "middle",
        "bottom" | "bot" | "adc" => "bottom",
        "utility" | "support" | "sup" => "utility",
        _ => "",
    }
    .to_string()
}

pub fn position_label(pos: &str) -> &'static str {
    match normalize_position(pos).as_str() {
        "top" => "Top",
        "jungle" => "Jungle",
        "middle" => "Mid",
        "bottom" => "Bot",
        "utility" => "Support",
        _ => "",
    }
}

/// Picks the best page from the client's recommended-pages response.
pub fn pick_recommended(pages: &Value, wanted_pos: &str) -> Option<RunePage> {
    let arr = pages.as_array()?;
    let parse = |p: &Value| -> Option<RunePage> {
        let perks: Vec<i64> = p
            .get("perks")?
            .as_array()?
            .iter()
            .filter_map(|x| x.get("id").and_then(Value::as_i64))
            .collect();
        let primary = p.get("primaryPerkStyleId")?.as_i64()?;
        let sub = p.get("secondaryPerkStyleId")?.as_i64()?;
        if perks.len() < 6 || primary == 0 || sub == 0 {
            return None;
        }
        Some(RunePage { name: String::new(), primary_style_id: primary, sub_style_id: sub, selected_perk_ids: perks })
    };
    let wanted = normalize_position(wanted_pos);
    let pos_of = |p: &Value| normalize_position(text(p, "position"));
    // 1. exact position match, 2. the champion's default position, 3. anything valid.
    arr.iter()
        .filter(|p| !wanted.is_empty() && pos_of(p) == wanted)
        .find_map(parse)
        .or_else(|| {
            arr.iter()
                .filter(|p| flag(p, "isDefaultPosition"))
                .find_map(parse)
        })
        .or_else(|| arr.iter().find_map(parse))
}

async fn recommended_page(lcu: &Lcu, champion_id: i64, position: &str, map_id: i64) -> Result<RunePage> {
    let pos = normalize_position(position);
    // The endpoint wants a position segment; for ARAM / blind pick there is
    // none, so ask for the champion's usual positions and let pick_recommended
    // fall back to the default one.
    let mut tries: Vec<String> = Vec::new();
    if !pos.is_empty() {
        tries.push(pos.clone());
    }
    for p in ["none", "middle", "top", "jungle", "bottom", "utility"] {
        if !tries.iter().any(|t| t == p) {
            tries.push(p.to_string());
        }
    }
    for p in &tries {
        let path = format!("/lol-perks/v1/recommended-pages/champion/{champion_id}/position/{p}/map/{map_id}");
        if let Ok(Some(v)) = lcu.get(&path).await {
            if let Some(page) = pick_recommended(&v, &pos) {
                return Ok(page);
            }
        }
    }
    Err(anyhow!("the client has no recommended rune page for this champion"))
}

pub struct ImportResult {
    pub page_name: String,
    pub source: &'static str,
    /// The name of the page taken over because every slot was used.
    pub replaced: Option<String>,
}

/// The player's own page from the rune editor, else OP.GG's page (with
/// enough games), else the client's recommended page.
pub async fn choose_page(
    lcu: &Lcu,
    champion_id: i64,
    position: &str,
    map_id: i64,
    rec: Option<&RuneRec>,
) -> Result<(RunePage, &'static str)> {
    let from_rec = rec.filter(|r| r.custom || r.games >= MIN_GAMES).map(|r| RunePage {
        name: String::new(),
        primary_style_id: r.primary_style_id,
        sub_style_id: r.sub_style_id,
        selected_perk_ids: r.perk_ids.clone(),
    });
    Ok(match from_rec {
        Some(p) if rec.is_some_and(|r| r.custom) => (p, "your runes"),
        Some(p) => (p, "OP.GG"),
        None => (recommended_page(lcu, champion_id, position, map_id).await?, "client recommendation"),
    })
}

/// A Swiftplay lobby slot's `perks` value: JSON inside a string, e.g.
/// `{"perkIds":[...],"perkStyle":8100,"perkSubStyle":8200}` (checked against
/// the client in October 2026).
pub fn slot_perks(page: &RunePage) -> String {
    json!({
        "perkIds": page.selected_perk_ids,
        "perkStyle": page.primary_style_id,
        "perkSubStyle": page.sub_style_id,
    })
    .to_string()
}

/// The page the Swiftplay lobby's rune menu shows for this champion's slot:
/// the one whose `quickPlayChampionIds` has it. Usually the slot's temporary
/// page; a page the player picked in the menu gets linked instead. The links
/// can be missing (seen with the champion picker closed, October 2026).
pub fn linked_page(pages: &Value, champion_id: i64) -> Option<&Value> {
    pages.as_array()?.iter().find(|p| {
        p.get("quickPlayChampionIds")
            .and_then(Value::as_array)
            .is_some_and(|ids| ids.iter().any(|id| id.as_i64() == Some(champion_id)))
    })
}

/// The linked page with `page`'s runes, everything else kept as the client has it.
pub fn quick_play_body(existing: &Value, page: &RunePage) -> Value {
    let mut body = existing.clone();
    body["name"] = json!(page.name);
    body["primaryStyleId"] = json!(page.primary_style_id);
    body["subStyleId"] = json!(page.sub_style_id);
    body["selectedPerkIds"] = json!(page.selected_perk_ids);
    body
}

/// Puts `page`'s runes on the page linked to this champion's Swiftplay slot,
/// if it's a temporary page or League Bro's own; the player's own pages are
/// left alone. Returns whether a page was written.
pub async fn set_linked_page(lcu: &Lcu, champion_id: i64, page: &RunePage) -> Result<bool> {
    let pages = lcu.get_req("/lol-perks/v1/pages").await?;
    let Some(existing) = linked_page(&pages, champion_id) else { return Ok(false) };
    if !(is_temporary(existing) || is_ours(text(existing, "name"))) || !allows(existing, "isEditable") {
        return Ok(false);
    }
    let id = page_id(existing).ok_or_else(|| anyhow!("rune page without an id"))?;
    lcu.put(&format!("/lol-perks/v1/pages/{id}"), &quick_play_body(existing, page)).await?;
    Ok(true)
}

/// Deletes leftover temporary pages that older versions renamed "League Bro:
/// ..." (the client keeps them around, deletable and linked to no slot).
pub async fn drop_stale_temporary(lcu: &Lcu) {
    let Ok(pages) = lcu.get_req("/lol-perks/v1/pages").await else { return };
    for p in pages.as_array().into_iter().flatten().filter(|p| stale_temporary(p)) {
        if let Some(id) = page_id(p) {
            let _ = lcu.delete(&format!("/lol-perks/v1/pages/{id}")).await;
        }
    }
}

fn stale_temporary(p: &Value) -> bool {
    let linked = p.get("quickPlayChampionIds").and_then(Value::as_array).is_some_and(|ids| !ids.is_empty());
    is_temporary(p) && flag(p, "isDeletable") && !linked && is_ours(text(p, "name"))
}

/// Creates (or replaces) the League Bro rune page and makes it current.
pub async fn import(
    lcu: &Lcu,
    config: &Config,
    champion_id: i64,
    champion_name: &str,
    position: &str,
    map_id: i64,
    rec: Option<&RuneRec>,
) -> Result<ImportResult> {
    let (mut page, source) = choose_page(lcu, champion_id, position, map_id, rec).await?;
    page.name = page_name(champion_name, position_label(position));
    let replaced = write_page(lcu, config, &page).await?;
    Ok(ImportResult { page_name: page.name, source, replaced })
}

/// Swiftplay's temporary pages (`isTemporary`, one per lobby slot). Older
/// versions renamed them to "League Bro: ...", but the client refuses to
/// delete them (403 "Page is not deletable") and remakes them, so they don't
/// count as League Bro's page.
fn is_temporary(p: &Value) -> bool {
    flag(p, "isTemporary")
}

/// A missing field counts as allowed: custom pages always have both.
fn allows(p: &Value, key: &str) -> bool {
    p.get(key).and_then(Value::as_bool).unwrap_or(true)
}

fn page_id(p: &Value) -> Option<i64> {
    p.get("id").and_then(Value::as_i64)
}

/// League Bro's own pages: the first one to overwrite in place, and any
/// others (older versions made one per champion) to delete.
fn own_pages(pages: &[Value]) -> (Option<i64>, Vec<i64>) {
    let mut ids = pages
        .iter()
        .filter(|p| is_ours(text(p, "name")) && !is_temporary(p) && allows(p, "isEditable"))
        .filter_map(page_id);
    let keep = ids.next();
    let extra = ids
        .filter(|id| pages.iter().any(|p| page_id(p) == Some(*id) && allows(p, "isDeletable")))
        .collect();
    (keep, extra)
}

/// The page to take over when every slot is used and League Bro has none:
/// the selected page if it's editable, else the one edited longest ago.
fn page_to_take_over(pages: &[Value]) -> Option<(i64, String)> {
    let editable = || pages.iter().filter(|p| flag(p, "isEditable") && !is_temporary(p));
    editable()
        .find(|p| flag(p, "current"))
        .or_else(|| editable().min_by_key(|p| p.get("lastModified").and_then(Value::as_i64).unwrap_or(0)))
        .and_then(|p| Some((page_id(p)?, text(p, "name").to_string())))
}

fn is_full_error(e: &anyhow::Error) -> bool {
    format!("{e:#}").to_ascii_lowercase().contains("max pages")
}

async fn overwrite(lcu: &Lcu, id: i64, body: &Value) -> Result<()> {
    let mut body = body.clone();
    body["id"] = json!(id);
    lcu.put(&format!("/lol-perks/v1/pages/{id}"), &body).await?;
    let _ = lcu.put("/lol-perks/v1/currentpage", &json!(id)).await;
    Ok(())
}

/// Writes `page` as the League Bro rune page and makes it current. League
/// Bro's existing page is overwritten in place, so it needs no free slot.
/// Without one, a new page is created; if every slot is used, the selected
/// page is taken over (unless `keep_my_pages_when_full`) and its old name is
/// returned. From then on it's League Bro's page and gets reused.
pub async fn write_page(lcu: &Lcu, config: &Config, page: &RunePage) -> Result<Option<String>> {
    let body = json!({
        "name": page.name,
        "primaryStyleId": page.primary_style_id,
        "subStyleId": page.sub_style_id,
        "selectedPerkIds": page.selected_perk_ids,
        "current": true,
    });

    let pages = lcu.get_req("/lol-perks/v1/pages").await?;
    let pages = pages.as_array().cloned().unwrap_or_default();
    let (own, extra) = own_pages(&pages);

    // Extra League Bro pages from older versions. A failed delete isn't fatal.
    for id in extra {
        if let Err(e) = lcu.delete(&format!("/lol-perks/v1/pages/{id}")).await {
            eprintln!("couldn't delete old rune page {id}: {e:#}");
        }
    }

    if let Some(id) = own {
        match overwrite(lcu, id, &body).await {
            Ok(()) => return Ok(None),
            // E.g. the page was deleted in the client meanwhile: make a new one.
            Err(e) => eprintln!("couldn't update rune page {id}, creating a new one: {e:#}"),
        }
    }

    match lcu.post("/lol-perks/v1/pages", &body).await {
        Ok(created) => {
            if let Some(id) = page_id(&created) {
                let _ = lcu.put("/lol-perks/v1/currentpage", &json!(id)).await;
            }
            Ok(None)
        }
        Err(e) if is_full_error(&e) && !config.keep_my_pages_when_full => {
            let Some((id, old_name)) = page_to_take_over(&pages) else {
                return Err(e.context("all your rune page slots are full and none of them is editable"));
            };
            overwrite(lcu, id, &body).await?;
            Ok(Some(old_name))
        }
        Err(e) if is_full_error(&e) => Err(e.context(
            "all your rune page slots are full; delete one, or turn off \"Keep my pages when slots are full\"",
        )),
        Err(e) => Err(e.context("couldn't create a rune page")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn page(pos: &str, default: bool, primary: i64) -> Value {
        json!({
            "position": pos, "isDefaultPosition": default,
            "primaryPerkStyleId": primary, "secondaryPerkStyleId": 8300,
            "perks": (0..9).map(|i| json!({"id": 8000 + i})).collect::<Vec<_>>()
        })
    }

    #[test]
    fn picks_matching_position_then_default() {
        let pages = json!([page("MIDDLE", true, 8100), page("TOP", false, 8000)]);
        assert_eq!(pick_recommended(&pages, "top").unwrap().primary_style_id, 8000);
        assert_eq!(pick_recommended(&pages, "jungle").unwrap().primary_style_id, 8100);
        assert_eq!(pick_recommended(&pages, "").unwrap().primary_style_id, 8100);
    }

    #[test]
    fn skips_incomplete_pages() {
        let bad = json!({"position": "top", "primaryPerkStyleId": 8000, "secondaryPerkStyleId": 8100, "perks": []});
        let pages = json!([bad, page("bottom", false, 8200)]);
        assert_eq!(pick_recommended(&pages, "top").unwrap().primary_style_id, 8200);
    }

    #[test]
    fn page_names_fit() {
        assert_eq!(page_name("Ahri", "Mid"), "League Bro: Ahri Mid");
        assert_eq!(page_name("Ahri", ""), "League Bro: Ahri");
        assert_eq!(page_name("Kha'Zix", "Jungle"), "League Bro: Kha'Zix");
        assert_eq!(page_name("Aurelion Sol", "Mid"), "League Bro: Aurelion Sol");
        assert_eq!(page_name("Twisted Fate Extended", "Mid"), "LB: Twisted Fate Extended");
        assert!(page_name("Twisted Fate Extended", "Support").chars().count() <= 25);
        assert!(is_ours("Riftlight: Ahri Mid") && is_ours("LB: Jinx Bot") && !is_ours("My Ahri page"));
        assert!(is_ours("League Bro: Ahri") && !is_ours("League Brownie"));
    }

    #[test]
    fn swiftplay_slot_perks() {
        let page = RunePage {
            name: String::new(),
            primary_style_id: 8100,
            sub_style_id: 8200,
            selected_perk_ids: vec![9923, 8126, 8140, 8106, 8224, 8234, 5008, 5010, 5001],
        };
        let v: Value = serde_json::from_str(&slot_perks(&page)).unwrap();
        assert_eq!(
            v,
            json!({"perkIds": [9923, 8126, 8140, 8106, 8224, 8234, 5008, 5010, 5001], "perkStyle": 8100, "perkSubStyle": 8200})
        );
    }

    #[test]
    fn swiftplay_linked_pages() {
        // Shapes from a real Swiftplay lobby (October 2026): Yasuo's slot on its
        // temporary page, Master Yi's on the League Bro page, plus a stale leftover.
        let pages = json!([
            {"id": 540183416, "name": "League Bro: Yasuo Mid", "isTemporary": true, "isDeletable": false, "isEditable": true,
             "quickPlayChampionIds": [157], "primaryStyleId": 8000, "subStyleId": 8400},
            {"id": 1724831441, "name": "League Bro: Yasuo Mid", "isTemporary": true, "isDeletable": true, "isEditable": true,
             "quickPlayChampionIds": [], "primaryStyleId": 8400, "subStyleId": 8000},
            {"id": 102402902, "name": "League Bro: Master Yi", "isTemporary": false, "isDeletable": false, "isEditable": true,
             "quickPlayChampionIds": [11], "primaryStyleId": 8100, "subStyleId": 8000},
            {"id": 376696107, "name": "Blitz: Master Yi Jungle", "isTemporary": false, "quickPlayChampionIds": []}
        ]);
        assert_eq!(linked_page(&pages, 157).unwrap()["id"], 540183416);
        assert_eq!(linked_page(&pages, 11).unwrap()["id"], 102402902);
        assert!(linked_page(&pages, 64).is_none());
        let stale: Vec<_> = pages.as_array().unwrap().iter().filter(|p| stale_temporary(p)).map(|p| p["id"].clone()).collect();
        assert_eq!(stale, vec![json!(1724831441)]);
        let page = RunePage {
            name: "League Bro: Master Yi".into(),
            primary_style_id: 8100,
            sub_style_id: 8000,
            selected_perk_ids: vec![9923, 8143, 8140, 8135, 9104, 9111, 5005, 5008, 5001],
        };
        let body = quick_play_body(linked_page(&pages, 11).unwrap(), &page);
        assert_eq!(body["id"], 102402902);
        assert_eq!(body["quickPlayChampionIds"], json!([11]));
        assert_eq!(body["selectedPerkIds"], json!([9923, 8143, 8140, 8135, 9104, 9111, 5005, 5008, 5001]));
    }

    #[test]
    fn own_page_is_reused() {
        let pages = json!([
            {"id": 1, "name": "League Bro: Nautilus", "isTemporary": true},
            {"id": 2, "name": "League Bro: Nami Support", "isTemporary": false, "isEditable": true, "isDeletable": true},
            {"id": 3, "name": "LB: Jinx Bot", "isEditable": true, "isDeletable": false},
            {"id": 5, "name": "Riftlight: Ahri Mid", "isEditable": true, "isDeletable": true},
            {"id": 4, "name": "My Ahri page", "isEditable": true, "current": true},
        ]);
        assert_eq!(own_pages(pages.as_array().unwrap()), (Some(2), vec![5]));
        let none = json!([{"id": 4, "name": "My Ahri page"}, {"id": 1, "name": "League Bro: Nautilus", "isTemporary": true}]);
        assert_eq!(own_pages(none.as_array().unwrap()), (None, vec![]));
    }

    #[test]
    fn takes_over_selected_then_oldest_page() {
        let pages = json!([
            {"id": 1, "name": "Preset", "isEditable": false, "current": true, "lastModified": 1},
            {"id": 2, "name": "Swiftplay", "isEditable": true, "isTemporary": true, "lastModified": 2},
            {"id": 3, "name": "Newer", "isEditable": true, "lastModified": 300},
            {"id": 4, "name": "Older", "isEditable": true, "lastModified": 200},
        ]);
        assert_eq!(page_to_take_over(pages.as_array().unwrap()), Some((4, "Older".into())));
        let mut pages = pages;
        pages[2]["current"] = json!(true);
        assert_eq!(page_to_take_over(pages.as_array().unwrap()), Some((3, "Newer".into())));
        assert_eq!(page_to_take_over(&[json!({"id": 1, "isEditable": false})]), None);
    }

    #[test]
    fn full_error() {
        let e = anyhow::Error::msg("POST /lol-perks/v1/pages returned 400 Bad Request: {\"errorCode\":\"RPC_ERROR\",\"httpStatus\":400,\"implementationDetails\":{},\"message\":\"Max pages reached\"}");
        assert!(is_full_error(&e));
        assert!(!is_full_error(&anyhow!("POST /lol-perks/v1/pages returned 500")));
    }

    #[test]
    fn positions() {
        assert_eq!(normalize_position("UTILITY"), "utility");
        assert_eq!(position_label("middle"), "Mid");
        assert_eq!(position_label(""), "");
    }
}
