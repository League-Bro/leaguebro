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

use crate::util::{flag, float, get_json, int, ints, list, text, web_client};
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
const CACHE_FORMAT: u32 = 1;
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
    /// Full build in purchase order (core + boots + top later picks), for the overlay.
    pub build_order: Vec<i64>,
    /// Games behind the rune page; small numbers mean a rare pick.
    pub games: i64,
    pub source: String,
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

/// Extracts a Recommendation from a parsed lol_get_champion_analysis result.
pub fn extract(parsed: &Value, champion_id: i64, position: &str, game_mode: &str) -> Result<Recommendation> {
    let data = parsed.get("data").ok_or_else(|| anyhow!("OP.GG response has no data"))?;
    let runes = data.get("runes").and_then(|r| {
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
    });
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
        later,
        games,
        source: "OP.GG".into(),
    })
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
    for (depth, key) in [(4, "fourth_items"), (5, "fifth_items"), (6, "sixth_items")] {
        let options = list(builds, "/data/single_items").iter().find(|s| int(s, "depth") == depth).map_or(&[][..], |s| list(s, "items"));
        data.insert(key.into(), options.iter().take(LATE_ITEM_OPTIONS).cloned().collect());
    }
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

#[derive(Debug, Clone, Serialize, Deserialize)]
struct SavedRec {
    format: u32,
    fetched_at: u64,
    rec: Recommendation,
}

impl SavedRec {
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
    /// Answers read this session (from disk or OP.GG), by champion:position:mode.
    /// `None` means the disk was checked and had nothing, so it isn't read again.
    cache: Mutex<HashMap<String, Option<SavedRec>>>,
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
            lookups: Mutex::new(HashMap::new()),
            damage_types: Mutex::new(HashMap::new()),
            disk: DiskCache { dir: cache_dir },
            generation: Generation::default(),
        }
    }

    pub async fn usage(&self) -> CacheUsage {
        let in_memory = self.cache.lock().await.values().filter(|s| s.is_some()).count();
        self.disk.usage(in_memory)
    }

    /// Forgets every saved answer, on disk and in memory, so the next champion
    /// asks OP.GG again. A lookup already in progress still returns its answer
    /// but doesn't save it.
    pub async fn clear(&self) -> Result<()> {
        let mut cache = self.cache.lock().await;
        self.generation.bump();
        cache.clear();
        self.disk.clear()
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

    async fn call_tool(&self, name: &str, args: Value) -> Result<String> {
        for attempt in 0..2 {
            let session = self.ensure_session().await?;
            let body = json!({"jsonrpc": "2.0", "id": 2, "method": "tools/call",
                              "params": {"name": name, "arguments": args}});
            match self.post(body, session.as_deref().filter(|s| !s.is_empty())).await {
                Ok((_, text)) => return parse_rpc_text(&text),
                Err(e) if attempt == 0 => {
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
        let lookup = self.lookups.lock().await.entry(key.clone()).or_default().clone();
        let _lookup = lookup.lock().await;
        let file = rec_file(&key);
        let now = now_secs();
        let generation = self.generation.current();
        let cached = self.cache.lock().await.get(&key).cloned();
        let saved = match cached {
            Some(s) => s,
            None => {
                // First lookup of this key this session: check the disk (once,
                // outside the lock).
                let s = self.disk.read::<SavedRec>(&file).filter(|s| s.format == CACHE_FORMAT);
                let mut cache = self.cache.lock().await;
                if self.generation.current() == generation {
                    cache.entry(key.clone()).or_insert_with(|| s.clone());
                }
                s
            }
        };
        if let Some(s) = saved.as_ref().filter(|s| s.is_fresh(now)) {
            return Ok(s.rec.clone());
        }
        match self.fetch_rec(champion_id, alias, pos, game_mode, lcu).await {
            Ok(rec) => {
                let fresh = SavedRec { format: CACHE_FORMAT, fetched_at: now, rec: rec.clone() };
                let mut cache = self.cache.lock().await;
                // Cleared while fetching: still use the answer, just don't save it.
                if self.generation.current() == generation {
                    self.disk.write(&file, &fresh);
                    cache.insert(key, Some(fresh));
                }
                Ok(rec)
            }
            // Offline or OP.GG is down: an expired answer from this patch still
            // beats none. One from an older patch doesn't; the client's page is used.
            Err(e) => saved.filter(|s| s.is_this_patch(now)).map(|s| s.rec).ok_or(e),
        }
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
        let base = format!("{WEB_API}/{game_mode}/{champion_id}/{}", web_position(pos, game_mode));
        let builds_url = format!("{base}/builds");
        let get = |url: &str| get_json(self.http.get(url).timeout(WEB_TIMEOUT), "OP.GG");
        let (main, builds, damage) = tokio::join!(get(&base), get(&builds_url), self.damage_type(champion_id, lcu));
        // Without /builds only the 4th-6th item options are missing.
        let builds = builds.unwrap_or_else(|e| {
            eprintln!("OP.GG item options failed: {e:#}");
            Value::Null
        });
        extract(&web_to_mcp(&main?, &builds, &damage)?, champion_id, pos, game_mode)
    }

    /// From the League client's own champion data (local, a few ms). Empty
    /// when the client can't say; the UI then just leaves it out.
    async fn damage_type(&self, champion_id: i64, lcu: Option<&Lcu>) -> String {
        if let Some(d) = self.damage_types.lock().await.get(&champion_id) {
            return d.clone();
        }
        let Some(lcu) = lcu else { return String::new() };
        match lcu.get_req(&format!("/lol-game-data/assets/v1/champions/{champion_id}.json")).await {
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

        // Without /builds there are just no 4th-6th options.
        let r = extract(&web_to_mcp(&main, &Value::Null, "").unwrap(), 103, "mid", "ranked").unwrap();
        assert!(r.later.is_empty());
        assert_eq!(r.build_order, vec![3118, 3020, 4645, 3157]);
        // Unknown champions come back without a data object.
        assert!(web_to_mcp(&json!({"data": []}), &Value::Null, "").is_err());
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
        disk.write(&rec_file("103:mid:ranked"), &SavedRec { format: CACHE_FORMAT, fetched_at: now, rec: rec.clone() });
        // A new client (as after restarting the app) reads it without the network.
        let client = OpGg::new(Some(dir.clone()));
        let rt = tokio::runtime::Builder::new_current_thread().build().unwrap();
        assert_eq!(rt.block_on(client.recommend(103, "Ahri", "middle", "ranked", None)).unwrap(), rec);
        // Saved in an older format: not used.
        let old = SavedRec { format: CACHE_FORMAT + 1, fetched_at: now, rec: rec.clone() };
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
        let saved = |fetched_at| SavedRec { format: CACHE_FORMAT, fetched_at, rec: Recommendation::default() };
        // 26.21's notes came out Oct 20 12:00 UTC.
        let now = at("2026-10-25T00:00:00Z");
        assert!(saved(at("2026-10-21T00:00:00Z")).is_this_patch(now));
        assert!(!saved(at("2026-10-19T00:00:00Z")).is_this_patch(now));
    }
}
