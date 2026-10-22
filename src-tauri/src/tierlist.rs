//! Champion tier lists per lane, from the two community sites that publish
//! them as data (the Tier List tab):
//!
//! - **Lolalytics** (default): `a1.lolalytics.com/mega/?ep=list`, the JSON
//!   behind lolalytics.com/lol/tierlist. Current patch, Emerald+ by default,
//!   any rank filter. It has by far the biggest sample (millions of games a
//!   day; OP.GG and U.GG show about a tenth of that) and two-decimal rates,
//!   which is why players treat it as the most accurate. Each champion has a
//!   `tier` index into `LOLALYTICS_TIERS` (1 = S+ … 15 = D-), and the list
//!   holds every champion played in the lane, so off-role picks are dropped
//!   (`MIN_LANE_SHARE`, `MIN_PICK_RATE`).
//! - **OP.GG**: `lol-api-champion.op.gg/api/global/champions/ranked`, the
//!   JSON behind op.gg/lol/champions. The most visited site, current patch,
//!   tiers OP (0, a lane's standout picks; not always present) then 1 to 5,
//!   the same rank filters (default Emerald+). One call
//!   returns every champion with a `positions` entry per lane it's ranked in,
//!   so it fills all five lanes. (The MCP tool `lol_list_lane_meta_champions`
//!   gives the same tiers but has no rank filter and rounds the rates.)
//!
//! U.GG was checked too (October 2026): its JSON has the stats but computes
//! tiers in the page's own script, so they can't be matched.
//!
//! Both are unofficial and could change. Lists are kept in memory for
//! `FRESH_SECS` (and never past the next patch notes); they're one small
//! request, so they aren't saved to disk.

use anyhow::{bail, Context, Result};
use crate::cache::now_secs;
use crate::engine::is_league_classic;
use crate::opgg::MIN_GAMES;
use crate::patch::notes_releases_around;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::time::Duration;
use tokio::sync::Mutex;

const LOLALYTICS: &str = "https://a1.lolalytics.com/mega/";
const OPGG: &str = "https://lol-api-champion.op.gg/api/global/champions/ranked";
/// Champion names when the League client isn't open.
const CHAMPION_SUMMARY: &str =
    "https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1/champion-summary.json";
/// Lolalytics' tier labels by index, from the site's own script.
const LOLALYTICS_TIERS: [&str; 16] =
    ["", "S+", "S", "S-", "A+", "A", "A-", "B+", "B", "B-", "C+", "C", "C-", "D+", "D", "D-"];
