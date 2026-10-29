//! Your profile from OP.GG, for when the League client isn't running: rank
//! and recent games looked up by Riot ID and region, plus OP.GG's "Update"
//! button.
//!
//! Rank, level and icon come from the MCP tool `lol_get_summoner_profile`,
//! games from `lol_list_summoner_matches` (at most 20, only your own line in
//! each, so there are no enemy or lane-opponent stats). OP.GG only knows what
//! it fetched from Riot at its last update (`updated_at`), which can be days
//! old; `renew` gets it to fetch again, like the button on op.gg.

use crate::lp_history::{LpHistory, LpPoint};
use crate::opgg::{parse_compact, OpGg};
use crate::postgame::PlayerLine;
use crate::profile::{self, MatchLine, MyProfile};
use crate::scout::RankLine;
use crate::util::{int, list, text};
use anyhow::{anyhow, bail, Context, Result};
use serde_json::{json, Value};
use std::time::Duration;

/// The most games `lol_list_summoner_matches` returns.
const MATCH_LIMIT: i64 = 20;
/// How long to wait for OP.GG to finish an update, and how often to check.
const RENEW_WAIT: Duration = Duration::from_secs(45);
const RENEW_POLL: Duration = Duration::from_secs(4);

const PROFILE_FIELDS: &[&str] = &[
    "data.summoner.{puuid,game_name,tagline,profile_image_url,level,updated_at,renewable_at}",
    "data.summoner.league_stats[].tier_info.{division,lp,tier}",
    "data.summoner.league_stats[].{game_type,lose,win}",
    "data.summoner.lp_histories[].{created_at}",
    "data.summoner.lp_histories[].tier_info.{division,lp,tier}",
];

const MATCH_FIELDS: &[&str] = &[
    "data.game_history[].{created_at,game_length_second,game_map,game_type,id}",
    "data.game_history[].participants[].summoner.{game_name,puuid,tagline}",
    "data.game_history[].participants[].{champion_id,items[],spells[],team_key}",
    "data.game_history[].participants[].stats.{assist,champion_level,death,gold_earned,kill,minion_kill,neutral_minion_kill,result,total_damage_dealt_to_champions}",
];

/// A Riot ID as OP.GG takes it: "Name#TAG" split at the last `#`.
pub fn split_riot_id(riot_id: &str) -> Result<(&str, &str)> {
    let (name, tag) = riot_id.trim().rsplit_once('#').ok_or_else(|| anyhow!("enter your Riot ID as Name#TAG"))?;
    if name.trim().is_empty() || tag.trim().is_empty() {
        bail!("enter your Riot ID as Name#TAG");
    }
    Ok((name.trim(), tag.trim()))
}

/// OP.GG's region code for the League client's region (`/riotclient/region-locale`):
/// "NA" → "na", "LA1" → "lan", "OC1" → "oce"…
pub fn region_from_client(region: &str) -> String {
    match region.to_ascii_uppercase().as_str() {
        "LA1" => "lan".into(),
        "LA2" => "las".into(),
        "OC1" => "oce".into(),
        "EUN1" => "eune".into(),
        "EUW1" => "euw".into(),
        r => r.trim_end_matches(|c: char| c.is_ascii_digit()).to_ascii_lowercase(),
    }
}

/// OP.GG's `game_type` as a client queue id, so queue labels and per-queue
/// insights work the same as with the client's data. 0 when there's no one
/// queue for it ("NORMAL" covers draft, blind and Quickplay); the UI then
/// shows `game_mode`.
fn queue_id(game_type: &str) -> i64 {
    match game_type {
        "SOLORANKED" => 420,
        "FLEXRANKED" => 440,
        "ARAM" => 450,
        "SWIFTPLAY" => 480,
        "QUICKPLAY" => 490,
        "URF" => 900,
        "NEXUS_BLITZ" => 1300,
        "ARENA" => 1700,
        "BOT" => 830,
        _ => 0,
    }
}

