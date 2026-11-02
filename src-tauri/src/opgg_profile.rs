//! Your profile from OP.GG, for when the League client isn't running: rank
//! and recent games looked up by Riot ID and region, plus OP.GG's "Update"
//! button.
//!
//! Rank, level and icon come from the MCP tool `lol_get_summoner_profile`,
//! games from `lol_list_summoner_matches` (at most 20, only your own line in
//! each, so there are no enemy or lane-opponent stats). OP.GG only knows what
//! it fetched from Riot at its last update (`updated_at`), which can be days
//! old; `renew` gets it to fetch again, like the button on op.gg. A game's
//! full scoreboard comes from `lol_get_summoner_game_detail` (`load_game`).

use crate::lp_history::{LpHistory, LpPoint};
use crate::opgg::{parse_compact, OpGg};
use crate::postgame::{self, PlayerLine, PostGame, PostPlayer, PostTeam};
use crate::profile::{self, MatchLine, MyProfile};
use crate::scout::RankLine;
use crate::util::{flag, int, list, text};
use anyhow::{anyhow, bail, Context, Result};
use serde::{Deserialize, Serialize};
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

const GAME_FIELDS: &[&str] = &[
    "data.game_detail.{created_at,game_length_second,game_map,game_type,id}",
    "data.game_detail.teams[].{key}",
    "data.game_detail.teams[].game_stat.{is_win,baron_kill,dragon_kill,tower_kill}",
    "data.game_detail.teams[].participants[].summoner.{game_name,puuid,tagline}",
    "data.game_detail.teams[].participants[].{champion_id,items[],position,spells[],team_key}",
    "data.game_detail.teams[].participants[].stats.{assist,champion_level,death,gold_earned,kill,minion_kill,neutral_minion_kill,result,total_damage_dealt_to_champions}",
];

/// A game in OP.GG's match list, for loading its full scoreboard (`load_game`).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct OpggGame {
    pub id: String,
    /// As OP.GG gave it (ISO-8601); its game detail tool needs it with the id.
    pub created_at: String,
}

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
            let line = player_line(p);
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
                result: result(p).to_string(),
                line,
                lane_opponent: None,
                enemies: Vec::new(),
                teams: Vec::new(),
                lp_change: None,
                opgg_game: Some(OpggGame { id: text(g, "id").to_string(), created_at: text(g, "created_at").to_string() }),
            })
        })
        .collect();
    out.sort_by(|a, b| b.created.cmp(&a.created));
    out
}

/// One player's numbers from OP.GG's match list or game detail.
fn player_line(p: &Value) -> PlayerLine {
    let st = |k: &str| int(p, &format!("/stats/{k}"));
    let mut items: Vec<i64> = list(p, "items").iter().filter_map(Value::as_i64).take(6).collect();
    // Six item slots plus the trinket, like the client's lines; OP.GG
    // doesn't say which is the trinket, so that slot stays empty.
    items.resize(7, 0);
    let spells: Vec<i64> = list(p, "spells").iter().filter_map(Value::as_i64).collect();
    PlayerLine {
        champion_id: int(p, "champion_id"),
        level: st("champion_level"),
        kills: st("kill"),
        deaths: st("death"),
        assists: st("assist"),
        cs: st("minion_kill") + st("neutral_minion_kill"),
        gold: st("gold_earned"),
        damage: st("total_damage_dealt_to_champions"),
        // OP.GG has no vision score.
        vision: 0,
        items,
        spells: [spells.first().copied().unwrap_or(0), spells.get(1).copied().unwrap_or(0)],
    }
}

/// "win", "loss" or "remake" for one of OP.GG's participants.
fn result(p: &Value) -> &'static str {
    match text(p, "/stats/result") {
        "WIN" => "win",
        "LOSE" => "loss",
        _ => "remake",
    }
}

/// OP.GG's position as the scoreboard's ("MID" → "mid").
fn position(s: &str) -> Option<&'static str> {
    match s {
        "TOP" => Some("top"),
        "JUNGLE" => Some("jungle"),
        "MID" => Some("mid"),
        "ADC" => Some("adc"),
        "SUPPORT" => Some("support"),
        _ => None,
    }
}

