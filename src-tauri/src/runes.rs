//! Rune page import.
//!
//! The page comes from OP.GG's most popular page (when there's enough data),
//! or else the League client's built-in recommended pages (the ones in the
//! client's rune editor). League Bro keeps a single page named
//! "League Bro: ..." and replaces it each time.

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
}

/// OP.GG's page (with enough games), else the client's recommended page.
pub async fn choose_page(
    lcu: &Lcu,
    champion_id: i64,
    position: &str,
    map_id: i64,
    rec: Option<&RuneRec>,
) -> Result<(RunePage, &'static str)> {
    let from_rec = rec.filter(|r| r.games >= MIN_GAMES).map(|r| RunePage {
        name: String::new(),
        primary_style_id: r.primary_style_id,
        sub_style_id: r.sub_style_id,
        selected_perk_ids: r.perk_ids.clone(),
    });
    Ok(match from_rec {
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

/// Swiftplay's temporary page for a lobby slot's champion. The perks plugin
/// keeps one per slot (`isTemporary`, `quickPlayChampionIds: [id]`, named like
/// "Nautilus - Aftershock"); the lobby's rune picker shows it and the game
/// starts on it. Its id changes whenever the client remakes it.
pub fn quick_play_page(pages: &Value, champion_id: i64) -> Option<&Value> {
    pages.as_array()?.iter().find(|p| {
        flag(p, "isTemporary")
            && p.get("quickPlayChampionIds")
                .and_then(Value::as_array)
                .is_some_and(|ids| ids.iter().any(|id| id.as_i64() == Some(champion_id)))
    })
}

/// The temporary page with `page`'s runes, everything else kept as the client has it.
pub fn quick_play_body(existing: &Value, page: &RunePage) -> Value {
    let mut body = existing.clone();
    body["name"] = json!(page.name);
    body["primaryStyleId"] = json!(page.primary_style_id);
    body["subStyleId"] = json!(page.sub_style_id);
    body["selectedPerkIds"] = json!(page.selected_perk_ids);
    body
}

/// Puts `page`'s runes on the Swiftplay temporary page for this champion.
/// (The per-slot `POST player-slots/{index}/{perks}` returns 400
/// INVALID_REQUEST, checked October 2026.)
pub async fn set_quick_play_page(lcu: &Lcu, champion_id: i64, page: &RunePage) -> Result<()> {
    let pages = lcu.get_req("/lol-perks/v1/pages").await?;
    let existing = quick_play_page(&pages, champion_id)
        .ok_or_else(|| anyhow!("the client has no Swiftplay rune page for this champion"))?;
    let id = existing.get("id").and_then(Value::as_i64).unwrap_or_default();
    lcu.put(&format!("/lol-perks/v1/pages/{id}"), &quick_play_body(existing, page)).await?;
    Ok(())
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
    write_page(lcu, config, &page).await?;
    Ok(ImportResult { page_name: page.name, source })
}

/// Writes `page` as the League Bro rune page (replacing the last one) and
/// makes it current.
pub async fn write_page(lcu: &Lcu, config: &Config, page: &RunePage) -> Result<()> {
    let body = json!({
        "name": page.name,
        "primaryStyleId": page.primary_style_id,
        "subStyleId": page.sub_style_id,
        "selectedPerkIds": page.selected_perk_ids,
        "current": true,
    });

    let pages = lcu.get_req("/lol-perks/v1/pages").await?;
    let pages = pages.as_array().cloned().unwrap_or_default();

    // Remove the page League Bro made last time.
    for p in &pages {
        let name = text(p, "name");
        let deletable = p.get("isDeletable").and_then(Value::as_bool).unwrap_or(true);
        if is_ours(name) && deletable {
            if let Some(id) = p.get("id").and_then(Value::as_i64) {
                lcu.delete(&format!("/lol-perks/v1/pages/{id}")).await?;
            }
        }
    }

    match lcu.post("/lol-perks/v1/pages", &body).await {
        Ok(created) => {
            if let Some(id) = created.get("id").and_then(Value::as_i64) {
                let _ = lcu.put("/lol-perks/v1/currentpage", &json!(id)).await;
            }
        }
        Err(e) if config.reuse_current_page_when_full => {
            // Probably out of page slots: overwrite the selected editable page.
            let current = pages.iter().find(|p| {
                flag(p, "current")
                    && flag(p, "isEditable")
            });
            let Some(id) = current.and_then(|p| p.get("id")).and_then(Value::as_i64) else {
                return Err(e.context("no free rune page slot and the selected page isn't editable"));
            };
            let mut body = body;
            body["id"] = json!(id);
            lcu.put(&format!("/lol-perks/v1/pages/{id}"), &body).await?;
            let _ = lcu.put("/lol-perks/v1/currentpage", &json!(id)).await;
        }
        Err(e) => {
            return Err(e.context(
                "couldn't create a rune page; if all your page slots are full, delete one \
                 (League Bro reuses a single slot) or turn on \"Reuse current page when full\"",
            ))
        }
    }
    Ok(())
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
    fn swiftplay_quick_play_page() {
        // Shapes from a real Swiftplay lobby (October 2026).
        let pages = json!([
            {"id": 2061975328, "name": "Nautilus - Aftershock", "isTemporary": true, "isDeletable": false,
             "quickPlayChampionIds": [111], "primaryStyleId": 8400, "subStyleId": 8000, "order": 7,
             "selectedPerkIds": [8439, 8401, 8429, 8453, 9105, 9111, 5005, 5001, 5001]},
            {"id": 865385380, "name": "League Bro: Nami Support", "isTemporary": false,
             "quickPlayChampionIds": [], "primaryStyleId": 8200, "subStyleId": 8400}
        ]);
        let found = quick_play_page(&pages, 111).unwrap();
        assert_eq!(found["id"], 2061975328);
        assert!(quick_play_page(&pages, 31).is_none());
        let page = RunePage {
            name: "League Bro: Nautilus".into(),
            primary_style_id: 8400,
            sub_style_id: 8300,
            selected_perk_ids: vec![8439, 8401, 8473, 8242, 8345, 8347, 5007, 5001, 5001],
        };
        let body = quick_play_body(found, &page);
        assert_eq!(body["id"], 2061975328);
        assert_eq!(body["isTemporary"], true);
        assert_eq!(body["quickPlayChampionIds"], json!([111]));
        assert_eq!(body["name"], "League Bro: Nautilus");
        assert_eq!(body["subStyleId"], 8300);
        assert_eq!(body["selectedPerkIds"], json!([8439, 8401, 8473, 8242, 8345, 8347, 5007, 5001, 5001]));
    }

    #[test]
    fn positions() {
        assert_eq!(normalize_position("UTILITY"), "utility");
        assert_eq!(position_label("middle"), "Mid");
        assert_eq!(position_label(""), "");
    }
}
