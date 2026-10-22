//! Rune page import.
//!
//! The page comes from OP.GG's most popular page (when there's enough data),
//! or else the League client's built-in recommended pages (the ones in the
//! client's rune editor). League Bro keeps a single page named
//! "League Bro: ..." and replaces it each time.

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
    let pos_of = |p: &Value| normalize_position(p.get("position").and_then(Value::as_str).unwrap_or(""));
    // 1. exact position match, 2. the champion's default position, 3. anything valid.
    arr.iter()
        .filter(|p| !wanted.is_empty() && pos_of(p) == wanted)
        .find_map(parse)
        .or_else(|| {
            arr.iter()
                .filter(|p| p.get("isDefaultPosition").and_then(Value::as_bool).unwrap_or(false))
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
    let from_rec = rec.filter(|r| r.games >= MIN_GAMES).map(|r| RunePage {
        name: String::new(),
        primary_style_id: r.primary_style_id,
        sub_style_id: r.sub_style_id,
        selected_perk_ids: r.perk_ids.clone(),
    });
    let (mut page, source) = match from_rec {
        Some(p) => (p, "OP.GG"),
        None => (recommended_page(lcu, champion_id, position, map_id).await?, "client recommendation"),
    };
    let label = position_label(position);
    page.name = page_name(champion_name, label);
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
        let name = p.get("name").and_then(Value::as_str).unwrap_or("");
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
                p.get("current").and_then(Value::as_bool).unwrap_or(false)
                    && p.get("isEditable").and_then(Value::as_bool).unwrap_or(false)
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
    Ok(ImportResult { page_name: page.name, source })
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
    fn positions() {
        assert_eq!(normalize_position("UTILITY"), "utility");
        assert_eq!(position_label("middle"), "Mid");
        assert_eq!(position_label(""), "");
    }
}
