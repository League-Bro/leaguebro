//! Champion recommendations (runes, summoner spells, skill order, items)
//! from OP.GG.
//!
//! First choice is the JSON behind op.gg's champion pages (`WEB_API`, ~0.2 s;
//! `web_to_mcp` reshapes it). If that fails, the public MCP endpoint
//! (https://mcp-api.op.gg/mcp) has the same numbers but takes ~3.5 s.
//!
//! The MCP endpoint speaks JSON-RPC over HTTP. Tool results come back as
//! a compact text format rather than JSON:
//!
//! ```text
//! class Runes: id,primary_page_id,primary_rune_ids
//! class Data: runes
//!
//! Root(Data(Runes(8112,8100,[8112,8139])))
//! ```
//!
//! `parse_compact` turns that into ordinary JSON objects using the `class`
//! headers to name each positional argument.
//!
//! Answers are saved on disk (`%LOCALAPPDATA%\dev.dom.leaguebro\opgg`), one
//! file per champion + position + mode, and expire on the patch cycle
//! (`expires_at`): a day at a time for the week after each patch's notes come
//! out, then a week at a time, and always when the next notes are due.

use crate::util::{flag, float, get_json, int, ints, list, text, web_client, CDRAGON_GAME_DATA};
use anyhow::{anyhow, bail, Context, Result};
use crate::cache::{now_secs, CacheUsage, DiskCache, Generation};
use crate::lcu::Lcu;
use crate::patch::{notes_releases_around, DAY_SECS};
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::Mutex;

/// The JSON behind op.gg's champion pages: ~0.2 s per champion. Tried first.
pub const WEB_API: &str = "https://lol-api-champion.op.gg/api/global/champions";
/// The MCP endpoint: the same numbers but ~3.5 s per champion. The fallback.
pub const ENDPOINT: &str = "https://mcp-api.op.gg/mcp";
/// The website API is quick, so a slow answer means trouble: give up and ask
/// the MCP endpoint instead of waiting the full `http` timeout.
const WEB_TIMEOUT: Duration = Duration::from_secs(5);
/// How many 4th/5th/6th item options to keep (what the MCP tool returns).
const LATE_ITEM_OPTIONS: usize = 3;
/// Below this many games OP.GG's numbers are mostly noise (e.g. an off-role
/// pick), so League Bro falls back to the client's own recommendation.
pub const MIN_GAMES: i64 = 20;
/// 4th–6th item options seen in fewer games than this are skipped.
const MIN_LATE_ITEM_GAMES: i64 = 10;
/// Bump when `Recommendation` or `extract` changes, so saved answers are
/// fetched again instead of read in an old shape.
const CACHE_FORMAT: u32 = 3;
/// Rune pages, spell pairs, core builds and boots offered to pick from (the top one included).
const PICK_OPTIONS: usize = 3;
/// How long after a patch's notes come out OP.GG answers are kept for only a
/// day, while the new patch's numbers settle. After that, a week.
const SETTLING_SECS: u64 = 7 * DAY_SECS;

// ---------- compact format parser ----------

struct Parser<'a> {
    s: &'a [u8],
    i: usize,
    classes: &'a HashMap<String, Vec<String>>,
}

impl<'a> Parser<'a> {
    fn ws(&mut self) {
        while self.i < self.s.len() && (self.s[self.i] as char).is_whitespace() {
            self.i += 1;
        }
    }

    fn peek(&mut self) -> Option<u8> {
        self.ws();
        self.s.get(self.i).copied()
    }

    fn expect(&mut self, c: u8) -> Result<()> {
        if self.peek() == Some(c) {
            self.i += 1;
            Ok(())
        } else {
            bail!("expected '{}' at byte {}", c as char, self.i)
        }
    }

    /// Parses comma-separated values until `close`.
    fn list(&mut self, close: u8) -> Result<Vec<Value>> {
        let mut out = Vec::new();
        if self.peek() == Some(close) {
            self.i += 1;
            return Ok(out);
        }
        loop {
            out.push(self.value()?);
            match self.peek() {
                Some(b',') => self.i += 1,
                Some(c) if c == close => {
                    self.i += 1;
                    return Ok(out);
                }
                _ => bail!("expected ',' or '{}' at byte {}", close as char, self.i),
            }
        }
    }

    fn string(&mut self) -> Result<Value> {
        // Strings use JSON escaping; find the closing quote and let serde decode it.
        let start = self.i;
        self.i += 1;
        while self.i < self.s.len() {
            match self.s[self.i] {
                b'\\' => self.i += 2,
                b'"' => {
                    self.i += 1;
                    let raw = std::str::from_utf8(&self.s[start..self.i])?;
                    return Ok(serde_json::from_str(raw)?);
                }
                _ => self.i += 1,
            }
        }
        bail!("unterminated string")
    }

    fn value(&mut self) -> Result<Value> {
        match self.peek() {
            None => bail!("unexpected end of input"),
            Some(b'"') => self.string(),
            Some(b'[') => {
                self.i += 1;
                Ok(Value::Array(self.list(b']')?))
            }
            Some(c) if c == b'-' || c.is_ascii_digit() => {
                let start = self.i;
                self.i += 1;
                while self.i < self.s.len()
                    && matches!(self.s[self.i], b'0'..=b'9' | b'.' | b'e' | b'E' | b'+' | b'-')
                {
                    self.i += 1;
                }
                let raw = std::str::from_utf8(&self.s[start..self.i])?;
                Ok(serde_json::from_str(raw).with_context(|| format!("bad number {raw}"))?)
            }
            Some(c) if c.is_ascii_alphabetic() || c == b'_' => {
                let start = self.i;
                while self.i < self.s.len() && (self.s[self.i].is_ascii_alphanumeric() || self.s[self.i] == b'_') {
                    self.i += 1;
                }
                let name = std::str::from_utf8(&self.s[start..self.i])?.to_string();
                match name.as_str() {
                    "true" => return Ok(Value::Bool(true)),
                    "false" => return Ok(Value::Bool(false)),
                    "null" | "None" => return Ok(Value::Null),
                    _ => {}
                }
                self.expect(b'(')?;
                let args = self.list(b')')?;
                match self.classes.get(&name) {
                    Some(fields) if fields.len() == args.len() => {
                        let mut obj = Map::new();
                        for (f, v) in fields.iter().zip(args) {
                            obj.insert(f.clone(), v);
                        }
                        Ok(Value::Object(obj))
                    }
                    // Unknown shape: keep the values so nothing is silently lost.
                    _ => Ok(json!({ "_class": name, "_args": args })),
                }
            }
            Some(c) => bail!("unexpected '{}' at byte {}", c as char, self.i),
        }
    }
}

pub fn parse_compact(text: &str) -> Result<Value> {
    let mut classes = HashMap::new();
    let mut body = String::new();
    for line in text.lines() {
        if let Some(rest) = line.strip_prefix("class ") {
            if let Some((name, fields)) = rest.split_once(':') {
                let fields = fields.split(',').map(|f| f.trim().to_string()).filter(|f| !f.is_empty()).collect();
                classes.insert(name.trim().to_string(), fields);
                continue;
            }
        }
        body.push_str(line);
        body.push('\n');
    }
    let mut p = Parser { s: body.as_bytes(), i: 0, classes: &classes };
    let v = p.value()?;
    if p.peek().is_some() {
        bail!("trailing data at byte {}", p.i);
    }
    Ok(v)
}

