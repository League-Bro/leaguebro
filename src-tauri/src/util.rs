//! Helpers shared by every module: reading loosely shaped JSON (the League
//! client, the live game, OP.GG…) and fetching JSON from the web.

use anyhow::{anyhow, Context, Result};
use serde_json::Value;
use std::time::Duration;

/// `k` is a key, or a JSON pointer when it starts with `/`.
fn field<'a>(v: &'a Value, k: &str) -> Option<&'a Value> {
    if k.starts_with('/') { v.pointer(k) } else { v.get(k) }
}

pub fn int(v: &Value, k: &str) -> i64 {
    field(v, k).and_then(Value::as_i64).unwrap_or(0)
}

pub fn float(v: &Value, k: &str) -> f64 {
    field(v, k).and_then(Value::as_f64).unwrap_or(0.0)
}

pub fn text<'a>(v: &'a Value, k: &str) -> &'a str {
    field(v, k).and_then(Value::as_str).unwrap_or("")
}

pub fn flag(v: &Value, k: &str) -> bool {
    field(v, k).and_then(Value::as_bool).unwrap_or(false)
}

/// The array at `k`, or an empty slice.
pub fn list<'a>(v: &'a Value, k: &str) -> &'a [Value] {
    field(v, k).and_then(Value::as_array).map(Vec::as_slice).unwrap_or(&[])
}

pub fn ints(v: &Value, k: &str) -> Vec<i64> {
    list(v, k).iter().filter_map(Value::as_i64).collect()
}

pub fn strings(v: &Value, k: &str) -> Vec<String> {
    list(v, k).iter().filter_map(Value::as_str).map(str::to_string).collect()
}

/// "Name#TAG", falling back to the older name fields; None when there's none.
pub fn riot_name(v: &Value) -> Option<String> {
    let (game, tag) = (text(v, "gameName"), text(v, "tagLine"));
    if !game.is_empty() {
        return Some(if tag.is_empty() { game.to_string() } else { format!("{game}#{tag}") });
    }
    ["riotIdGameName", "summonerName", "internalName"].iter().map(|k| text(v, k)).find(|n| !n.is_empty()).map(str::to_string)
}

/// Picks rustls' crypto (reqwest is built without a default, like the
/// updater plugin's). Installing twice is a no-op.
pub fn use_ring() {
    let _ = rustls::crypto::ring::default_provider().install_default();
}

/// CommunityDragon's copy of the League client's `lol-game-data/assets/v1`
/// files (same shapes, live patch, English), for when the client isn't open.
pub const CDRAGON_GAME_DATA: &str = "https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1";

/// Client for the internet (OP.GG, Riot's site, tier lists), identifying the app.
pub fn web_client(timeout_secs: u64) -> reqwest::Client {
    use_ring();
    reqwest::Client::builder()
        .user_agent(concat!("LeagueBro/", env!("CARGO_PKG_VERSION"), " (+https://github.com/league-bro/leaguebro)"))
        .timeout(Duration::from_secs(timeout_secs))
        .build()
        .expect("http client")
}

/// The most a web answer may be. The biggest real ones (CommunityDragon's
/// items.json, a patch notes page) are a few MB; this stops a broken or
/// hostile server from filling memory.
const MAX_BODY: usize = 32 * 1024 * 1024;

/// Reads a web answer, up to `MAX_BODY`; `what` names the site in errors.
pub async fn read_body(mut resp: reqwest::Response, what: &str) -> Result<Vec<u8>> {
    let too_big = || anyhow!("{what}'s answer is too big");
    if resp.content_length().is_some_and(|n| n > MAX_BODY as u64) {
        return Err(too_big());
    }
    let mut body = Vec::new();
    while let Some(chunk) = resp.chunk().await.with_context(|| format!("couldn't read {what}'s answer"))? {
        if body.len() + chunk.len() > MAX_BODY {
            return Err(too_big());
        }
        body.extend_from_slice(&chunk);
    }
    Ok(body)
}

/// Sends a GET and reads the JSON answer; `what` names the site in errors.
pub async fn get_json(req: reqwest::RequestBuilder, what: &str) -> Result<Value> {
    let resp = req
        .send()
        .await
        .with_context(|| format!("couldn't reach {what}"))?
        .error_for_status()
        .with_context(|| format!("{what} refused the request"))?;
    serde_json::from_slice(&read_body(resp, what).await?).with_context(|| format!("couldn't read {what}'s answer"))
}

/// Whether a request failed by timing out (the other end is slow, not gone).
pub fn is_timeout(e: &anyhow::Error) -> bool {
    e.chain().any(|c| c.downcast_ref::<reqwest::Error>().is_some_and(reqwest::Error::is_timeout))
}

/// An error as the UI shows it, with its causes ("couldn't reach OP.GG: timed out").
pub fn msg(e: anyhow::Error) -> String {
    format!("{e:#}")
}
