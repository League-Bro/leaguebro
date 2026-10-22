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
//! - **OP.GG**: the `lol_list_lane_meta_champions` tool on the MCP endpoint
//!   `opgg.rs` already uses. The most visited site, tiers 1 (OP) to 5, rates
//!   rounded to whole percents, no rank filter. One call returns all lanes.
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
use crate::opgg::{parse_compact, OpGg};
use crate::patch::notes_releases_around;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::time::Duration;
use tokio::sync::Mutex;

const LOLALYTICS: &str = "https://a1.lolalytics.com/mega/";
/// Champion names when the League client isn't open.
const CHAMPION_SUMMARY: &str =
    "https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1/champion-summary.json";
/// Lolalytics' tier labels by index, from the site's own script.
const LOLALYTICS_TIERS: [&str; 16] =
    ["", "S+", "S", "S-", "A+", "A", "A-", "B+", "B", "B-", "C+", "C", "C-", "D+", "D", "D-"];
/// Rank filters Lolalytics accepts (checked October 2026).
pub const RANKS: &[&str] = &["all", "gold_plus", "platinum_plus", "emerald_plus", "diamond_plus", "master_plus"];
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
    /// 0 when the name didn't match a known champion.
    pub champion_id: i64,
    pub name: String,
    /// The row it goes in: S, A, B, C or D.
    pub tier: String,
    /// The source's own label: "S+" … "D-" (Lolalytics) or "1" … "5" (OP.GG).
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
    /// The rank filter, e.g. "emerald_plus". None for OP.GG, which has none.
    pub rank: Option<String>,
    /// Games the source analysed for this list (Lolalytics only).
    pub games_analysed: Option<i64>,
    pub fetched_at: u64,
    /// Best first.
    pub entries: Vec<TierEntry>,
}