// ---------- recommendation model ----------

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct RuneRec {
    pub primary_style_id: i64,
    pub sub_style_id: i64,
    /// Primary (4) + secondary (2) + stat shards (3), the order the client expects.
    pub perk_ids: Vec<i64>,
    pub keystone_name: String,
    pub primary_name: String,
    pub secondary_name: String,
    pub perk_names: Vec<String>,
    pub games: i64,
    pub win_rate: f64,
    /// Share of the champion's games that used this page (0–1).
    pub pick_rate: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct ItemSet {
    pub ids: Vec<i64>,
    pub names: Vec<String>,
    pub games: i64,
    pub win_rate: f64,
    /// Share of the champion's games that bought this (0–1).
    pub pick_rate: f64,
}

/// How often a choice (skill order, spells) was picked and how it did.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct PickStats {
    pub games: i64,
    pub win_rate: f64,
    pub pick_rate: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct Recommendation {
    pub champion_id: i64,
    pub position: String,
    pub game_mode: String,
    pub runes: Option<RuneRec>,
    pub spells: Vec<i64>,
    pub spell_stats: Option<PickStats>,
    /// Ability max priority, e.g. ["Q", "W", "E"].
    pub skill_max: Vec<String>,
    pub skill_stats: Option<PickStats>,
    /// "AD", "AP" or "BOTH" (empty when OP.GG doesn't say).
    pub damage_type: String,
    /// Ability to level at each champion level (1-based index = level).
    pub skill_order: Vec<String>,
    pub starter: Option<ItemSet>,
    pub boots: Option<ItemSet>,
    pub core: Option<ItemSet>,
    /// Popular options for the 4th, 5th and 6th item.
    pub later: Vec<Vec<ItemSet>>,
    /// Every 4th–6th item option with enough games (one entry per item, most
    /// played first): what `situational` picks from for this game.
    #[serde(default)]
    pub situational_pool: Vec<ItemSet>,
    /// Full build in purchase order (core + boots + top later picks), for the overlay.
    pub build_order: Vec<i64>,
    /// Games behind the rune page; small numbers mean a rare pick.
    pub games: i64,
    pub source: String,
    /// Alternatives to pick from, most played first; index 0 is what's shown
    /// above by default. One entry when the source only gives the top pick (MCP).
    pub rune_options: Vec<RuneRec>,
    pub spell_options: Vec<SpellOption>,
    pub core_options: Vec<ItemSet>,
    pub boots_options: Vec<ItemSet>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct SpellOption {
    pub ids: Vec<i64>,
    pub games: i64,
    pub win_rate: f64,
    pub pick_rate: f64,
}

/// Which option the player picked in each section (index into the `*_options` lists).
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct RecChoice {
    pub runes: usize,
    pub spells: usize,
    pub core: usize,
    pub boots: usize,
    /// Use OP.GG's build against the lane opponent instead of the overall one
    /// (the indexes then pick from the matchup's options). Champ select only.
    #[serde(default)]
    pub matchup: bool,
}

/// The recommendation with the picked options in place of the top ones, so
/// rune import, spells, the shop build and the overlay all follow the pick.
/// Out-of-range picks keep the top option. `games` stays the top page's, since
/// it gates whether OP.GG's data is used at all.
pub fn with_choice(rec: &Recommendation, choice: &RecChoice) -> Recommendation {
    let mut r = rec.clone();
    if let Some(runes) = rec.rune_options.get(choice.runes) {
        r.runes = Some(runes.clone());
    }
    if let Some(s) = rec.spell_options.get(choice.spells) {
        r.spells = s.ids.clone();
        r.spell_stats = Some(PickStats { games: s.games, win_rate: s.win_rate, pick_rate: s.pick_rate });
    }
    if let Some(core) = rec.core_options.get(choice.core) {
        r.core = Some(core.clone());
    }
    if let Some(boots) = rec.boots_options.get(choice.boots) {
        r.boots = Some(boots.clone());
    }
    r.build_order = build_order(r.core.as_ref(), r.boots.as_ref(), &r.later);
    r
}

/// Keeps the top option, plus any others with enough games to mean something.
fn worth_offering<T>(options: Vec<T>, games: impl Fn(&T) -> i64) -> Vec<T> {
    options.into_iter().enumerate().filter(|(i, o)| *i == 0 || games(o) >= MIN_GAMES).map(|(_, o)| o).collect()
}

fn rune_rec(r: &Value) -> Option<RuneRec> {
    let primary = ints(r, "primary_rune_ids");
    let secondary = ints(r, "secondary_rune_ids");
    let shards = ints(r, "stat_mod_ids");
    if primary.len() != 4 || secondary.len() != 2 || shards.len() != 3 {
        return None;
    }
    let mut names = strs(r, "primary_rune_names");
    names.extend(strs(r, "secondary_rune_names"));
    Some(RuneRec {
        primary_style_id: int(r, "primary_page_id"),
        sub_style_id: int(r, "secondary_page_id"),
        keystone_name: strs(r, "primary_rune_names").first().cloned().unwrap_or_default(),
        primary_name: text(r, "primary_page_name").to_string(),
        secondary_name: text(r, "secondary_page_name").to_string(),
        perk_names: names,
        games: int(r, "play"),
        win_rate: win_rate(r),
        pick_rate: pick_rate(r),
        perk_ids: primary.into_iter().chain(secondary).chain(shards).collect(),
    })
}

fn spell_option(s: &Value) -> Option<SpellOption> {
    let ids = ints(s, "ids");
    (ids.len() == 2).then(|| SpellOption { ids, games: int(s, "play"), win_rate: win_rate(s), pick_rate: pick_rate(s) })
}

fn strs(v: &Value, k: &str) -> Vec<String> {
    list(v, k).iter().map(|x| x.as_str().map_or_else(|| x.to_string(), str::to_string)).collect()
}
fn win_rate(v: &Value) -> f64 {
    let games = int(v, "play");
    if games > 0 {
        int(v, "win") as f64 / games as f64
    } else {
        0.0
    }
}

fn pick_rate(v: &Value) -> f64 {
    float(v, "pick_rate")
}
fn pick_stats(v: &Value) -> Option<PickStats> {
    let games = int(v, "play");
    (games > 0).then(|| PickStats { games, win_rate: win_rate(v), pick_rate: pick_rate(v) })
}

fn item_set(v: &Value) -> Option<ItemSet> {
    let ids = ints(v, "ids");
    if ids.is_empty() {
        return None;
    }
    Some(ItemSet { names: strs(v, "ids_names"), games: int(v, "play"), win_rate: win_rate(v), pick_rate: pick_rate(v), ids })
}

/// Purchase order for the overlay: first core item, boots, rest of the core,
/// then the most popular 4th/5th/6th picks, without repeats.
pub fn build_order(core: Option<&ItemSet>, boots: Option<&ItemSet>, later: &[Vec<ItemSet>]) -> Vec<i64> {
    let mut out: Vec<i64> = Vec::new();
    let push = |id: i64, out: &mut Vec<i64>| {
        if !out.contains(&id) {
            out.push(id);
        }
    };
    let core_ids = core.map(|c| c.ids.clone()).unwrap_or_default();
    if let Some(first) = core_ids.first() {
        push(*first, &mut out);
    }
    for b in boots.map(|b| b.ids.clone()).unwrap_or_default() {
        push(b, &mut out);
    }
    for c in core_ids.iter().skip(1) {
        push(*c, &mut out);
    }
    for options in later {
        // Most popular option not already in the build, ignoring picks with
        // too few games to mean anything.
        if let Some(id) = options
            .iter()
            .filter(|s| s.games >= MIN_LATE_ITEM_GAMES)
            .flat_map(|s| s.ids.iter())
            .find(|id| !out.contains(id))
        {
            push(*id, &mut out);
        }
    }
    out
}

/// The website's full list of 4th–6th items (`situational_items`), or the MCP
/// tool's few `later` options; most played first, rarely bought ones dropped.
fn situational_pool(data: &Value, later: &[Vec<ItemSet>]) -> Vec<ItemSet> {
    let mut pool: Vec<ItemSet> = match list(data, "situational_items") {
        [] => {
            let mut out: Vec<ItemSet> = Vec::new();
            for s in later.iter().flatten() {
                if !out.iter().any(|o| o.ids == s.ids) {
                    out.push(s.clone());
                }
            }
            out
        }
        all => all.iter().filter_map(item_set).collect(),
    };
    pool.retain(|s| s.games >= MIN_LATE_ITEM_GAMES);
    pool.sort_by(|a, b| b.games.cmp(&a.games));
    pool
}

/// Extracts a Recommendation from a parsed lol_get_champion_analysis result.
pub fn extract(parsed: &Value, champion_id: i64, position: &str, game_mode: &str) -> Result<Recommendation> {
    let data = parsed.get("data").ok_or_else(|| anyhow!("OP.GG response has no data"))?;
    let runes = data.get("runes").and_then(rune_rec);
    // `<key>_options` comes from the website API; the MCP tool has only the top pick.
    let options = |key: &str| -> Vec<Value> {
        let all = list(data, &format!("{key}_options"));
        if all.is_empty() { data.get(key).cloned().into_iter().collect() } else { all.to_vec() }
    };
    let rune_options = worth_offering(options("runes").iter().filter_map(rune_rec).collect(), |r: &RuneRec| r.games);
    let spell_options = worth_offering(options("summoner_spells").iter().filter_map(spell_option).collect(), |s: &SpellOption| s.games);
    let core_options = worth_offering(options("core_items").iter().filter_map(item_set).collect(), |s: &ItemSet| s.games);
    let boots_options = worth_offering(options("boots").iter().filter_map(item_set).collect(), |s: &ItemSet| s.games);
    let spells = data.get("summoner_spells").map(|s| ints(s, "ids")).unwrap_or_default();
    let masteries = data.get("skill_masteries");
    let skill_max = masteries.map(|m| strs(m, "ids")).unwrap_or_default();
    let skill_stats = masteries.and_then(pick_stats);
    let skill_order = data
        .get("skills")
        .map(|s| strs(s, "order"))
        .filter(|o| !o.is_empty())
        .or_else(|| {
            // ARAM responses carry the order only inside skill_masteries.builds.
            masteries.and_then(|m| list(m, "builds").first()).map(|b| strs(b, "order"))
        })
        .unwrap_or_default();
    let set = |k: &str| data.get(k).and_then(item_set);
    let later: Vec<Vec<ItemSet>> = ["fourth_items", "fifth_items", "sixth_items"]
        .iter()
        .map(|k| list(data, k).iter().filter_map(item_set).collect())
        .filter(|v: &Vec<ItemSet>| !v.is_empty())
        .collect();
    let core = set("core_items");
    let boots = set("boots");
    let games = runes.as_ref().map(|r| r.games).unwrap_or(0);
    Ok(Recommendation {
        champion_id,
        position: position.to_string(),
        game_mode: game_mode.to_string(),
        build_order: build_order(core.as_ref(), boots.as_ref(), &later),
        runes,
        spells,
        spell_stats: data.get("summoner_spells").and_then(pick_stats),
        skill_max,
        skill_stats,
        damage_type: text(data, "damage_type").to_string(),
        skill_order,
        starter: set("starter_items"),
        boots,
        core,
        situational_pool: situational_pool(data, &later),
        later,
        games,
        source: "OP.GG".into(),
        rune_options,
        spell_options,
        core_options,
        boots_options,
    })
}

// ---------- lane matchups ----------

/// How your champion does against one lane opponent, from OP.GG.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct Matchup {
    pub champion_id: i64,
    pub opponent_id: i64,
    pub position: String,
    /// Your champion's games and win rate against the opponent in this lane
    /// (0 games when OP.GG has none).
    pub games: i64,
    pub win_rate: f64,
    /// OP.GG's runes, spells and build in this matchup only. Its `games` is
    /// the matchup's top rune page, so small numbers mean too little data.
    pub rec: Option<Recommendation>,
    pub tip: Option<MatchupTip>,
    /// "AD", "AP" or "BOTH" (empty when the League client can't say).
    pub opponent_damage_type: String,
}

/// OP.GG's lane guide for the matchup (MCP tool `lol_get_lane_matchup_guide`).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct MatchupTip {
    pub text: String,
    /// Who usually comes out of lane ahead / gets more solo kills:
    /// "you", "them" or "even" (empty when OP.GG doesn't say).
    pub lane_advantage: String,
    pub solo_kills: String,
    /// OP.GG's suggested approach: "aggressive", "even" or "defensive".
    pub play_style: String,
}

