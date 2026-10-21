//! Champion recommendations (runes, summoner spells, skill order, items)
//! from OP.GG's public MCP endpoint (https://mcp-api.op.gg/mcp).
//!
//! The endpoint speaks MCP (JSON-RPC over HTTP). Tool results come back as
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

use anyhow::{anyhow, bail, Context, Result};
use serde::Serialize;
use serde_json::{json, Map, Value};
use std::collections::HashMap;
use std::time::{Duration, Instant};
use tokio::sync::Mutex;

pub const ENDPOINT: &str = "https://mcp-api.op.gg/mcp";
/// Below this many games OP.GG's numbers are mostly noise (e.g. an off-role
/// pick), so League Buddy falls back to the client's own recommendation.
pub const MIN_GAMES: i64 = 20;
/// 4th–6th item options seen in fewer games than this are skipped.
const MIN_LATE_ITEM_GAMES: i64 = 10;
const CACHE_FOR: Duration = Duration::from_secs(6 * 60 * 60);

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

#[derive(Debug, Clone, Serialize, PartialEq, Default)]
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
}

#[derive(Debug, Clone, Serialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct ItemSet {
    pub ids: Vec<i64>,
    pub names: Vec<String>,
    pub games: i64,
    pub win_rate: f64,
}

#[derive(Debug, Clone, Serialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct Recommendation {
    pub champion_id: i64,
    pub position: String,
    pub game_mode: String,
    pub runes: Option<RuneRec>,
    pub spells: Vec<i64>,
    /// Ability max priority, e.g. ["Q", "W", "E"].
    pub skill_max: Vec<String>,
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

fn n(v: &Value, k: &str) -> i64 {
    v.get(k).and_then(Value::as_i64).unwrap_or(0)
}
fn ids(v: &Value, k: &str) -> Vec<i64> {
    v.get(k).and_then(Value::as_array).map(|a| a.iter().filter_map(Value::as_i64).collect()).unwrap_or_default()
}
fn strs(v: &Value, k: &str) -> Vec<String> {
    v.get(k)
        .and_then(Value::as_array)
        .map(|a| a.iter().map(|x| x.as_str().map(str::to_string).unwrap_or_else(|| x.to_string())).collect())
        .unwrap_or_default()
}
fn win_rate(v: &Value) -> f64 {
    let games = n(v, "play");
    if games > 0 {
        n(v, "win") as f64 / games as f64
    } else {
        0.0
    }
}

fn item_set(v: &Value) -> Option<ItemSet> {
    let ids = ids(v, "ids");
    if ids.is_empty() {
        return None;
    }
    Some(ItemSet { names: strs(v, "ids_names"), games: n(v, "play"), win_rate: win_rate(v), ids })
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
        let primary = ids(r, "primary_rune_ids");
        let secondary = ids(r, "secondary_rune_ids");
        let shards = ids(r, "stat_mod_ids");
        if primary.len() != 4 || secondary.len() != 2 || shards.len() != 3 {
            return None;
        }
        let mut names = strs(r, "primary_rune_names");
        names.extend(strs(r, "secondary_rune_names"));
        Some(RuneRec {
            primary_style_id: n(r, "primary_page_id"),
            sub_style_id: n(r, "secondary_page_id"),
            keystone_name: strs(r, "primary_rune_names").first().cloned().unwrap_or_default(),
            primary_name: r.get("primary_page_name").and_then(Value::as_str).unwrap_or("").to_string(),
            secondary_name: r.get("secondary_page_name").and_then(Value::as_str).unwrap_or("").to_string(),
            perk_names: names,
            games: n(r, "play"),
            win_rate: win_rate(r),
            perk_ids: primary.into_iter().chain(secondary).chain(shards).collect(),
        })
    });
    let spells = data.get("summoner_spells").map(|s| ids(s, "ids")).unwrap_or_default();
    let masteries = data.get("skill_masteries");
    let skill_max = masteries.map(|m| strs(m, "ids")).unwrap_or_default();
    let skill_order = data
        .get("skills")
        .map(|s| strs(s, "order"))
        .filter(|o| !o.is_empty())
        .or_else(|| {
            // ARAM responses carry the order only inside skill_masteries.builds.
            masteries
                .and_then(|m| m.get("builds"))
                .and_then(Value::as_array)
                .and_then(|b| b.first())
                .map(|b| strs(b, "order"))
        })
        .unwrap_or_default();
    let set = |k: &str| data.get(k).and_then(item_set);
    let later: Vec<Vec<ItemSet>> = ["fourth_items", "fifth_items", "sixth_items"]
        .iter()
        .map(|k| {
            data.get(*k)
                .and_then(Value::as_array)
                .map(|a| a.iter().filter_map(item_set).collect())
                .unwrap_or_default()
        })
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
        skill_max,
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

// ---------- MCP client ----------

const FIELDS: &[&str] = &[
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

pub struct OpGg {
    http: reqwest::Client,
    session: Mutex<Option<String>>,
    cache: Mutex<HashMap<String, (Instant, Recommendation)>>,
}

impl OpGg {
    pub fn new(version: &str) -> OpGg {
        OpGg {
            http: reqwest::Client::builder()
                .user_agent(format!("LeagueBuddy/{version} (+https://github.com/doliaro/leaguebuddy)"))
                .timeout(Duration::from_secs(12))
                .build()
                .expect("http client"),
            session: Mutex::new(None),
            cache: Mutex::new(HashMap::new()),
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
                    "clientInfo": {"name": "League Buddy", "version": env!("CARGO_PKG_VERSION")}
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

    pub async fn recommend(&self, champion_id: i64, alias: &str, position: &str, game_mode: &str) -> Result<Recommendation> {
        let pos = position_param(position, game_mode);
        if pos.is_empty() {
            bail!("no position to look up (blind pick without a role)");
        }
        let key = format!("{champion_id}:{pos}:{game_mode}");
        if let Some((at, rec)) = self.cache.lock().await.get(&key) {
            if at.elapsed() < CACHE_FOR {
                return Ok(rec.clone());
            }
        }
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
        let rec = extract(&parsed, champion_id, pos, game_mode)?;
        self.cache.lock().await.insert(key, (Instant::now(), rec.clone()));
        Ok(rec)
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
    if result.get("isError").and_then(Value::as_bool).unwrap_or(false) {
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
}