/// Unix ms from an ISO-8601 time with an offset ("2026-10-22T15:34:37+09:00").
pub fn iso_ms(s: &str) -> Option<i64> {
    let n = |r: std::ops::Range<usize>| s.get(r)?.parse::<i64>().ok();
    let (y, mo, d, h, mi, sec) = (n(0..4)?, n(5..7)?, n(8..10)?, n(11..13)?, n(14..16)?, n(17..19)?);
    // Offset: "Z", or ±hh:mm after any fractional seconds.
    let rest = s.get(19..)?.trim_start_matches(|c: char| c == '.' || c.is_ascii_digit());
    let offset = match rest.as_bytes().first() {
        None | Some(b'Z') => 0,
        Some(&sign) => {
            let off = |r: std::ops::Range<usize>| rest.get(r)?.parse::<i64>().ok();
            let secs = off(1..3)? * 3600 + off(4..6)? * 60;
            if sign == b'-' { -secs } else { secs }
        }
    };
    // Days since 1970-01-01 (Howard Hinnant's days_from_civil).
    let y = if mo <= 2 { y - 1 } else { y };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let doy = (153 * (mo + if mo > 2 { -3 } else { 9 }) + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let days = era * 146097 + doe - 719468;
    Some((days * 86400 + h * 3600 + mi * 60 + sec - offset) * 1000)
}

const ROMAN: [&str; 5] = ["", "I", "II", "III", "IV"];

/// Tier, division and LP from a `tier_info`.
fn tier_info(s: &Value) -> Option<(String, String, i64)> {
    let tier = text(s, "/tier_info/tier");
    if tier.is_empty() {
        return None;
    }
    let division = usize::try_from(int(s, "/tier_info/division")).ok().and_then(|d| ROMAN.get(d)).copied().unwrap_or("");
    // Master and up have no division; OP.GG still sends 1.
    let division = if matches!(tier, "MASTER" | "GRANDMASTER" | "CHALLENGER") { "" } else { division };
    Some((tier.to_string(), division.to_string(), int(s, "/tier_info/lp")))
}

fn rank(stats: &Value, game_type: &str) -> Option<RankLine> {
    let s = list(stats, "/data/summoner/league_stats").iter().find(|s| text(s, "game_type") == game_type)?;
    let (tier, division, lp) = tier_info(s)?;
    Some(RankLine { tier, division, lp, wins: int(s, "win"), losses: int(s, "lose") })
}

/// OP.GG's Solo/Duo LP history (`lp_histories`, newest first, one point for
/// each day it updated the player), oldest first.
fn lp_points(v: &Value) -> Vec<LpPoint> {
    let mut out: Vec<LpPoint> = list(v, "/data/summoner/lp_histories")
        .iter()
        .filter_map(|h| {
            let (tier, division, lp) = tier_info(h)?;
            Some(LpPoint { at: iso_ms(text(h, "created_at"))?, tier, division, lp, games: None })
        })
        .collect();
    out.sort_by_key(|p| p.at);
    out
}

/// The profile icon id from OP.GG's image URL (".../profileIcon7126.jpg").
fn icon_id(url: &str) -> i64 {
    url.rsplit("profileIcon").next().and_then(|s| s.split('.').next()).and_then(|s| s.parse().ok()).unwrap_or(0)
}

/// Name, icon, level and ranks from `lol_get_summoner_profile`.
pub fn parse_profile(v: &Value) -> MyProfile {
    let s = v.pointer("/data/summoner").cloned().unwrap_or(Value::Null);
    let (name, tag) = (text(&s, "game_name"), text(&s, "tagline"));
    MyProfile {
        puuid: text(&s, "puuid").to_string(),
        name: if tag.is_empty() { name.to_string() } else { format!("{name}#{tag}") },
        icon_id: icon_id(text(&s, "profile_image_url")),
        level: int(&s, "level"),
        solo: rank(v, "SOLORANKED"),
        flex: rank(v, "FLEXRANKED"),
        source: "opgg".into(),
        updated_at: iso_ms(text(&s, "updated_at")),
        renewable_at: iso_ms(text(&s, "renewable_at")),
        // Merged into the saved history by `LpStore::record`.
        lp_history: LpHistory { solo: lp_points(v), flex: Vec::new() },
        ..Default::default()
    }
}

/// Your line from each game in `lol_list_summoner_matches`, newest first,
/// with the same games left out as from the client (custom, Brawl, League Classic).
pub fn parse_matches(v: &Value, puuid: &str) -> Vec<MatchLine> {
    let mut out: Vec<MatchLine> = list(v, "/data/game_history")
        .iter()
        .filter_map(|g| {
            let game_type = text(g, "game_type");
            let parts = list(g, "participants");
            // Only the player looked up is listed; match by puuid in case that changes.
            let p = parts.iter().find(|p| text(p, "/summoner/puuid") == puuid).or(parts.first())?;
            let st = |k: &str| int(p, &format!("/stats/{k}"));
            let mut items: Vec<i64> = list(p, "items").iter().filter_map(Value::as_i64).take(6).collect();
            // Six item slots plus the trinket, like the client's lines; OP.GG
            // doesn't say which is the trinket, so that slot stays empty.
            items.resize(7, 0);
            let spells: Vec<i64> = list(p, "spells").iter().filter_map(Value::as_i64).collect();
            let line = PlayerLine {
                champion_id: int(p, "champion_id"),
                level: st("champion_level"),
                kills: st("kill"),
                deaths: st("death"),
                assists: st("assist"),
                cs: st("minion_kill") + st("neutral_minion_kill"),
                gold: st("gold_earned"),
                damage: st("total_damage_dealt_to_champions"),
                // Not in OP.GG's match list.
                vision: 0,
                items,
                spells: [spells.first().copied().unwrap_or(0), spells.get(1).copied().unwrap_or(0)],
            };
            let qid = queue_id(game_type);
            let mode = if game_type == "BRAWL" { "BRAWL" } else { game_type };
            let allowed = game_type != "CUSTOM" && profile::allowed(&json!({ "gameMode": mode, "queueId": qid }), line.champion_id);
            let created = iso_ms(text(g, "created_at")).unwrap_or(0);
            allowed.then(|| MatchLine {
                // OP.GG's game ids are strings; the start time is unique per player.
                game_id: created,
                queue_id: qid,
                game_mode: game_type.to_string(),
                created,
                duration: int(g, "game_length_second"),
                result: match text(p, "/stats/result") {
                    "WIN" => "win",
                    "LOSE" => "loss",
                    _ => "remake",
                }
                .to_string(),
                line,
                lane_opponent: None,
                enemies: Vec::new(),
                lp_change: None,
            })
        })
        .collect();
    out.sort_by(|a, b| b.created.cmp(&a.created));
    out
}

/// Your profile from OP.GG. `region` is OP.GG's code ("na", "euw"…).
pub async fn load(opgg: &OpGg, riot_id: &str, region: &str) -> Result<MyProfile> {
    let (name, tag) = split_riot_id(riot_id)?;
    let args = |fields: &[&str]| {
        json!({ "game_name": name, "tag_line": tag, "region": region, "lang": "en_US", "desired_output_fields": fields })
    };
    let mut match_args = args(MATCH_FIELDS);
    match_args["limit"] = json!(MATCH_LIMIT);
    let (prof, games) = tokio::join!(
        opgg.call_tool("lol_get_summoner_profile", args(PROFILE_FIELDS)),
        opgg.call_tool("lol_list_summoner_matches", match_args),
    );
    let prof = parse_compact(&prof.with_context(|| format!("couldn't find {riot_id} ({}) on OP.GG", region.to_uppercase()))?)
        .context("couldn't read OP.GG's profile")?;
    let mut p = parse_profile(&prof);
    match games.and_then(|t| parse_compact(&t).context("couldn't read OP.GG's match list")) {
        Ok(g) => p.matches = parse_matches(&g, &p.puuid),
        Err(e) => p.error = Some(format!("match history: {e:#}")),
    }
    p.insights = profile::insights(&p.matches);
    p.modes = profile::modes(&p.matches);
    Ok(p)
}

/// Has OP.GG fetch the player's latest games and rank from Riot (like the
/// "Update" button on op.gg), waits for it, then loads the profile again.
///
/// The MCP tools have no update call, and op.gg's website API
/// (`lol-web-api.op.gg`) couldn't be reached from Dom's PC in October 2026.
/// But looking up a stale profile makes OP.GG update it in the background:
/// a lookup at 02:02 UTC returned `updated_at` from three days earlier, and
/// the next one, a few minutes later, had it at 02:02 with the new level. So
/// this looks the player up and polls until `updated_at` moves past
/// `updated_at` (what the page showed). OP.GG allows one update every two
/// minutes (`renewable_at`), so a profile updated since then is as new as it gets.
pub async fn renew(opgg: &OpGg, riot_id: &str, region: &str, updated_at: Option<i64>) -> Result<MyProfile> {
    let (name, tag) = split_riot_id(riot_id)?;
    let args = json!({ "game_name": name, "tag_line": tag, "region": region, "lang": "en_US",
                       "desired_output_fields": ["data.summoner.{updated_at}"] });
    let now = || std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0);
    let started = std::time::Instant::now();
    loop {
        let answer = opgg.call_tool("lol_get_summoner_profile", args.clone()).await?;
        let s = parse_compact(&answer).context("couldn't read OP.GG's profile")?;
        let latest = iso_ms(text(&s, "/data/summoner/updated_at"));
        let newer = matches!((latest, updated_at), (Some(l), Some(u)) if l > u);
        // Updated in the last two minutes: OP.GG won't update again yet.
        let fresh = latest.is_some_and(|l| now() - l < 120_000);
        if newer || fresh || updated_at.is_none() {
            break;
        }
        if started.elapsed() > RENEW_WAIT {
            bail!("OP.GG hasn't finished updating yet; try Refresh in a minute");
        }
        tokio::time::sleep(RENEW_POLL).await;
    }
    load(opgg, riot_id, region).await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture(name: &str) -> Value {
        let text = std::fs::read_to_string(format!("{}/tests/fixtures/{name}", env!("CARGO_MANIFEST_DIR"))).unwrap();
        parse_compact(&text).unwrap()
    }

    #[test]
    fn riot_ids_and_regions() {
        assert_eq!(split_riot_id(" urbanfox#8108 ").unwrap(), ("urbanfox", "8108"));
        assert_eq!(split_riot_id("a#b#NA1").unwrap(), ("a#b", "NA1"));
        assert!(split_riot_id("urbanfox").is_err());
        assert!(split_riot_id("#NA1").is_err());
        assert_eq!(region_from_client("NA"), "na");
        assert_eq!(region_from_client("EUW"), "euw");
        assert_eq!(region_from_client("LA1"), "lan");
        assert_eq!(region_from_client("OC1"), "oce");
    }

    #[test]
    fn iso_times() {
        assert_eq!(iso_ms("1970-01-01T00:00:00Z"), Some(0));
        assert_eq!(iso_ms("2026-10-22T15:34:37+09:00"), Some(1_792_650_877_000));
        assert_eq!(iso_ms("2026-10-22T06:34:37.123Z"), Some(1_792_650_877_000));
        assert_eq!(iso_ms("2026-10-21T23:34:37-07:00"), Some(1_792_650_877_000));
        assert_eq!(iso_ms(""), None);
    }

    #[test]
    fn profile_from_opgg() {
        let p = parse_profile(&fixture("opgg_mcp_summoner_profile.txt"));
        assert_eq!((p.name.as_str(), p.icon_id, p.level), ("urbanfox#8108", 7126, 368));
        assert_eq!(p.solo, Some(RankLine { tier: "GOLD".into(), division: "III".into(), lp: 30, wins: 20, losses: 15 }));
        assert_eq!(p.flex, None);
        assert_eq!(p.updated_at, iso_ms("2026-10-20T17:17:46+09:00"));
        assert_eq!(p.source, "opgg");
        let lp: Vec<_> = p.lp_history.solo.iter().map(|h| (h.tier.as_str(), h.division.as_str(), h.lp)).collect();
        assert_eq!(lp, [("SILVER", "II", 90), ("GOLD", "III", 30)]);
        assert_eq!(p.lp_history.solo[1].at, iso_ms("2026-10-20T17:17:46+09:00").unwrap());
    }

    #[test]
    fn matches_from_opgg() {
        let puuid = "SbzFP-Mo9S2DFcbL5Y8A2wKL0WtoJN4Y-tSzCRGBF0RV8DT4kws8PqM59eavgBXgSeXKIkKs6ifslQ";
        let m = parse_matches(&fixture("opgg_mcp_summoner_matches.txt"), puuid);
        assert_eq!(m.len(), 5);
        assert!(m.windows(2).all(|w| w[0].created >= w[1].created));
        let first = &m[0];
        assert_eq!((first.line.champion_id, first.result.as_str(), first.duration), (157, "loss", 1163));
        assert_eq!((first.line.kills, first.line.deaths, first.line.assists, first.line.level), (2, 8, 0, 15));
        assert_eq!((first.line.cs, first.line.gold, first.line.damage), (151, 13022, 9838));
        assert_eq!(first.line.items, vec![3006, 1043, 3031, 6673, 6333, 1053, 0]);
        assert_eq!(first.line.spells, [4, 14]);
        assert_eq!((first.queue_id, first.game_mode.as_str()), (0, "NORMAL"));
        assert_eq!(m.iter().filter(|m| m.result == "win").count(), 3);
    }
}