/// Reads a matchup from the website API's answers (fetched with
/// `?target_champion=`, same shape as the champion's own) or from the MCP
/// guide, whose `data` has that shape too. The head-to-head record is the
/// opponent's entry in `counters`, which holds your champion's wins.
pub fn parse_matchup(
    main: &Value,
    builds: &Value,
    damage_type: &str,
    guide: Option<&Value>,
    champion_id: i64,
    opponent_id: i64,
    position: &str,
    game_mode: &str,
) -> Result<Matchup> {
    let rec = extract(&web_to_mcp(main, builds, damage_type)?, champion_id, position, game_mode)?;
    let h2h = list(main, "/data/counters").iter().find(|c| int(c, "champion_id") == opponent_id);
    Ok(Matchup {
        champion_id,
        opponent_id,
        position: position.to_string(),
        games: h2h.map_or(0, |c| int(c, "play")),
        win_rate: h2h.map_or(0.0, win_rate),
        rec: Some(rec),
        tip: guide.and_then(matchup_tip),
        opponent_damage_type: String::new(),
    })
}

/// The tip and lane read from the MCP guide. OP.GG names the champion that
/// has the edge, or says "EVEN".
pub fn matchup_tip(guide: &Value) -> Option<MatchupTip> {
    let data = guide.get("data")?;
    let (me, them) = (text(guide, "my_champion"), text(guide, "opponent_champion"));
    let side = |key: &str| {
        let who = text(data, key);
        if who.eq_ignore_ascii_case("even") {
            "even"
        } else if !who.is_empty() && who == me {
            "you"
        } else if !who.is_empty() && who == them {
            "them"
        } else {
            ""
        }
        .to_string()
    };
    let tip = MatchupTip {
        text: text(data, "opponent_champion_tip").trim().to_string(),
        lane_advantage: side("lane_advantage_champion"),
        solo_kills: side("lane_solo_kill_advantage_champion"),
        play_style: text(data, "recommended_play_style").to_ascii_lowercase(),
    };
    (!tip.text.is_empty() || !tip.lane_advantage.is_empty()).then_some(tip)
}

// ---------- mapping League's names to OP.GG's ----------

/// OP.GG accepts the champion key in any case, with or without underscores
/// ("MONKEYKING", "Kaisa"); the client's alias is exactly that key.
pub fn champion_param(alias: &str) -> String {
    alias.chars().filter(|c| c.is_ascii_alphanumeric()).collect::<String>().to_uppercase()
}

/// Client position names to OP.GG's. ARAM etc. need a lane value but ignore it.
pub fn position_param(position: &str, game_mode: &str) -> &'static str {
    if game_mode != "ranked" && game_mode != "flex" {
        return "mid";
    }
    match position.to_ascii_lowercase().as_str() {
        "top" => "top",
        "jungle" => "jungle",
        "middle" | "mid" => "mid",
        "bottom" | "bot" | "adc" => "adc",
        "utility" | "support" => "support",
        _ => "",
    }
}

/// Picks OP.GG's game mode from the queue id. None = no runes in this mode (Arena).
pub fn game_mode_for(queue_id: i64, map_id: i64) -> Option<&'static str> {
    match queue_id {
        1700 | 1710 => None,          // Arena
        440 => Some("flex"),
        900 | 1010 | 1900 => Some("urf"),
        1300 => Some("nexus_blitz"),
        _ if map_id == 12 => Some("aram"),
        _ => Some("ranked"),
    }
}

// ---------- website API ----------