/// Lower-case letters and digits only, so "Nunu & Willump" and "NunuWillump" match.
fn name_key(name: &str) -> String {
    name.chars().filter(|c| c.is_alphanumeric()).flat_map(char::to_lowercase).collect()
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

/// The client's position name for each lane in OP.GG's `Positions`.
const OPGG_LANES: [(&str, &str); 5] =
    [("top", "top"), ("jungle", "jungle"), ("mid", "middle"), ("adc", "bottom"), ("support", "utility")];

/// Reads Lolalytics' `ep=list` answer. `names` maps champion id to name.
pub fn parse_lolalytics(body: &Value, position: &str, rank: &str, names: &HashMap<i64, String>) -> Result<TierList> {
    if body.pointer("/response/valid").and_then(Value::as_bool) == Some(false) {
        bail!("Lolalytics rejected the request");
    }
    let champs = body.get("cid").and_then(Value::as_object).context("Lolalytics' answer has no champion list")?;
    let mut entries: Vec<TierEntry> = champs
        .iter()
        .filter(|(_, c)| f(c, "pctLane") >= MIN_LANE_SHARE && f(c, "pr") >= MIN_PICK_RATE)
        .filter_map(|(id, c)| {
            let id: i64 = id.parse().ok()?;
            let label = *LOLALYTICS_TIERS.get(usize::try_from(c.get("tier")?.as_i64()?).ok()?).filter(|l| !l.is_empty())?;
            Some(TierEntry {
                champion_id: id,
                name: names.get(&id).cloned().unwrap_or_else(|| format!("#{id}")),
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
    entries.sort_by_key(|e| e.rank);
    Ok(TierList {
        source: Source::Lolalytics,
        position: position.to_string(),
        rank: Some(rank.to_string()),
        games_analysed: body.get("analysed").and_then(Value::as_i64),
        fetched_at: now_secs(),
        entries,
    })
}

/// Reads OP.GG's `lol_list_lane_meta_champions` answer (already through
/// `parse_compact`) into one list per lane. `ids` maps `name_key` to champion id.
pub fn parse_opgg(parsed: &Value, ids: &HashMap<String, i64>) -> Result<Vec<TierList>> {
    let positions = parsed.pointer("/data/positions").context("OP.GG's answer has no lanes")?;
    let now = now_secs();
    let lists: Vec<TierList> = OPGG_LANES
        .iter()
        .filter_map(|(opgg, position)| {
            let rows = positions.get(*opgg)?.as_array()?;
            let mut entries: Vec<TierEntry> = rows
                .iter()
                .filter(|r| r.get("is_rip").and_then(Value::as_bool) != Some(true))
                .filter_map(|r| {
                    let name = r.get("champion")?.as_str()?.to_string();
                    let tier = r.get("tier")?.as_i64()?;
                    let row = ["S", "A", "B", "C", "D"].get(usize::try_from(tier - 1).ok()?)?;
                    let rank = r.get("rank").and_then(Value::as_i64).unwrap_or(0);
                    Some(TierEntry {
                        champion_id: ids.get(&name_key(&name)).copied().unwrap_or(0),
                        name,
                        tier: row.to_string(),
                        label: tier.to_string(),
                        rank,
                        rank_change: r.get("rank_prev").and_then(Value::as_i64).map(|p| p - rank),
                        win_rate: f(r, "win_rate") * 100.0,
                        pick_rate: f(r, "pick_rate") * 100.0,
                        ban_rate: f(r, "ban_rate") * 100.0,
                        games: r.get("play").and_then(Value::as_i64).unwrap_or(0),
                    })
                })
                .collect();
            entries.sort_by_key(|e| e.rank);
            Some(TierList {
                source: Source::Opgg,
                position: position.to_string(),
                rank: None,
                games_analysed: None,
                fetched_at: now,
                entries,
            })
        })
        .collect();
    if lists.is_empty() {
        bail!("OP.GG's answer has no lanes");
    }
    Ok(lists)
}

/// OP.GG has no rank filter, so its lists are kept per lane only.
fn cache_key(source: Source, position: &str, rank: &str) -> String {
    match source {
        Source::Lolalytics => format!("lolalytics:{position}:{rank}"),
        Source::Opgg => format!("opgg:{position}"),
    }
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
        opgg: &OpGg,
        source: Source,
        position: &str,
        rank: &str,
        champions: Option<Vec<(i64, String)>>,
    ) -> Result<TierList> {
        if lolalytics_lane(position).is_none() {
            bail!("Unknown lane {position}");
        }
        if source == Source::Lolalytics && !RANKS.contains(&rank) {
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
                Err(e) => return cached.ok_or(e),
            },
        };
        let fetched = match source {
            Source::Lolalytics => self.fetch_lolalytics(position, rank, &champions).await.map(|l| vec![l]),
            Source::Opgg => self.fetch_opgg(opgg, &champions).await,
        };
        match fetched {
            Ok(lists) => {
                let mut cache = self.lists.lock().await;
                for l in lists {
                    cache.insert(cache_key(l.source, &l.position, rank), l);
                }
                cache.get(&key).cloned().with_context(|| format!("no {position} list in the answer"))
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

    async fn fetch_lolalytics(&self, position: &str, rank: &str, champions: &[(i64, String)]) -> Result<TierList> {
        let lane = lolalytics_lane(position).unwrap_or("middle");
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
        let names: HashMap<i64, String> = champions.iter().cloned().collect();
        parse_lolalytics(&body, position, rank, &names)
    }

    async fn fetch_opgg(&self, opgg: &OpGg, champions: &[(i64, String)]) -> Result<Vec<TierList>> {
        let fields: Vec<String> = OPGG_LANES
            .iter()
            .map(|(lane, _)| format!("data.positions.{lane}[].{{ban_rate,champion,is_rip,pick_rate,play,rank,rank_prev,tier,win_rate}}"))
            .collect();
        let text = opgg
            .call_tool("lol_list_lane_meta_champions", json!({"lang": "en_US", "position": "all", "desired_output_fields": fields}))
            .await?;
        let parsed = parse_compact(&text).context("couldn't read OP.GG's answer")?;
        let ids: HashMap<String, i64> = champions.iter().map(|(id, name)| (name_key(name), *id)).collect();
        parse_opgg(&parsed, &ids)
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
        assert!(list.entries.windows(2).all(|w| w[0].rank <= w[1].rank));
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
        // Real answer for position "all" (October 2026).
        let parsed = parse_compact(&fixture("opgg_lane_meta.txt")).unwrap();
        let ids = HashMap::from([(name_key("Malphite"), 54), (name_key("Nunu & Willump"), 20)]);
        let lists = parse_opgg(&parsed, &ids).unwrap();
        let positions: Vec<&str> = lists.iter().map(|l| l.position.as_str()).collect();
        assert_eq!(positions, ["top", "jungle", "middle", "bottom", "utility"]);
        let top = &lists[0];
        let first = &top.entries[0];
        assert_eq!((first.name.as_str(), first.champion_id, first.rank), ("Malphite", 54, 1));
        assert_eq!((first.tier.as_str(), first.label.as_str()), ("S", "1"));
        assert!((first.win_rate - 51.0).abs() < 0.01);
        assert_eq!(first.rank_change, Some(0));
        assert!(lists.iter().all(|l| l.entries.len() > 20));
        assert!(lists.iter().flat_map(|l| &l.entries).any(|e| e.champion_id == 20));
    }

    #[test]
    fn names_match_across_spellings() {
        assert_eq!(name_key("Nunu & Willump"), name_key("NunuWillump"));
        assert_eq!(name_key("Kai'Sa"), "kaisa");
        assert_eq!(name_key("Dr. Mundo"), "drmundo");
    }

    /// Calls the real sites: `cargo test live_tier_lists -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn live_tier_lists() {
        let rt = tokio::runtime::Runtime::new().unwrap();
        let tiers = TierLists::new("test");
        let opgg = OpGg::new("test", None);
        for source in [Source::Lolalytics, Source::Opgg] {
            let list = rt.block_on(tiers.get(&opgg, source, "utility", "emerald_plus", None)).unwrap();
            let top: Vec<String> = list.entries.iter().take(5).map(|e| format!("{} {} ({})", e.label, e.name, e.champion_id)).collect();
            println!("{source:?}: {} champions, {:?} games; {}", list.entries.len(), list.games_analysed, top.join(", "));
            assert!(list.entries.len() > 20 && list.entries.iter().all(|e| (1..60000).contains(&e.champion_id)));
        }
    }

    #[test]
    fn lists_expire() {
        let list = TierList {
            source: Source::Opgg,
            position: "top".into(),
            rank: None,
            games_analysed: None,
            fetched_at: 1_800_000_000,
            entries: vec![],
        };
        assert!(is_fresh(&list, list.fetched_at + 60));
        assert!(!is_fresh(&list, list.fetched_at + FRESH_SECS));
    }
}