/// Rank filters both sites accept, with the same names (checked October
/// 2026). Lolalytics also takes `d2_plus`, `grandmaster_plus` and `1trick`,
/// which OP.GG rejects, so they're left out.
pub const RANKS: &[&str] = &[
    "all", "gold_plus", "platinum_plus", "emerald_plus", "diamond_plus", "master_plus",
    "iron", "bronze", "silver", "gold", "platinum", "emerald", "diamond", "master", "grandmaster", "challenger",
];
/// Lolalytics lists every champion seen in the lane. Below these (percent of
/// the champion's games in this lane, and of all games in the lane) it's an
/// off-role pick, not part of the lane's tier list.
const MIN_LANE_SHARE: f64 = 5.0;
const MIN_PICK_RATE: f64 = 0.5;
/// How long a fetched list is shown before asking again.
const FRESH_SECS: u64 = 3 * 3600;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Source {
    Lolalytics,
    Opgg,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TierEntry {
    pub champion_id: i64,
    pub name: String,
    /// The row it goes in: S, A, B, C or D.
    pub tier: String,
    /// The source's own label: "S+" … "D-" (Lolalytics) or "OP", "1" … "5" (OP.GG).
    pub label: String,
    /// 1 = best in the lane.
    pub rank: i64,
    /// Places moved up (negative = down) since the source's previous ranking.
    pub rank_change: Option<i64>,
    /// Percentages (52.3 = 52.3 %).
    pub win_rate: f64,
    pub pick_rate: f64,
    pub ban_rate: f64,
    pub games: i64,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TierList {
    pub source: Source,
    /// top | jungle | middle | bottom | utility (the client's names).
    pub position: String,
    /// The rank filter, e.g. "emerald_plus".
    pub rank: String,
    /// The patch the stats are from, e.g. "16.21" (OP.GG only; Lolalytics
    /// doesn't say, but defaults to the current patch too).
    pub patch: Option<String>,
    /// Games the source analysed for this list.
    pub games_analysed: Option<i64>,
    pub fetched_at: u64,
    /// Best first.
    pub entries: Vec<TierEntry>,
}

fn f(v: &Value, k: &str) -> f64 {
    v.get(k).and_then(|x| x.as_f64().or_else(|| x.as_str()?.parse().ok())).unwrap_or(0.0)
}

fn lolalytics_lane(position: &str) -> Option<&'static str> {
    match position {
        "top" => Some("top"),
        "jungle" => Some("jungle"),
        "middle" => Some("middle"),
        "bottom" => Some("bottom"),
        "utility" => Some("support"),
        _ => None,
    }
}

/// OP.GG's position name for each of the client's lanes.
const OPGG_LANES: [(&str, &str); 5] =
    [("TOP", "top"), ("JUNGLE", "jungle"), ("MID", "middle"), ("ADC", "bottom"), ("SUPPORT", "utility")];

fn champion_name(names: &HashMap<i64, String>, id: i64) -> String {
    names.get(&id).cloned().unwrap_or_else(|| format!("#{id}"))
}

/// Drops champions with too few games to say anything (in Challenger, or
/// early in a patch, some have 3), sorts by the source's rank, and numbers
/// what's left 1, 2, 3…; the source's ranks count the dropped champions
/// too. `rank_change` stays as the source reported it.
fn finish(mut entries: Vec<TierEntry>) -> Vec<TierEntry> {
    entries.retain(|e| e.games >= MIN_GAMES);
    entries.sort_by_key(|e| e.rank);
    for (i, e) in entries.iter_mut().enumerate() {
        e.rank = i as i64 + 1;
    }
    entries
}

/// Reads Lolalytics' `ep=list` answer. `names` maps champion id to name.
pub fn parse_lolalytics(body: &Value, position: &str, rank: &str, names: &HashMap<i64, String>) -> Result<TierList> {
    if body.pointer("/response/valid").and_then(Value::as_bool) == Some(false) {
        bail!("Lolalytics rejected the request");
    }
    let champs = body.get("cid").and_then(Value::as_object).context("Lolalytics' answer has no champion list")?;
    let entries: Vec<TierEntry> = champs
        .iter()
        .filter(|(_, c)| f(c, "pctLane") >= MIN_LANE_SHARE && f(c, "pr") >= MIN_PICK_RATE)
        .filter_map(|(id, c)| {
            let id: i64 = id.parse().ok()?;
            let label = *LOLALYTICS_TIERS.get(usize::try_from(c.get("tier")?.as_i64()?).ok()?).filter(|l| !l.is_empty())?;
            Some(TierEntry {
                champion_id: id,
                name: champion_name(names, id),
                tier: label[..1].to_string(),
                label: label.to_string(),
                rank: c.get("rank").and_then(Value::as_i64).unwrap_or(0),
                rank_change: None,
                win_rate: f(c, "wr"),
                pick_rate: f(c, "pr"),
                ban_rate: f(c, "br"),
                games: c.get("games").and_then(Value::as_i64).unwrap_or(0),
            })
        })
        .collect();
    let entries = finish(entries);
    Ok(TierList {
        source: Source::Lolalytics,
        position: position.to_string(),
        rank: rank.to_string(),
        patch: None,
        games_analysed: body.get("analysed").and_then(Value::as_i64),
        fetched_at: now_secs(),
        entries,
    })
}

/// Reads OP.GG's champions answer into one list per lane. `names` maps
/// champion id to name.
pub fn parse_opgg(body: &Value, rank: &str, names: &HashMap<i64, String>) -> Result<Vec<TierList>> {
    let champs = body.get("data").and_then(Value::as_array).context("OP.GG's answer has no champion list")?;
    let now = now_secs();
    let lists: Vec<TierList> = OPGG_LANES
        .iter()
        .map(|(opgg, position)| {
            let entries: Vec<TierEntry> = champs
                .iter()
                .filter(|c| c.get("is_rip").and_then(Value::as_bool) != Some(true))
                .filter_map(|c| {
                    let id = c.get("id")?.as_i64()?;
                    let lane = c
                        .get("positions")?
                        .as_array()?
                        .iter()
                        .find(|p| p.get("name").and_then(Value::as_str) == Some(*opgg))?;
                    let stats = lane.get("stats")?;
                    let tier_data = stats.get("tier_data")?;
                    let tier = tier_data.get("tier")?.as_i64()?;
                    // 0 is OP.GG's "OP" tier, above tier 1 (seen in Challenger,
                    // October 2026); it goes in the S row with tier 1.
                    let row = ["S", "S", "A", "B", "C", "D"].get(usize::try_from(tier).ok()?)?;
                    let rank = tier_data.get("rank").and_then(Value::as_i64).unwrap_or(0);
                    Some(TierEntry {
                        champion_id: id,
                        name: champion_name(names, id),
                        tier: row.to_string(),
                        label: if tier == 0 { "OP".to_string() } else { tier.to_string() },
                        rank,
                        rank_change: tier_data.get("rank_prev").and_then(Value::as_i64).map(|p| p - rank),
                        win_rate: f(stats, "win_rate") * 100.0,
                        pick_rate: f(stats, "pick_rate") * 100.0,
                        ban_rate: f(stats, "ban_rate") * 100.0,
                        games: stats.get("play").and_then(Value::as_i64).unwrap_or(0),
                    })
                })
                .collect();
            let entries = finish(entries);
            TierList {
                source: Source::Opgg,
                position: position.to_string(),
                rank: rank.to_string(),
                patch: body.pointer("/meta/version").and_then(Value::as_str).map(str::to_string),
                games_analysed: body.pointer("/meta/match_count").and_then(Value::as_i64),
                fetched_at: now,
                entries,
            }
        })
        .collect();
    if lists.iter().all(|l| l.entries.is_empty()) {
        bail!("OP.GG's answer has no ranked champions");
    }
    Ok(lists)
}

fn cache_key(source: Source, position: &str, rank: &str) -> String {
    let source = match source {
        Source::Lolalytics => "lolalytics",
        Source::Opgg => "opgg",
    };
    format!("{source}:{position}:{rank}")
}

fn is_fresh(list: &TierList, now: u64) -> bool {
    now < (list.fetched_at + FRESH_SECS).min(notes_releases_around(list.fetched_at).1)
}

pub struct TierLists {
    http: reqwest::Client,
    /// By "source:position:rank".
    lists: Mutex<HashMap<String, TierList>>,
    /// Id and name of every champion, from CommunityDragon, for when the
    /// League client isn't open.
    champions: Mutex<Option<Vec<(i64, String)>>>,
}

impl TierLists {
    pub fn new(version: &str) -> TierLists {
        TierLists {
            http: reqwest::Client::builder()
                .user_agent(format!("LeagueBro/{version} (+https://github.com/doliaro/leaguebro)"))
                .timeout(Duration::from_secs(15))
                .build()
                .expect("http client"),
            lists: Mutex::new(HashMap::new()),
            champions: Mutex::new(None),
        }
    }

    /// The tier list for one lane. `champions` (id, name) comes from the
    /// League client; None fetches the names from CommunityDragon instead.
    pub async fn get(
        &self,
        source: Source,
        position: &str,
        rank: &str,
        champions: Option<Vec<(i64, String)>>,
    ) -> Result<TierList> {
        // Every client lane has a Lolalytics name, so this also checks OP.GG's.
        let Some(lane) = lolalytics_lane(position) else { bail!("Unknown lane {position}") };
        if !RANKS.contains(&rank) {
            bail!("Unknown rank filter {rank}");
        }
        let key = cache_key(source, position, rank);
        let now = now_secs();
        let cached = self.lists.lock().await.get(&key).cloned();
        if let Some(list) = cached.as_ref().filter(|l| is_fresh(l, now)) {
            return Ok(list.clone());
        }
        let champions = match champions.filter(|c| !c.is_empty()) {
            Some(c) => c,
            None => match self.champion_names().await {
                Ok(c) => c,
                // Offline: an older list still beats none.
                Err(e) => match cached {
                    Some(list) => return Ok(list),
                    // Names are only for display; the list still works with "#id".
                    None => {
                        eprintln!("tier list without champion names: {e:#}");
                        Vec::new()
                    }
                },
            },
        };
        let names: HashMap<i64, String> = champions.into_iter().collect();
        let fetched = match source {
            Source::Lolalytics => self.fetch_lolalytics(lane, position, rank, &names).await.map(|l| vec![l]),
            Source::Opgg => self.fetch_opgg(rank, &names).await,
        };
        match fetched {
            Ok(lists) => {
                let wanted = lists.iter().find(|l| l.position == position).cloned();
                // A list without names isn't kept, so the next visit tries for them again.
                if !names.is_empty() {
                    let mut cache = self.lists.lock().await;
                    for l in lists {
                        cache.insert(cache_key(l.source, &l.position, rank), l);
                    }
                }
                wanted.with_context(|| format!("no {position} list in the answer"))
            }
            // Offline: an older list still beats none.
            Err(e) => cached.ok_or(e),
        }
    }

    async fn champion_names(&self) -> Result<Vec<(i64, String)>> {
        let mut guard = self.champions.lock().await;
        if let Some(c) = guard.as_ref() {
            return Ok(c.clone());
        }
        let body: Value = self
            .http
            .get(CHAMPION_SUMMARY)
            .send()
            .await
            .context("couldn't reach CommunityDragon for champion names")?
            .error_for_status()?
            .json()
            .await
            .context("couldn't read CommunityDragon's champion list")?;
        let names: Vec<(i64, String)> = body
            .as_array()
            .into_iter()
            .flatten()
            // League Classic copies share the normal champions' names.
            .filter(|c| !is_league_classic(c["id"].as_i64().unwrap_or(0), c["alias"].as_str().unwrap_or("")))
            .filter_map(|c| Some((c.get("id")?.as_i64()?, c.get("name")?.as_str()?.to_string())))
            .filter(|(id, _)| *id > 0)
            .collect();
        *guard = Some(names.clone());
        Ok(names)
    }

    /// `lane` is Lolalytics' name for `position`.
    async fn fetch_lolalytics(&self, lane: &str, position: &str, rank: &str, names: &HashMap<i64, String>) -> Result<TierList> {
        let body: Value = self
            .http
            .get(LOLALYTICS)
            .query(&[("ep", "list"), ("v", "1"), ("cid", "0"), ("lane", lane), ("tier", rank), ("queue", "ranked"), ("region", "all")])
            .send()
            .await
            .context("couldn't reach Lolalytics")?
            .error_for_status()?
            .json()
            .await
            .context("couldn't read Lolalytics' answer")?;
        parse_lolalytics(&body, position, rank, names)
    }

    async fn fetch_opgg(&self, rank: &str, names: &HashMap<i64, String>) -> Result<Vec<TierList>> {
        let body: Value = self
            .http
            .get(OPGG)
            .query(&[("tier", rank)])
            .send()
            .await
            .context("couldn't reach OP.GG")?
            .error_for_status()?
            .json()
            .await
            .context("couldn't read OP.GG's answer")?;
        parse_opgg(&body, rank, names)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture(name: &str) -> String {
        std::fs::read_to_string(format!("{}/tests/fixtures/{name}", env!("CARGO_MANIFEST_DIR"))).unwrap()
    }

    #[test]
    fn lolalytics_top_lane() {
        // Real answer for top, Emerald+, patch 16.21 (October 2026).
        let body: Value = serde_json::from_str(&fixture("lolalytics_top.json")).unwrap();
        let names = HashMap::from([(54, "Malphite".to_string())]);
        let list = parse_lolalytics(&body, "top", "emerald_plus", &names).unwrap();
        assert_eq!(list.source, Source::Lolalytics);
        assert!(list.games_analysed.unwrap() > 1_000_000);
        // Off-role picks are dropped; a normal lane has 40-80 champions.
        assert!((30..90).contains(&list.entries.len()), "{} entries", list.entries.len());
        // Numbered 1, 2, 3… after the off-role picks are dropped.
        assert!(list.entries.iter().enumerate().all(|(i, e)| e.rank == i as i64 + 1));
        let first = &list.entries[0];
        assert_eq!(first.tier, "S");
        assert!(first.label.starts_with('S'));
        assert!(list.entries.iter().all(|e| ["S", "A", "B", "C", "D"].contains(&e.tier.as_str())));
        assert!(list.entries.iter().all(|e| e.win_rate > 30.0 && e.win_rate < 70.0 && e.pick_rate >= MIN_PICK_RATE));
        let malphite = list.entries.iter().find(|e| e.champion_id == 54).unwrap();
        assert_eq!(malphite.name, "Malphite");
        // Unknown ids still show, by number.
        assert!(list.entries.iter().any(|e| e.name.starts_with('#')));
    }

    #[test]
    fn opgg_all_lanes() {
        // Real answer for Emerald+, patch 16.21 (October 2026), with the
        // counters and role breakdowns left out to keep the fixture small.
        let body: Value = serde_json::from_str(&fixture("opgg_champions_emerald.json")).unwrap();
        let names = HashMap::from([(412, "Thresh".to_string()), (103, "Ahri".to_string())]);
        let lists = parse_opgg(&body, "emerald_plus", &names).unwrap();
        let positions: Vec<&str> = lists.iter().map(|l| l.position.as_str()).collect();
        assert_eq!(positions, ["top", "jungle", "middle", "bottom", "utility"]);
        assert!(lists.iter().all(|l| l.entries.len() > 30 && l.entries.windows(2).all(|w| w[0].rank <= w[1].rank)));
        assert_eq!(lists[0].patch.as_deref(), Some("16.21"));
        assert!(lists[0].games_analysed.unwrap() > 1_000_000);
        let thresh = &lists[4].entries[0];
        assert_eq!((thresh.name.as_str(), thresh.champion_id, thresh.rank), ("Thresh", 412, 1));
        assert_eq!((thresh.tier.as_str(), thresh.label.as_str()), ("S", "1"));
        assert!((thresh.win_rate - 51.91).abs() < 0.01);
        let ahri = lists[2].entries.iter().find(|e| e.champion_id == 103).unwrap();
        assert_eq!((ahri.rank, ahri.rank_change), (1, Some(0)));
        // Ahri is only ranked in mid.
        assert!(!lists[0].entries.iter().any(|e| e.champion_id == 103));
    }

    #[test]
    fn opgg_op_tier() {
        // Shape from a real Challenger answer (October 2026): tier 0 = "OP".
        let body = serde_json::json!({"meta": {"version": "16.21", "match_count": 5133}, "data": [
            {"id": 64, "positions": [{"name": "JUNGLE", "stats": {"play": 79, "win_rate": 0.43, "pick_rate": 0.14, "ban_rate": 0.19,
                "tier_data": {"tier": 0, "rank": 1, "rank_prev": 1}}}]},
            {"id": 254, "positions": [{"name": "JUNGLE", "stats": {"play": 60, "win_rate": 0.55, "pick_rate": 0.1, "ban_rate": 0.01,
                "tier_data": {"tier": 1, "rank": 2, "rank_prev": 3}}}]}]});
        let lists = parse_opgg(&body, "challenger", &HashMap::new()).unwrap();
        let jungle: Vec<(&str, &str)> = lists[1].entries.iter().map(|e| (e.tier.as_str(), e.label.as_str())).collect();
        assert_eq!(jungle, [("S", "OP"), ("S", "1")]);
    }

    /// Calls the real sites: `cargo test live_tier_lists -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn live_tier_lists() {
        let rt = tokio::runtime::Runtime::new().unwrap();
        let tiers = TierLists::new("test");
        for (source, rank) in [
            (Source::Lolalytics, "emerald_plus"),
            (Source::Lolalytics, "silver"),
            (Source::Opgg, "emerald_plus"),
            (Source::Opgg, "master_plus"),
            (Source::Opgg, "silver"),
            (Source::Lolalytics, "challenger"),
            (Source::Opgg, "challenger"),
        ] {
            let list = rt.block_on(tiers.get(source, "utility", rank, None)).unwrap();
            let top: Vec<String> = list.entries.iter().take(5).map(|e| format!("{} {} ({})", e.label, e.name, e.champion_id)).collect();
            println!("{source:?} {rank}: {} champions, {:?} games; {}", list.entries.len(), list.games_analysed, top.join(", "));
            assert!(list.entries.iter().all(|e| (1..60000).contains(&e.champion_id)));
            // Lolalytics doesn't rate champions in Challenger (too few games).
            if (source, rank) != (Source::Lolalytics, "challenger") {
                assert!(list.entries.len() > 10);
            }
        }
    }

    #[test]
    fn tiny_samples_are_dropped_and_ranks_renumbered() {
        let entry = |rank, games| TierEntry {
            champion_id: rank,
            name: String::new(),
            tier: "S".into(),
            label: "1".into(),
            rank,
            rank_change: Some(2),
            win_rate: 50.0,
            pick_rate: 1.0,
            ban_rate: 0.0,
            games,
        };
        let out = finish(vec![entry(9, 400), entry(2, 3), entry(4, MIN_GAMES)]);
        let ranks: Vec<(i64, i64)> = out.iter().map(|e| (e.champion_id, e.rank)).collect();
        assert_eq!(ranks, [(4, 1), (9, 2)]);
        assert!(out.iter().all(|e| e.rank_change == Some(2)));
    }

    #[test]
    fn lists_expire() {
        let list = TierList {
            source: Source::Opgg,
            position: "top".into(),
            rank: "emerald_plus".into(),
            patch: None,
            games_analysed: None,
            fetched_at: 1_800_000_000,
            entries: vec![],
        };
        assert!(is_fresh(&list, list.fetched_at + 60));
        assert!(!is_fresh(&list, list.fetched_at + FRESH_SECS));
    }
}