/// Reshapes the website API's answers into the MCP tool's `data` shape, so
/// `extract` reads both. The website lists every option (most played first)
/// where the MCP tool gives only the top one, and has no names; the UI names
/// runes and items from the client's own data. `builds` is `/builds`, whose
/// `single_items` depth 4–6 are the MCP tool's 4th–6th item options (same
/// numbers, checked October 2026); Null when it couldn't be fetched.
pub fn web_to_mcp(main: &Value, builds: &Value, damage_type: &str) -> Result<Value> {
    let d = main.get("data").filter(|d| d.is_object()).ok_or_else(|| anyhow!("OP.GG response has no data"))?;
    let mut data = Map::new();
    for key in ["runes", "summoner_spells", "skills", "skill_masteries", "starter_items", "boots", "core_items"] {
        if let Some(top) = list(d, key).first() {
            data.insert(key.into(), top.clone());
        }
    }
    // The alternatives the player can pick instead (`extract` reads `<key>_options`).
    for key in ["runes", "summoner_spells", "boots", "core_items"] {
        data.insert(format!("{key}_options"), list(d, key).iter().take(PICK_OPTIONS).cloned().collect());
    }
    for (depth, key) in [(4, "fourth_items"), (5, "fifth_items"), (6, "sixth_items")] {
        let options = list(builds, "/data/single_items").iter().find(|s| int(s, "depth") == depth).map_or(&[][..], |s| list(s, "items"));
        data.insert(key.into(), options.iter().take(LATE_ITEM_OPTIONS).cloned().collect());
    }
    // All of them for situational picks, each item once (the slot it was bought in most).
    let mut pool: Vec<Value> = Vec::new();
    for s in list(builds, "/data/single_items").iter().filter(|s| (4..=6).contains(&int(s, "depth"))) {
        for it in list(s, "items") {
            match pool.iter_mut().find(|p| ints(p, "ids") == ints(it, "ids")) {
                Some(p) if int(p, "play") >= int(it, "play") => {}
                Some(p) => *p = it.clone(),
                None => pool.push(it.clone()),
            }
        }
    }
    data.insert("situational_items".into(), pool.into());
    data.insert("damage_type".into(), damage_type.into());
    Ok(json!({ "data": data }))
}

/// The client's `tacticalInfo.damageType` ("kMagic") as OP.GG's label ("AP").
pub fn damage_label(tactical: &str) -> &'static str {
    match tactical {
        "kPhysical" => "AD",
        "kMagic" => "AP",
        "kMixed" => "BOTH",
        _ => "",
    }
}

/// OP.GG's lane for the website API: modes without lanes take `none` (the
/// MCP tool wants a lane there instead).
fn web_position<'a>(pos: &'a str, game_mode: &str) -> &'a str {
    if game_mode == "ranked" || game_mode == "flex" { pos } else { "none" }
}

// ---------- MCP client ----------

const FIELDS: &[&str] = &[
    "data.damage_type",
    "data.runes",
    "data.summoner_spells",
    "data.skills",
    "data.skill_masteries",
    "data.starter_items",
    "data.boots",
    "data.core_items",
    "data.fourth_items",
    "data.fifth_items",
    "data.sixth_items",
];

// ---------- cache ----------

/// When an answer fetched at `fetched_at` (seconds since 1970) goes stale.
/// Always at the next patch notes, since OP.GG's numbers move with the patch.
/// Within a week of the latest notes: after a day, so the new patch's stats
/// are picked up as games come in. After that: a week.
pub fn expires_at(fetched_at: u64) -> u64 {
    let (latest, next) = notes_releases_around(fetched_at);
    let settling = latest.is_some_and(|l| fetched_at < l + SETTLING_SECS);
    let keep = if settling { DAY_SECS } else { 7 * DAY_SECS };
    (fetched_at + keep).min(next)
}

/// A saved answer: a `Recommendation`, or a `Matchup` (files starting `rec-m-`).
#[derive(Debug, Clone, Serialize, Deserialize)]
struct Saved<T> {
    format: u32,
    fetched_at: u64,
    rec: T,
}

/// Answers read this session (from disk or OP.GG), by key. `None` means the
/// disk was checked and had nothing, so it isn't read again.
type Answers<T> = Mutex<HashMap<String, Option<Saved<T>>>>;

impl<T> Saved<T> {
    fn is_fresh(&self, now: u64) -> bool {
        self.format == CACHE_FORMAT && now < expires_at(self.fetched_at)
    }

    /// Fetched since the latest patch notes came out. When OP.GG can't be
    /// reached, an expired answer is only used if this holds; an older one
    /// is for a previous patch, and the client's own page is better.
    fn is_this_patch(&self, now: u64) -> bool {
        self.format == CACHE_FORMAT && notes_releases_around(now).0.is_none_or(|l| self.fetched_at >= l)
    }
}

/// "103:mid:ranked" -> "rec-103-mid-ranked.json"
fn rec_file(key: &str) -> String {
    let safe: String = key.chars().map(|c| if c.is_ascii_alphanumeric() { c } else { '-' }).collect();
    format!("rec-{safe}.json")
}

pub struct OpGg {
    http: reqwest::Client,
    session: Mutex<Option<String>>,
    /// Recommendations by champion:position:mode.
    cache: Answers<Recommendation>,
    /// Lane matchups by m:champion:opponent:position:mode.
    matchups: Answers<Matchup>,
    /// One lock per key, held for a whole lookup, so a second caller (e.g. the
    /// rune import at lock-in while the hover lookup is still out) waits for
    /// the answer instead of sending the same request again.
    lookups: Mutex<HashMap<String, Arc<Mutex<()>>>>,
    /// "AD" / "AP" / "BOTH" by champion id, for the website API's answers.
    damage_types: Mutex<HashMap<i64, String>>,
    disk: DiskCache,
    /// Bumped by `clear`, under the `cache` lock.
    generation: Generation,
}

impl OpGg {
    /// `cache_dir` is where answers are saved; `None` keeps them in memory only.
    pub fn new(cache_dir: Option<PathBuf>) -> OpGg {
        OpGg {
            http: web_client(12),
            session: Mutex::new(None),
            cache: Mutex::new(HashMap::new()),
            matchups: Mutex::new(HashMap::new()),
            lookups: Mutex::new(HashMap::new()),
            damage_types: Mutex::new(HashMap::new()),
            disk: DiskCache { dir: cache_dir },
            generation: Generation::default(),
        }
    }

    pub async fn usage(&self) -> CacheUsage {
        let recs = self.cache.lock().await.values().filter(|s| s.is_some()).count();
        let matchups = self.matchups.lock().await.values().filter(|s| s.is_some()).count();
        self.disk.usage(recs + matchups)
    }

    /// Forgets every saved answer, on disk and in memory, so the next champion
    /// asks OP.GG again. A lookup already in progress still returns its answer
    /// but doesn't save it.
    pub async fn clear(&self) -> Result<()> {
        let mut cache = self.cache.lock().await;
        let mut matchups = self.matchups.lock().await;
        self.generation.bump();
        cache.clear();
        matchups.clear();
        self.disk.clear()
    }

