//! Puts the recommended build into the in-game shop as a League client item
//! set (`/lol-item-sets/v1/item-sets/{summonerId}/sets`). League Buddy owns
//! one set, replaced on each lock-in; the user's own sets are left alone.

use crate::lcu::Lcu;
use crate::opgg::{ItemSet, Recommendation};
use anyhow::{Context, Result};
use serde_json::{json, Value};

const TITLE_PREFIX: &str = "League Buddy:";

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
    let mut blocks: Vec<Value> = [("Starter", &rec.starter), ("Boots", &rec.boots), ("Core build", &rec.core)]
        .into_iter()
        .filter_map(|(label, set)| set.as_ref().and_then(|s| block(label, s)))
        .collect();
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

/// Replaces League Buddy's set in the client's item-set list, keeping every other set.
pub fn merge(mut existing: Value, set: Value, now_ms: u64) -> Value {
    let mut sets: Vec<Value> = existing
        .get("itemSets")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .filter(|s| !s.get("title").and_then(Value::as_str).unwrap_or("").starts_with(TITLE_PREFIX))
        .collect();
    sets.insert(0, set);
    if !existing.is_object() {
        existing = json!({ "accountId": 0 });
    }
    existing["itemSets"] = Value::Array(sets);
    existing["timestamp"] = json!(now_ms);
    existing
}

fn uid(now_ms: u64) -> String {
    // The client only needs a unique id; shaped like a UUID to match its own.
    format!("1eadb0d1-0000-4000-8000-{:012x}", now_ms & 0xffff_ffff_ffff)
}

/// Writes the set to the client. Returns the set's title.
pub async fn apply(lcu: &Lcu, rec: &Recommendation, champion_name: &str, role_label: &str, map_id: i64) -> Result<Option<String>> {
    let now_ms = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0);
    let Some(set) = build_set(rec, champion_name, role_label, map_id, &uid(now_ms)) else { return Ok(None) };
    let title = set["title"].as_str().unwrap_or("").to_string();
    let me = lcu.get_req("/lol-summoner/v1/current-summoner").await?;
    let summoner_id = me.get("summonerId").and_then(Value::as_i64).context("no summonerId")?;
    let path = format!("/lol-item-sets/v1/item-sets/{summoner_id}/sets");
    let existing = lcu.get(&path).await?.unwrap_or(Value::Null);
    lcu.put(&path, &merge(existing, set, now_ms)).await?;
    Ok(Some(title))
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
            ..Default::default()
        }
    }

    #[test]
    fn blocks_in_shop_order() {
        let s = build_set(&rec(), "Ahri", "Mid", 11, "u").unwrap();
        assert_eq!(s["title"], "League Buddy: Ahri Mid");
        assert_eq!(s["map"], "SR");
        assert_eq!(s["associatedChampions"], json!([103]));
        let blocks = s["blocks"].as_array().unwrap();
        let headers: Vec<&str> = blocks.iter().map(|b| b["type"].as_str().unwrap()).collect();
        // Merged options have no single win rate.
        assert_eq!(headers, ["Starter - 51% WR", "Boots - 51% WR", "Core build - 53% WR", "4th item options", "5th item options"]);
        assert_eq!(blocks[0]["items"], json!([{ "id": "1056", "count": 1 }, { "id": "2003", "count": 2 }]));
        assert_eq!(blocks[3]["items"], json!([{ "id": "3089", "count": 1 }, { "id": "3135", "count": 1 }]));
    }

    #[test]
    fn no_items_no_set() {
        assert_eq!(build_set(&Recommendation::default(), "Ahri", "", 12, "u"), None);
    }

    #[test]
    fn merge_keeps_your_sets_and_replaces_ours() {
        let existing = json!({ "accountId": 7, "timestamp": 1, "itemSets": [
            { "title": "My Ahri set" },
            { "title": "League Buddy: Zed Mid" },
        ]});
        let out = merge(existing, json!({ "title": "League Buddy: Ahri Mid" }), 99);
        let titles: Vec<&str> = out["itemSets"].as_array().unwrap().iter().map(|s| s["title"].as_str().unwrap()).collect();
        assert_eq!(titles, ["League Buddy: Ahri Mid", "My Ahri set"]);
        assert_eq!((out["accountId"].as_i64(), out["timestamp"].as_u64()), (Some(7), Some(99)));
    }

    #[test]
    fn merge_into_empty_client() {
        let out = merge(json!({ "accountId": 0, "itemSets": [], "timestamp": 0 }), json!({ "title": "League Buddy: Ahri" }), 5);
        assert_eq!(out["itemSets"].as_array().unwrap().len(), 1);
    }
}