/// The full scoreboard of a game from `lol_get_summoner_game_detail`, seen
/// from `puuid`'s side (like `postgame::parse` for the client's record).
/// OP.GG has no vision score or gold timeline, so those stay empty.
pub fn parse_game(v: &Value, puuid: &str, queue_name: &str) -> Option<PostGame> {
    let g = v.pointer("/data/game_detail")?;
    let raw_teams = list(g, "teams");
    let me = raw_teams.iter().flat_map(|t| list(t, "participants")).find(|p| text(p, "/summoner/puuid") == puuid)?;
    let mut teams: Vec<PostTeam> = raw_teams
        .iter()
        .map(|t| {
            let parts = list(t, "participants");
            // Positions only mean something in a 5v5 on Summoner's Rift, one player in each.
            let lanes: Vec<Option<&'static str>> = parts.iter().map(|p| position(text(p, "position"))).collect();
            let mut distinct: Vec<_> = lanes.iter().flatten().collect();
            distinct.sort();
            distinct.dedup();
            let rift = text(g, "game_map") == "SUMMONERS_RIFT" && raw_teams.len() == 2 && distinct.len() == 5;
            let mut players: Vec<PostPlayer> = parts
                .iter()
                .zip(lanes)
                .map(|(p, lane)| {
                    let id = text(p, "/summoner/puuid").to_string();
                    let name = match (text(p, "/summoner/game_name"), text(p, "/summoner/tagline")) {
                        ("", _) => None,
                        (n, "") => Some(n.to_string()),
                        (n, t) => Some(format!("{n}#{t}")),
                    };
                    let is_me = id == puuid;
                    PostPlayer { puuid: id, name, is_me, position: lane.filter(|_| rift), client_grade: None, line: player_line(p) }
                })
                .collect();
            // Top to support, so each row sits across from its lane opponent.
            players.sort_by_key(|p| postgame::lane_rank(p.position));
            PostTeam {
                team_id: if text(t, "key") == "RED" { 200 } else { 100 },
                win: flag(t, "/game_stat/is_win"),
                is_mine: players.iter().any(|p| p.is_me),
                kills: players.iter().map(|p| p.line.kills).sum(),
                gold: players.iter().map(|p| p.line.gold).sum(),
                dragons: int(t, "/game_stat/dragon_kill"),
                barons: int(t, "/game_stat/baron_kill"),
                towers: int(t, "/game_stat/tower_kill"),
                players,
            }
        })
        .collect();
    teams.sort_by_key(|t| !t.is_mine);
    let game_type = text(g, "game_type");
    let created = iso_ms(text(g, "created_at")).unwrap_or(0);
    Some(PostGame {
        // The same id as the game's `MatchLine`.
        game_id: created,
        queue_id: queue_id(game_type),
        queue_name: queue_name.to_string(),
        game_mode: game_type.to_string(),
        duration: int(g, "game_length_second"),
        result: result(me).to_string(),
        teams,
        gold_lead: Vec::new(),
        lp_change: None,
        no_vision: true,
    })
}

/// One game's full scoreboard from OP.GG (`region` is OP.GG's code), seen from `puuid`'s side.
pub async fn load_game(opgg: &OpGg, region: &str, game: &OpggGame, puuid: &str, queue_name: &str) -> Result<PostGame> {
    let args = json!({
        "region": region, "lang": "en_US", "game_id": game.id, "created_at": game.created_at, "desired_output_fields": GAME_FIELDS,
    });
    let answer = opgg.call_tool("lol_get_summoner_game_detail", args).await.context("couldn't load this game from OP.GG")?;
    let v = parse_compact(&answer).context("couldn't read OP.GG's game")?;
    parse_game(&v, puuid, queue_name).ok_or_else(|| anyhow!("OP.GG's record of this game doesn't list this player"))
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
        parse_compact(&crate::util::fixture(name)).unwrap()
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
        let g = first.opgg_game.as_ref().unwrap();
        assert_eq!((g.id.as_str(), g.created_at.as_str()), ("eq3KyFixtgU9bkMbEfF5ClYI4Gc4d4Sb6LErihpUUC0=", "2026-10-22T15:34:37+09:00"));
    }

    #[test]
    fn game_from_opgg() {
        let v = fixture("opgg_mcp_game_detail.txt");
        // Seen from the red side: their team comes first.
        let g = parse_game(&v, "puuid-7", "Normal").unwrap();
        assert_eq!((g.game_id, g.queue_id, g.game_mode.as_str(), g.duration), (iso_ms("2026-11-02T06:35:59+09:00").unwrap(), 0, "NORMAL", 1705));
        assert_eq!((g.result.as_str(), g.no_vision), ("win", true));
        let [mine, theirs] = &g.teams[..] else { panic!("two teams") };
        assert_eq!((mine.team_id, mine.is_mine, mine.win, theirs.team_id, theirs.win), (200, true, true, 100, false));
        assert_eq!((mine.dragons, mine.barons, mine.towers, mine.kills), (4, 1, 14, 39));
        // Top to support on both sides.
        let order = |t: &PostTeam| t.players.iter().map(|p| p.position.unwrap()).collect::<Vec<_>>();
        assert_eq!(order(mine), ["top", "jungle", "mid", "adc", "support"]);
        assert_eq!(order(theirs), order(mine));
        let me = &mine.players[0];
        assert_eq!((me.is_me, me.name.as_deref(), me.line.champion_id), (true, Some("Player 7#NA7"), 24));
        assert_eq!((me.line.kills, me.line.deaths, me.line.assists, me.line.cs), (9, 7, 2, 164));
        assert_eq!(me.line.items, vec![3157, 3091, 2510, 3115, 3153, 6333, 0]);
        assert!(g.teams.iter().flat_map(|t| &t.players).filter(|p| p.is_me).count() == 1);
        // From the blue side, a loss.
        assert_eq!(parse_game(&v, "puuid-2", "Normal").unwrap().result, "loss");
        assert!(parse_game(&v, "someone-else", "Normal").is_none());
    }
}
