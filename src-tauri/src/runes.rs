//! Rune page import.
//!
//! The page comes from your own saved page for that champion if you have
//! one, otherwise from the League client's built-in recommended pages
//! (the same ones shown in the client's rune editor). Riftlight keeps a
//! single page named "Riftlight: ..." and replaces it each time.

use crate::config::{Config, RunePage};
use crate::lcu::Lcu;
use anyhow::{anyhow, Result};
use serde_json::{json, Value};

pub const PAGE_PREFIX: &str = "Riftlight";

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

/// Creates (or replaces) the Riftlight rune page and makes it current.
pub async fn import(
    lcu: &Lcu,
    config: &Config,
    champion_id: i64,
    champion_name: &str,
    position: &str,
    map_id: i64,
) -> Result<ImportResult> {
    let (mut page, source) = match config.rune_overrides.get(&champion_id.to_string()) {
        Some(p) => (p.clone(), "your saved page"),
        None => (recommended_page(lcu, champion_id, position, map_id).await?, "client recommendation"),
    };
    let label = position_label(position);
    page.name = if label.is_empty() {
        format!("{PAGE_PREFIX}: {champion_name}")
    } else {
        format!("{PAGE_PREFIX}: {champion_name} {label}")
    };
    let body = json!({
        "name": page.name,
        "primaryStyleId": page.primary_style_id,
        "subStyleId": page.sub_style_id,
        "selectedPerkIds": page.selected_perk_ids,
        "current": true,
    });

    let pages = lcu.get_req("/lol-perks/v1/pages").await?;
    let pages = pages.as_array().cloned().unwrap_or_default();

    // Remove the page Riftlight made last time.
    for p in &pages {
        let name = p.get("name").and_then(Value::as_str).unwrap_or("");
        let deletable = p.get("isDeletable").and_then(Value::as_bool).unwrap_or(true);
        if name.starts_with(PAGE_PREFIX) && deletable {
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
                 (Riftlight reuses a single slot) or turn on \"Reuse current page when full\"",
            ))
        }
    }
    Ok(ImportResult { page_name: page.name, source })
}

/// Reads the page currently selected in the client, to save as your own
/// default for a champion.
pub async fn current_page(lcu: &Lcu) -> Result<RunePage> {
    let v = lcu.get_req("/lol-perks/v1/currentpage").await?;
    let ids: Vec<i64> = v
        .get("selectedPerkIds")
        .and_then(Value::as_array)
        .map(|a| a.iter().filter_map(Value::as_i64).collect())
        .unwrap_or_default();
    let primary = v.get("primaryStyleId").and_then(Value::as_i64).unwrap_or(0);
    let sub = v.get("subStyleId").and_then(Value::as_i64).unwrap_or(0);
    if ids.len() < 6 || primary == 0 {
        return Err(anyhow!("the selected rune page looks incomplete"));
    }
    Ok(RunePage {
        name: v.get("name").and_then(Value::as_str).unwrap_or("").to_string(),
        primary_style_id: primary,
        sub_style_id: sub,
        selected_perk_ids: ids,
    })
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
    fn positions() {
        assert_eq!(normalize_position("UTILITY"), "utility");
        assert_eq!(position_label("middle"), "Mid");
        assert_eq!(position_label(""), "");
    }
}