    /// Returns the saved answer for `key` while it's fresh, else fetches and
    /// saves a new one. Answers `keep` rejects (e.g. missing a part that may
    /// come back next time) are returned but not saved.
    async fn cached<T, F, Fut>(&self, answers: &Answers<T>, key: String, fetch: F, keep: impl Fn(&T) -> bool) -> Result<T>
    where
        T: Clone + Serialize + serde::de::DeserializeOwned,
        F: FnOnce() -> Fut,
        Fut: std::future::Future<Output = Result<T>>,
    {
        let lookup = self.lookups.lock().await.entry(key.clone()).or_default().clone();
        let _lookup = lookup.lock().await;
        let file = rec_file(&key);
        let now = now_secs();
        let generation = self.generation.current();
        let cached = answers.lock().await.get(&key).cloned();
        let saved = match cached {
            Some(s) => s,
            None => {
                // First lookup of this key this session: check the disk (once,
                // outside the lock).
                let s = self.disk.read::<Saved<T>>(&file).filter(|s| s.format == CACHE_FORMAT);
                let mut map = answers.lock().await;
                if self.generation.current() == generation {
                    map.entry(key.clone()).or_insert_with(|| s.clone());
                }
                s
            }
        };
        if let Some(s) = saved.as_ref().filter(|s| s.is_fresh(now)) {
            return Ok(s.rec.clone());
        }
        match fetch().await {
            Ok(rec) => {
                let fresh = Saved { format: CACHE_FORMAT, fetched_at: now, rec: rec.clone() };
                let mut map = answers.lock().await;
                // Cleared while fetching: still use the answer, just don't save it.
                if self.generation.current() == generation && keep(&rec) {
                    self.disk.write(&file, &fresh);
                    map.insert(key, Some(fresh));
                }
                Ok(rec)
            }
            // Offline or OP.GG is down: an expired answer from this patch still
            // beats none. One from an older patch doesn't; the client's page is used.
            Err(e) => saved.filter(|s| s.is_this_patch(now)).map(|s| s.rec).ok_or(e),
        }
    }

    async fn post(&self, body: Value, session: Option<&str>) -> Result<(Option<String>, String)> {
        let mut req = self
            .http
            .post(ENDPOINT)
            .header("Content-Type", "application/json")
            .header("Accept", "application/json, text/event-stream")
            .json(&body);
        if let Some(s) = session {
            req = req.header("Mcp-Session-Id", s);
        }
        let resp = req.send().await.context("couldn't reach OP.GG")?;
        let status = resp.status();
        let sid = resp.headers().get("mcp-session-id").and_then(|v| v.to_str().ok()).map(str::to_string);
        let text = resp.text().await.unwrap_or_default();
        if !status.is_success() {
            bail!("OP.GG returned {status}");
        }
        Ok((sid, text))
    }

    async fn ensure_session(&self) -> Result<Option<String>> {
        let mut guard = self.session.lock().await;
        if guard.is_some() {
            return Ok(guard.clone());
        }
        let (sid, _) = self
            .post(
                json!({"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {
                    "protocolVersion": "2025-06-18", "capabilities": {},
                    "clientInfo": {"name": "League Bro", "version": env!("CARGO_PKG_VERSION")}
                }}),
                None,
            )
            .await?;
        let _ = self
            .post(json!({"jsonrpc": "2.0", "method": "notifications/initialized"}), sid.as_deref())
            .await;
        *guard = Some(sid.clone().unwrap_or_default());
        Ok(sid)
    }

    pub async fn call_tool(&self, name: &str, args: Value) -> Result<String> {
        for attempt in 0..2 {
            let session = self.ensure_session().await?;
            let body = json!({"jsonrpc": "2.0", "id": 2, "method": "tools/call",
                              "params": {"name": name, "arguments": args}});
            match self.post(body, session.as_deref().filter(|s| !s.is_empty())).await {
                Ok((_, text)) => return parse_rpc_text(&text),
                // A timeout means OP.GG is slow, not that the session expired, and
                // asking again would only double the wait before the fallback.
                Err(e) if attempt == 0 && !crate::util::is_timeout(&e) => {
                    // The session may have expired; start a new one and retry once.
                    *self.session.lock().await = None;
                    eprintln!("OP.GG call failed ({e:#}); retrying with a new session");
                }
                Err(e) => return Err(e),
            }
        }
        unreachable!()
    }

    /// `lcu` supplies the champion's damage type for website API answers
    /// (left empty without it).
    pub async fn recommend(
        &self,
        champion_id: i64,
        alias: &str,
        position: &str,
        game_mode: &str,
        lcu: Option<&Lcu>,
    ) -> Result<Recommendation> {
        let pos = position_param(position, game_mode);
        if pos.is_empty() {
            bail!("no position to look up (blind pick without a role)");
        }
        let key = format!("{champion_id}:{pos}:{game_mode}");
        self.cached(&self.cache, key, || self.fetch_rec(champion_id, alias, pos, game_mode, lcu), |_| true).await
    }

    /// Your champion against one lane opponent: the matchup's own runes,
    /// spells and build, the head-to-head record and OP.GG's lane tip. Only
    /// for modes with lanes (ranked, flex; normal draft and blind use ranked).
    #[allow(clippy::too_many_arguments)]
    pub async fn matchup(
        &self,
        champion_id: i64,
        alias: &str,
        opponent_id: i64,
        opponent_alias: &str,
        position: &str,
        game_mode: &str,
        lcu: Option<&Lcu>,
        early: impl FnOnce(Matchup),
    ) -> Result<Matchup> {
        let pos = position_param(position, game_mode);
        if pos.is_empty() || !matches!(game_mode, "ranked" | "flex") {
            bail!("no lane to compare (this mode has no lanes, or you have no role)");
        }
        let key = format!("m:{champion_id}:{opponent_id}:{pos}:{game_mode}");
        let fetch = || self.fetch_matchup(champion_id, alias, opponent_id, opponent_alias, pos, game_mode, lcu, early);
        // Without the tip (the slow MCP call failed), ask again next time.
        self.cached(&self.matchups, key, fetch, |m| m.tip.is_some()).await
    }

    /// The website API (quick) and the MCP guide (~3.5 s, the only source of
    /// the tip) at once. If the website fails, the guide has the numbers too.
    /// `early` gets the website's numbers (no tip yet) as soon as they're in,
    /// so the UI can show them while the guide is still out.
    #[allow(clippy::too_many_arguments)]
    async fn fetch_matchup(
        &self,
        champion_id: i64,
        alias: &str,
        opponent_id: i64,
        opponent_alias: &str,
        pos: &str,
        game_mode: &str,
        lcu: Option<&Lcu>,
        early: impl FnOnce(Matchup),
    ) -> Result<Matchup> {
        let guide_args = json!({
            "position": pos,
            "my_champion": champion_param(alias),
            "opponent_champion": champion_param(opponent_alias),
            "lang": "en_US",
        });
        let guide = async {
            let text = self.call_tool("lol_get_lane_matchup_guide", guide_args).await?;
            serde_json::from_str::<Value>(&text).context("couldn't read OP.GG's matchup guide")
        };
        let web = async {
            let (web, opponent_damage) = tokio::join!(
                self.fetch_web_raw(champion_id, pos, game_mode, Some(opponent_id), lcu),
                self.damage_type(opponent_id, lcu),
            );
            if let Ok((main, builds, damage)) = &web {
                if let Ok(mut m) = parse_matchup(main, builds, damage, None, champion_id, opponent_id, pos, game_mode) {
                    m.opponent_damage_type = opponent_damage.clone();
                    early(m);
                }
            }
            (web, opponent_damage)
        };
        let ((web, opponent_damage), guide) = tokio::join!(web, guide);
        let guide = guide.map_err(|e| eprintln!("OP.GG matchup guide failed: {e:#}")).ok();
        let mut m = match web {
            Ok((main, builds, damage)) => {
                parse_matchup(&main, &builds, &damage, guide.as_ref(), champion_id, opponent_id, pos, game_mode)?
            }
            Err(e) => {
                let g = guide.as_ref().ok_or(e).context("OP.GG matchup")?;
                let damage = self.damage_type(champion_id, lcu).await;
                parse_matchup(g, g, &damage, Some(g), champion_id, opponent_id, pos, game_mode)?
            }
        };
        m.opponent_damage_type = opponent_damage;
        Ok(m)
    }

    async fn fetch_rec(&self, champion_id: i64, alias: &str, pos: &str, game_mode: &str, lcu: Option<&Lcu>) -> Result<Recommendation> {
        match self.fetch_web(champion_id, pos, game_mode, lcu).await {
            Ok(rec) => Ok(rec),
            Err(e) => {
                eprintln!("OP.GG website API failed ({e:#}); asking the MCP endpoint");
                self.fetch_mcp(champion_id, alias, pos, game_mode)
                    .await
                    .with_context(|| format!("OP.GG website API failed ({e:#}), then the MCP endpoint"))
            }
        }
    }

    /// Main page, item depths and damage type, all at once (~0.2–0.3 s).
    async fn fetch_web(&self, champion_id: i64, pos: &str, game_mode: &str, lcu: Option<&Lcu>) -> Result<Recommendation> {
        let (main, builds, damage) = self.fetch_web_raw(champion_id, pos, game_mode, None, lcu).await?;
        extract(&web_to_mcp(&main, &builds, &damage)?, champion_id, pos, game_mode)
    }

    /// The main answer, `/builds` (Null if only that failed) and the damage
    /// type. `target` narrows the numbers to games against that champion.
    async fn fetch_web_raw(
        &self,
        champion_id: i64,
        pos: &str,
        game_mode: &str,
        target: Option<i64>,
        lcu: Option<&Lcu>,
    ) -> Result<(Value, Value, String)> {
        let base = format!("{WEB_API}/{game_mode}/{champion_id}/{}", web_position(pos, game_mode));
        let query = target.map(|t| format!("?target_champion={t}")).unwrap_or_default();
        let (main_url, builds_url) = (format!("{base}{query}"), format!("{base}/builds{query}"));
        let get = |url: &str| get_json(self.http.get(url).timeout(WEB_TIMEOUT), "OP.GG");
        let (main, builds, damage) = tokio::join!(get(&main_url), get(&builds_url), self.damage_type(champion_id, lcu));
        // Without /builds only the 4th-6th item options are missing.
        let builds = builds.unwrap_or_else(|e| {
            eprintln!("OP.GG item options failed: {e:#}");
            Value::Null
        });
        Ok((main?, builds, damage))
    }

    /// The damage type if it's been looked up already (no request).
    pub async fn known_damage_type(&self, champion_id: i64) -> Option<String> {
        self.damage_types.lock().await.get(&champion_id).cloned()
    }

    /// From the League client's own champion data (local, a few ms), or
    /// CommunityDragon's copy when the client isn't open. Empty when neither
    /// can say; the UI then just leaves it out.
    pub async fn damage_type(&self, champion_id: i64, lcu: Option<&Lcu>) -> String {
        if let Some(d) = self.damage_types.lock().await.get(&champion_id) {
            return d.clone();
        }
        let file = format!("champions/{champion_id}.json");
        let data = match lcu {
            Some(lcu) => lcu.get_req(&format!("/lol-game-data/assets/v1/{file}")).await,
            None => get_json(self.http.get(format!("{CDRAGON_GAME_DATA}/{file}")).timeout(WEB_TIMEOUT), "CommunityDragon").await,
        };
        match data {
            Ok(v) => {
                let d = damage_label(text(&v, "/tacticalInfo/damageType")).to_string();
                self.damage_types.lock().await.insert(champion_id, d.clone());
                d
            }
            Err(e) => {
                eprintln!("Damage type lookup failed: {e:#}");
                String::new()
            }
        }
    }

    async fn fetch_mcp(&self, champion_id: i64, alias: &str, pos: &str, game_mode: &str) -> Result<Recommendation> {
        let text = self
            .call_tool(
                "lol_get_champion_analysis",
                json!({
                    "game_mode": game_mode,
                    "champion": champion_param(alias),
                    "position": pos,
                    "lang": "en_US",
                    "desired_output_fields": FIELDS,
                }),
            )
            .await?;
        let parsed = parse_compact(&text).context("couldn't read OP.GG's answer")?;
        extract(&parsed, champion_id, pos, game_mode)
    }
}

/// Pulls the text content out of a JSON-RPC response (plain JSON or SSE).
pub fn parse_rpc_text(body: &str) -> Result<String> {
    let data = if body.contains("data:") {
        body.lines()
            .filter_map(|l| l.strip_prefix("data:"))
            .map(str::trim)
            .filter(|l| !l.is_empty())
            .last()
            .unwrap_or("")
            .to_string()
    } else {
        body.to_string()
    };
    let v: Value = serde_json::from_str(&data).context("OP.GG sent something unexpected")?;
    if let Some(err) = v.get("error") {
        let msg = err.get("message").and_then(Value::as_str).unwrap_or("unknown error");
        bail!("OP.GG: {msg}");
    }
    let result = v.get("result").ok_or_else(|| anyhow!("OP.GG response has no result"))?;
    let text: String = result
        .get("content")
        .and_then(Value::as_array)
        .map(|a| a.iter().filter_map(|c| c.get("text").and_then(Value::as_str)).collect::<Vec<_>>().join("\n"))
        .unwrap_or_default();
    if flag(result, "isError") {
        bail!("OP.GG: {}", text.chars().take(200).collect::<String>());
    }
    if text.is_empty() {
        bail!("OP.GG returned no data");
    }
    Ok(text)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture(name: &str) -> String {
        std::fs::read_to_string(format!("{}/tests/fixtures/{name}", env!("CARGO_MANIFEST_DIR"))).unwrap()
    }

    #[test]
    fn parses_basic_shapes() {
        let v = parse_compact(
            "class A: x,y,z\nclass B: s\n\nA(1,[B(\"he said \\\"hi\\\"\"),B(null)],-0.5)",
        )
        .unwrap();
        assert_eq!(v, json!({"x": 1, "y": [{"s": "he said \"hi\""}, {"s": null}], "z": -0.5}));
    }

    #[test]
    fn full_ahri_response() {
        let v = parse_compact(&fixture("ahri_mid_full.txt")).unwrap();
        assert_eq!(v["champion"], "AHRI");
        let r = extract(&v, 103, "mid", "ranked").unwrap();
        // The MCP tool gives only the top pick, so each option list has just that.
        assert_eq!((r.rune_options.len(), r.spell_options.len(), r.core_options.len(), r.boots_options.len()), (1, 1, 1, 1));
        assert_eq!(r.rune_options[0], *r.runes.as_ref().unwrap());
        let runes = r.runes.as_ref().unwrap();
        assert_eq!((runes.primary_style_id, runes.sub_style_id), (8100, 8200));
        assert_eq!(runes.perk_ids, vec![8112, 8139, 8140, 8106, 8210, 8226, 5005, 5008, 5001]);
        assert_eq!(runes.keystone_name, "Electrocute");
        assert_eq!(r.spells, vec![4, 14]);
        assert_eq!(r.skill_max, vec!["Q", "W", "E"]);
        assert_eq!(r.skill_order.len(), 15);
        assert_eq!(r.skill_order[0], "W");
        assert_eq!(r.core.as_ref().unwrap().ids, vec![3118, 4645, 3157]);
        // core[0], boots, core[1..], then 4th/5th picks not already included;
        // the 6th-item options have under 10 games each, so they're skipped.
        assert_eq!(r.build_order, vec![3118, 3020, 4645, 3157, 3089, 3135]);
        assert!(r.games > 1000);
        assert_eq!(r.damage_type, "AP");
        assert!(r.core.as_ref().unwrap().pick_rate > 0.0);
        assert!(r.skill_stats.as_ref().is_some_and(|s| s.games > 0 && s.pick_rate > 0.0));
    }

    #[test]
    fn website_api_matches_the_mcp_shape() {
        let main: Value = serde_json::from_str(&fixture("opgg_web_ahri_mid.json")).unwrap();
        let builds: Value = serde_json::from_str(&fixture("opgg_web_ahri_mid_builds.json")).unwrap();
        let r = extract(&web_to_mcp(&main, &builds, "AP").unwrap(), 103, "mid", "ranked").unwrap();
        let runes = r.runes.as_ref().unwrap();
        assert_eq!((runes.primary_style_id, runes.sub_style_id), (8100, 8200));
        assert_eq!(runes.perk_ids, vec![8112, 8139, 8140, 8106, 8210, 8226, 5005, 5008, 5001]);
        assert_eq!((runes.games, runes.pick_rate), (6015, 0.4686));
        assert_eq!(r.spells, vec![4, 14]);
        assert_eq!(r.skill_max, vec!["Q", "W", "E"]);
        assert_eq!(r.skill_order[0], "W");
        assert_eq!(r.starter.as_ref().unwrap().ids, vec![1056, 2003, 2003]);
        assert_eq!(r.later.len(), 3);
        assert!(r.later.iter().all(|o| o.len() == LATE_ITEM_OPTIONS));
        // Same build as the MCP answer: 6th-item options have under 10 games.
        assert_eq!(r.build_order, vec![3118, 3020, 4645, 3157, 3089, 3135]);
        assert_eq!(r.damage_type, "AP");
        // The situational pool has every 4th-6th option once, more than the three per slot.
        let pool: Vec<i64> = r.situational_pool.iter().map(|s| s.ids[0]).collect();
        assert!(pool.len() > LATE_ITEM_OPTIONS, "{pool:?}");
        assert!(pool.iter().enumerate().all(|(i, id)| !pool[..i].contains(id)));
        assert!(r.situational_pool.iter().all(|s| s.games >= MIN_LATE_ITEM_GAMES));
        assert!(r.situational_pool.windows(2).all(|w| w[0].games >= w[1].games));
        assert!(pool.contains(&3089));

        // Without /builds there are just no 4th-6th options.
        let r = extract(&web_to_mcp(&main, &Value::Null, "").unwrap(), 103, "mid", "ranked").unwrap();
        assert!(r.later.is_empty() && r.situational_pool.is_empty());
        assert_eq!(r.build_order, vec![3118, 3020, 4645, 3157]);
        // Unknown champions come back without a data object.
        assert!(web_to_mcp(&json!({"data": []}), &Value::Null, "").is_err());
    }

    #[test]
    fn options_and_picking_one() {
        let main: Value = serde_json::from_str(&fixture("opgg_web_ahri_mid.json")).unwrap();
        let builds: Value = serde_json::from_str(&fixture("opgg_web_ahri_mid_builds.json")).unwrap();
        let r = extract(&web_to_mcp(&main, &builds, "AP").unwrap(), 103, "mid", "ranked").unwrap();
        // Top three of each list, most played first; the top one is what's shown by default.
        assert_eq!(r.rune_options.len(), 3);
        assert_eq!(r.rune_options[0], *r.runes.as_ref().unwrap());
        assert_eq!(r.spell_options.iter().map(|s| s.ids.clone()).collect::<Vec<_>>(), vec![vec![4, 14], vec![4, 12], vec![3, 4]]);
        assert_eq!(r.spell_options[1].games, 3639);
        assert_eq!(r.core_options[1].ids, vec![3118, 4645, 3089]);
        assert_eq!(r.boots_options.iter().map(|b| b.ids[0]).collect::<Vec<_>>(), vec![3020, 3158, 3111]);

        // The default pick changes nothing.
        assert_eq!(with_choice(&r, &RecChoice::default()), r);

        // Picking Teleport, the Rabadon's core and Ionian boots flows into spells and the build.
        let picked = with_choice(&r, &RecChoice { runes: 1, spells: 1, core: 1, boots: 1, matchup: false });
        assert_eq!(picked.spells, vec![4, 12]);
        assert_eq!(picked.spell_stats.as_ref().unwrap().games, 3639);
        assert_eq!(picked.runes.as_ref(), Some(&r.rune_options[1]));
        assert_eq!(picked.core.as_ref().unwrap().ids, vec![3118, 4645, 3089]);
        assert_eq!(&picked.build_order[..4], &[3118, 3158, 4645, 3089]);
        assert_eq!(picked.games, r.games, "MIN_GAMES gating stays on the top page");
        // The options themselves don't change, so the picker can still show them all.
        assert_eq!(picked.rune_options, r.rune_options);

        // An out-of-range pick keeps the top option.
        assert_eq!(with_choice(&r, &RecChoice { spells: 9, ..Default::default() }).spells, vec![4, 14]);
    }

    #[test]
    fn options_need_enough_games() {
        let opt = |play: i64| json!({ "ids": [4, 14], "play": play, "win": play / 2 });
        let data = json!({ "data": { "summoner_spells": opt(500), "summoner_spells_options": [opt(500), opt(19), opt(20)] } });
        let r = extract(&data, 103, "mid", "ranked").unwrap();
        assert_eq!(r.spell_options.iter().map(|s| s.games).collect::<Vec<_>>(), vec![500, 20]);
        // The top one stays even when it's rare.
        let data = json!({ "data": { "summoner_spells_options": [opt(3), opt(2)] } });
        assert_eq!(extract(&data, 103, "mid", "ranked").unwrap().spell_options.len(), 1);
    }

    #[test]
    fn ahri_vs_zed_matchup() {
        // Real answers for Ahri mid vs Zed (October 2026): the website API with
        // ?target_champion=238 and the MCP lane guide.
        let main: Value = serde_json::from_str(&fixture("opgg_web_ahri_vs_zed.json")).unwrap();
        let builds: Value = serde_json::from_str(&fixture("opgg_web_ahri_vs_zed_builds.json")).unwrap();
        let guide: Value = serde_json::from_str(&fixture("opgg_mcp_ahri_vs_zed.json")).unwrap();
        let m = parse_matchup(&main, &builds, "AP", Some(&guide), 103, 238, "mid", "ranked").unwrap();
        assert_eq!((m.games, m.opponent_id), (852, 238));
        assert!((m.win_rate - 423.0 / 852.0).abs() < 1e-9);
        let rec = m.rec.as_ref().unwrap();
        // The matchup's own numbers, far fewer games than Ahri's overall page.
        assert_eq!(rec.runes.as_ref().unwrap().perk_ids, vec![8112, 8139, 8140, 8106, 8210, 8226, 5005, 5008, 5001]);
        assert_eq!(rec.games, 462);
        assert_eq!(rec.spells, vec![4, 14]);
        assert!(!rec.later.is_empty());
        let tip = m.tip.unwrap();
        assert_eq!((tip.lane_advantage.as_str(), tip.solo_kills.as_str(), tip.play_style.as_str()), ("them", "them", "even"));
        assert!(tip.text.starts_with("Do not use Charm"));

        // The website failed: the guide alone gives the same matchup.
        let g = parse_matchup(&guide, &guide, "AP", Some(&guide), 103, 238, "mid", "ranked").unwrap();
        assert_eq!(g.games, 852);
        assert_eq!(g.rec.unwrap().runes.unwrap().perk_ids, rec.runes.as_ref().unwrap().perk_ids);
    }

    #[test]
    fn matchup_tip_sides() {
        let guide = |lane: &str, kills: &str| {
            json!({ "my_champion": "Darius", "opponent_champion": "Teemo", "data": {
                "opponent_champion_tip": " Keep your distance. ", "lane_advantage_champion": lane,
                "lane_solo_kill_advantage_champion": kills, "recommended_play_style": "Aggressive" } })
        };
        let t = matchup_tip(&guide("EVEN", "Darius")).unwrap();
        assert_eq!((t.text.as_str(), t.lane_advantage.as_str(), t.solo_kills.as_str(), t.play_style.as_str()),
                   ("Keep your distance.", "even", "you", "aggressive"));
        assert_eq!(matchup_tip(&guide("Teemo", "")).unwrap().solo_kills, "");
        assert!(matchup_tip(&json!({ "data": {} })).is_none());
    }

    /// Hits OP.GG for real: `cargo test live_matchup -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn live_matchup() {
        let rt = tokio::runtime::Runtime::new().unwrap();
        let op = OpGg::new(None);
        rt.block_on(async {
            let t = std::time::Instant::now();
            let m = op.matchup(103, "Ahri", 238, "Zed", "middle", "ranked", None, |_| {}).await.unwrap();
            let rec = m.rec.as_ref().unwrap();
            println!("Ahri vs Zed in {} ms: {} games, {:.1}% win, page {} games, tip: {:?}",
                     t.elapsed().as_millis(), m.games, m.win_rate * 100.0, rec.games, m.tip);
            assert!(m.games > 0 && rec.games > 0 && m.tip.is_some());
        });
    }

    /// Hits OP.GG for real and prints how long each source takes:
    /// `cargo test live_lookup_speed -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn live_lookup_speed() {
        let rt = tokio::runtime::Runtime::new().unwrap();
        let op = OpGg::new(None);
        rt.block_on(async {
            for (id, alias, pos, mode) in [(103, "Ahri", "mid", "ranked"), (412, "Thresh", "support", "ranked"), (22, "Ashe", "mid", "aram")] {
                let t = std::time::Instant::now();
                let web = op.fetch_web(id, pos, mode, None).await.unwrap();
                let web_ms = t.elapsed().as_millis();
                let t = std::time::Instant::now();
                let mcp = op.fetch_mcp(id, alias, pos, mode).await.unwrap();
                println!("{alias} {pos} {mode}: website {web_ms} ms, MCP {} ms", t.elapsed().as_millis());
                assert_eq!(web.runes.map(|r| r.perk_ids), mcp.runes.map(|r| r.perk_ids));
                // Damage type comes from the League client, not tested here.
                assert_eq!(web.spells, mcp.spells);
            }
        });
    }

    #[test]
    fn website_lanes_and_damage_labels() {
        assert_eq!(web_position("adc", "ranked"), "adc");
        assert_eq!(web_position("support", "flex"), "support");
        assert_eq!(web_position("mid", "aram"), "none");
        assert_eq!(damage_label("kMagic"), "AP");
        assert_eq!(damage_label("kPhysical"), "AD");
        assert_eq!(damage_label("kSomethingNew"), "");
    }

    #[test]
    fn filtered_thresh_response() {
        // Field order differs per class here (SummonerSpells has win before play).
        let v = parse_compact(&fixture("thresh_support_fields.txt")).unwrap();
        let r = extract(&v, 412, "support", "ranked").unwrap();
        assert_eq!(r.runes.as_ref().unwrap().keystone_name, "Aftershock");
        assert_eq!(r.spells, vec![4, 14]);
        assert_eq!(r.boots.as_ref().unwrap().ids, vec![3009]);
        assert_eq!(r.starter.as_ref().unwrap().ids, vec![2003, 2003]);
    }

    #[test]
    fn aram_takes_skill_order_from_builds() {
        let v = parse_compact(&fixture("ahri_aram.txt")).unwrap();
        let r = extract(&v, 103, "mid", "aram").unwrap();
        assert_eq!(r.spells, vec![4, 32]);
        assert_eq!(r.skill_order.first().map(String::as_str), Some("Q"));
        assert_eq!(r.runes.as_ref().unwrap().keystone_name, "Dark Harvest");
        assert!(r.boots.is_none());
    }

    #[test]
    fn small_sample_is_flagged() {
        let v = parse_compact(&fixture("ahri_jungle_small.txt")).unwrap();
        let r = extract(&v, 103, "jungle", "ranked").unwrap();
        assert!(r.games < MIN_GAMES);
    }

    #[test]
    fn rpc_text_from_sse_and_errors() {
        let sse = "event: message\ndata: {\"jsonrpc\":\"2.0\",\"id\":2,\"result\":{\"content\":[{\"type\":\"text\",\"text\":\"X()\"}]}}\n\n";
        assert_eq!(parse_rpc_text(sse).unwrap(), "X()");
        let err = "{\"jsonrpc\":\"2.0\",\"id\":2,\"error\":{\"code\":-32600,\"message\":\"bad position\"}}";
        assert!(parse_rpc_text(err).unwrap_err().to_string().contains("bad position"));
    }

    #[test]
    fn name_and_mode_mapping() {
        assert_eq!(champion_param("MonkeyKing"), "MONKEYKING");
        assert_eq!(champion_param("Kai'Sa"), "KAISA");
        assert_eq!(position_param("utility", "ranked"), "support");
        assert_eq!(position_param("bottom", "flex"), "adc");
        assert_eq!(position_param("", "aram"), "mid");
        assert_eq!(position_param("", "ranked"), "");
        assert_eq!(game_mode_for(450, 12), Some("aram"));
        assert_eq!(game_mode_for(420, 11), Some("ranked"));
        assert_eq!(game_mode_for(1700, 30), None);
    }

    #[test]
    fn cache_follows_the_patch_cycle() {
        let at = |s: &str| crate::patch::iso_to_secs(s).unwrap();
        let hour = 60 * 60;
        // 26.21's notes came out Oct 20 12:00 UTC; 26.22's are due Nov 3 12:00.
        let notes = at("2026-10-20T12:00:00Z");
        let next = at("2026-11-03T12:00:00Z");
        // First week after the notes: a day at a time.
        assert_eq!(expires_at(notes + hour), notes + hour + DAY_SECS);
        assert_eq!(expires_at(notes + 6 * DAY_SECS), notes + 7 * DAY_SECS);
        // After that: a week, cut short by the next patch's notes.
        assert_eq!(expires_at(notes + 7 * DAY_SECS), next);
        assert_eq!(expires_at(notes + 8 * DAY_SECS), next);
        // Fetched just before new notes: gone the moment they're out.
        assert_eq!(expires_at(next - hour), next);
        // Three-week gap before 26.24 (notes Dec 8): the second week runs a full week.
        let n23 = at("2026-11-17T12:00:00Z");
        assert_eq!(expires_at(n23 + 7 * DAY_SECS), n23 + 14 * DAY_SECS);
    }

    #[test]
    fn saved_recs_survive_a_restart() {
        let dir = std::env::temp_dir().join(format!("lb-opgg-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let rec = extract(&parse_compact(&fixture("ahri_mid_full.txt")).unwrap(), 103, "mid", "ranked").unwrap();
        let disk = DiskCache { dir: Some(dir.clone()) };
        let now = now_secs();
        disk.write(&rec_file("103:mid:ranked"), &Saved { format: CACHE_FORMAT, fetched_at: now, rec: rec.clone() });
        // A new client (as after restarting the app) reads it without the network.
        let client = OpGg::new(Some(dir.clone()));
        let rt = tokio::runtime::Builder::new_current_thread().build().unwrap();
        assert_eq!(rt.block_on(client.recommend(103, "Ahri", "middle", "ranked", None)).unwrap(), rec);
        // Saved in an older format: not used.
        let old = Saved { format: CACHE_FORMAT + 1, fetched_at: now, rec: rec.clone() };
        assert!(!old.is_fresh(now));
        // Clearing removes the saved files and leaves anything else alone.
        std::fs::write(dir.join("keep.txt"), "x").unwrap();
        let usage = rt.block_on(client.usage());
        assert_eq!((usage.files, usage.in_memory), (1, 1));
        rt.block_on(client.clear()).unwrap();
        assert_eq!(rt.block_on(client.usage()), CacheUsage::default());
        assert!(dir.join("keep.txt").exists());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn expired_answers_only_stand_in_within_the_patch() {
        let at = |s: &str| crate::patch::iso_to_secs(s).unwrap();
        let saved = |fetched_at| Saved { format: CACHE_FORMAT, fetched_at, rec: Recommendation::default() };
        // 26.21's notes came out Oct 20 12:00 UTC.
        let now = at("2026-10-25T00:00:00Z");
        assert!(saved(at("2026-10-21T00:00:00Z")).is_this_patch(now));
        assert!(!saved(at("2026-10-19T00:00:00Z")).is_this_patch(now));
    }
}
