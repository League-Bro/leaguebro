//! Your own profile: rank, recent matches and insights, from the League
//! client's match history (`/lol-match-history/v1/products/lol/{puuid}/matches`).
//! Other players' profiles come from the same endpoints by their puuid
//! (`load_player`), found by Riot ID with `find_puuid`.
//!
//! Custom and practice games are left out, and so are Brawl and League
//! Classic games, which Riot's third-party rules don't allow match data for.
//!
//! That list only has you in each game, so the enemy team and your lane
//! opponent come from each game's full record (`/lol-match-history/v1/games/{id}`),
//! fetched once per game and kept in memory.

use crate::lcu::Lcu;
use crate::postgame::{self, PlayerLine};
use crate::util::{int, list, riot_name, text};
use crate::scout::{self, RankLine};
use serde::Serialize;
use serde_json::Value;
use std::collections::HashMap;
use std::sync::{LazyLock, Mutex};

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MatchLine {
    pub game_id: i64,
    pub queue_id: i64,
    pub game_mode: String,
    /// Unix ms.
    pub created: i64,
    /// Seconds.
    pub duration: i64,
    /// "win", "loss" or "remake".
    pub result: String,
    #[serde(flatten)]
    pub line: PlayerLine,
    /// Champion id of the enemy in your position, when the client's lane data
    /// makes that clear (Summoner's Rift 5v5 only).
    pub lane_opponent: Option<i64>,
    /// Enemy champion ids; empty if the game's full record didn't load.
    pub enemies: Vec<i64>,
    /// LP gained or lost in a ranked game, when League Bro saw your rank
    /// before and after it (see `lp_history`).
    pub lp_change: Option<crate::lp_history::LpChange>,
}

/// Games and your wins/KDA with a champion, or against one.
#[derive(Debug, Clone, Serialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct ChampStat {
    pub champion_id: i64,
    pub games: i64,
    pub wins: i64,
    pub kills: i64,
    pub deaths: i64,
    pub assists: i64,
}

#[derive(Debug, Clone, Serialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct QueueStat {
    pub queue_id: i64,
    pub games: i64,
    pub wins: i64,
}

/// Totals over counted games (remakes left out).
#[derive(Debug, Clone, Serialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct Insights {
    pub games: i64,
    pub wins: i64,
    pub kills: i64,
    pub deaths: i64,
    pub assists: i64,
    pub cs_per_min: f64,
    pub damage_per_min: f64,
    pub gold_per_min: f64,
    pub vision_per_game: f64,
    /// Positive = current win streak, negative = loss streak.
    pub streak: i64,
    /// Most played first.
    pub champions: Vec<ChampStat>,
    pub queues: Vec<QueueStat>,
    /// Lane opponents you've lost to more often than beaten (2+ games), worst 5 first.
    pub toughest_lanes: Vec<ChampStat>,
    /// The same for enemy champions anywhere on the other team.
    pub toughest_enemies: Vec<ChampStat>,
}

/// Insights for one queue.
#[derive(Debug, Clone, Serialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct ModeInsights {
    pub queue_id: i64,
    pub insights: Insights,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct MyProfile {
    pub puuid: String,
    pub name: String,
    pub icon_id: i64,
    pub level: i64,
    pub solo: Option<RankLine>,
    pub flex: Option<RankLine>,
    /// Newest first.
    pub matches: Vec<MatchLine>,
    /// All queues together.
    pub insights: Insights,
    /// Per queue, most played first.
    pub modes: Vec<ModeInsights>,
    /// The queue of the lobby, champ select or game you're in, if any.
    pub current_queue_id: Option<i64>,
    pub error: Option<String>,
    /// "client" (the League client's match history) or "opgg" (looked up by
    /// Riot ID while the client isn't running; see `opgg_profile`).
    pub source: String,
    /// When OP.GG last fetched this player from Riot (unix ms; OP.GG only).
    pub updated_at: Option<i64>,
    /// When OP.GG next allows an update (unix ms; OP.GG only).
    pub renewable_at: Option<i64>,
    /// Your LP over time (see `lp_history`).
    pub lp_history: crate::lp_history::LpHistory,
}

/// Games League Bro may show match data for. Brawl's markers (mode `BRAWL`,
/// queue 2400) haven't been seen in a real response yet.
pub fn allowed(game: &Value, champion_id: i64) -> bool {
    let mode = text(game, "gameMode");
    let queue = int(game, "queueId");
    let brawl = mode.eq_ignore_ascii_case("BRAWL") || queue == 2400;
    let league_classic = champion_id >= 60000;
    !brawl && !league_classic
}

/// Your line from each game in a match-history response (the player's own
/// history, or anyone's when scouting), newest first.
pub fn parse_matches(history: &Value) -> Vec<MatchLine> {
    let mut out: Vec<MatchLine> = list(history, "/games/games")
        .iter()
        .filter(|g| text(g, "gameType") != "CUSTOM_GAME")
        .filter_map(|g| {
            // This endpoint returns only the requested player in each game.
            let p = list(g, "participants").first()?;
            let line = PlayerLine::parse(p);
            allowed(g, line.champion_id).then(|| MatchLine {
                game_id: int(g, "gameId"),
                queue_id: int(g, "queueId"),
                game_mode: text(g, "gameMode").to_string(),
                created: int(g, "gameCreation"),
                duration: int(g, "gameDuration"),
                result: postgame::result(p).to_string(),
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

/// Who you played against in one game.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Opponents {
    pub lane: Option<i64>,
    pub enemies: Vec<i64>,
}

/// Your lane opponent and the enemy team from a game's full record. None if
/// you aren't in it.
pub fn opponents(game: &Value, my_puuid: &str) -> Option<Opponents> {
    let parts = game.get("participants")?.as_array()?;
    let my_pid = game
        .get("participantIdentities")?
        .as_array()?
        .iter()
        .find(|i| i.pointer("/player/puuid").and_then(Value::as_str) == Some(my_puuid))
        .map(|i| int(i, "participantId"))?;
    let me = parts.iter().find(|p| int(p, "participantId") == my_pid)?;
    let my_team_id = int(me, "teamId");
    let (mine, theirs): (Vec<&Value>, Vec<&Value>) = parts.iter().partition(|p| int(p, "teamId") == my_team_id);
    // Arena (map 30) pairs players into subteams inside teamId 100/200, so
    // teamId doesn't say who was against you there.
    let enemies = if int(game, "mapId") == 30 { Vec::new() } else { theirs.iter().map(|p| int(p, "championId")).collect() };
    // Lanes only mean something in a 5v5 on Summoner's Rift.
    let lane = (int(game, "mapId") == 11 && mine.len() == 5 && theirs.len() == 5)
        .then(|| {
            let my_pos = positions(&mine);
            let their_pos = positions(&theirs);
            let me_at = mine.iter().position(|p| int(p, "participantId") == my_pid)?;
            let pos = my_pos[me_at]?;
            let only = |list: &[Option<&str>]| list.iter().filter(|p| **p == Some(pos)).count() == 1;
            if !only(&my_pos) || !only(&their_pos) {
                return None;
            }
            let at = their_pos.iter().position(|p| *p == Some(pos))?;
            Some(int(theirs[at], "championId"))
        })
        .flatten();
    Some(Opponents { lane, enemies })
}

/// Best guess at each player's position. The client's `timeline.lane`/`role`
/// is often wrong, so Smite decides jungle, and in bot lane the one with less
/// CS is the support when the roles aren't given. None where it's unclear.
pub fn positions(team: &[&Value]) -> Vec<Option<&'static str>> {
    let text = |v: &Value, k: &str| v.pointer(k).and_then(Value::as_str).unwrap_or("").to_string();
    let mut pos: Vec<Option<&'static str>> = team
        .iter()
        .map(|p| {
            if int(p, "spell1Id") == 11 || int(p, "spell2Id") == 11 {
                return Some("jungle");
            }
            match (text(p, "/timeline/lane").as_str(), text(p, "/timeline/role").as_str()) {
                ("TOP", _) => Some("top"),
                ("MIDDLE" | "MID", _) => Some("mid"),
                ("JUNGLE", _) => Some("jungle"),
                ("BOTTOM" | "BOT", "DUO_SUPPORT") => Some("support"),
                ("BOTTOM" | "BOT", "DUO_CARRY") => Some("adc"),
                ("BOTTOM" | "BOT", _) => Some("bottom"),
                _ => None,
            }
        })
        .collect();
    let cs = |i: usize| team[i].pointer("/stats/totalMinionsKilled").and_then(Value::as_i64).unwrap_or(0);
    let bots: Vec<usize> = (0..pos.len()).filter(|&i| pos[i] == Some("bottom")).collect();
    let has = |pos: &[Option<&str>], p: &str| pos.contains(&Some(p));
    match bots[..] {
        [a, b] => {
            let (carry, sup) = if cs(a) >= cs(b) { (a, b) } else { (b, a) };
            pos[carry] = Some("adc");
            pos[sup] = Some("support");
        }
        [a] if has(&pos, "adc") && !has(&pos, "support") => pos[a] = Some("support"),
        [a] if has(&pos, "support") && !has(&pos, "adc") => pos[a] = Some("adc"),
        [a] => pos[a] = None,
        _ => {}
    }
    pos
}

static OPPONENTS: LazyLock<Mutex<HashMap<(String, i64), Opponents>>> = LazyLock::new(Default::default);

/// Fills `lane_opponent` and `enemies` from each game's full record. Games
/// whose record doesn't load are left as they are and tried again next time.
/// Remakes are skipped, since insights leave them out. Returns how many
/// records didn't load. With `fetch` false only records already loaded are
/// used (a quick first look at another player).
async fn fill_opponents(lcu: &Lcu, puuid: &str, matches: &mut [MatchLine], fetch: bool) -> usize {
    let missing: Vec<i64> = if !fetch { Vec::new() } else {
        let cache = OPPONENTS.lock().unwrap();
        matches
            .iter()
            .filter(|m| m.result != "remake" && !cache.contains_key(&(puuid.to_string(), m.game_id)))
            .map(|m| m.game_id)
            .collect()
    };
    // At most 8 requests at a time to go easy on the client.
    let permits = std::sync::Arc::new(tokio::sync::Semaphore::new(8));
    let mut set = tokio::task::JoinSet::new();
    for id in missing {
        let (lcu, permits) = (lcu.clone(), permits.clone());
        set.spawn(async move {
            let _permit = permits.acquire().await;
            (id, lcu.get(&format!("/lol-match-history/v1/games/{id}")).await)
        });
    }
    let mut failed = 0;
    while let Some(done) = set.join_next().await {
        let found = done.map(|(id, res)| {
            let game = res.ok().flatten();
            if let Some(g) = &game {
                remember_players(g);
            }
            (id, game.and_then(|g| opponents(&g, puuid)))
        });
        match found {
            Ok((id, Some(o))) => {
                OPPONENTS.lock().unwrap().insert((puuid.to_string(), id), o);
            }
            _ => failed += 1,
        }
    }
    let mut cache = OPPONENTS.lock().unwrap();
    // Only this player's games still in the client's history are kept; the
    // client holds just a few dozen, so this stops the cache growing with every
    // game played. Other players' games stay. An empty history (it failed to
    // load) keeps everything.
    if !matches.is_empty() {
        cache.retain(|(p, id), _| p != puuid || matches.iter().any(|m| m.game_id == *id));
    }
    for m in matches {
        if let Some(o) = cache.get(&(puuid.to_string(), m.game_id)) {
            m.lane_opponent = o.lane;
            m.enemies = o.enemies.clone();
        }
    }
    failed
}

/// Champions you've lost to more often than beaten, in 2+ games: the worst 5.
fn toughest(stats: HashMap<i64, ChampStat>) -> Vec<ChampStat> {
    let mut out: Vec<ChampStat> = stats.into_values().filter(|c| c.games >= 2 && c.games - c.wins > c.wins).collect();
    let net = |c: &ChampStat| c.games - 2 * c.wins;
    out.sort_by(|a, b| net(b).cmp(&net(a)).then(b.games.cmp(&a.games)).then(a.champion_id.cmp(&b.champion_id)));
    out.truncate(5);
    out
}

fn add(stats: &mut HashMap<i64, ChampStat>, champion_id: i64, m: &MatchLine) {
    let c = stats.entry(champion_id).or_insert_with(|| ChampStat { champion_id, ..Default::default() });
    c.games += 1;
    c.wins += (m.result == "win") as i64;
    c.kills += m.line.kills;
    c.deaths += m.line.deaths;
    c.assists += m.line.assists;
}

/// Insights for each queue in `matches`, most played first.
pub fn modes(matches: &[MatchLine]) -> Vec<ModeInsights> {
    let mut ids: Vec<i64> = matches.iter().map(|m| m.queue_id).collect();
    ids.sort();
    ids.dedup();
    let mut out: Vec<ModeInsights> = ids
        .into_iter()
        .map(|queue_id| ModeInsights { queue_id, insights: insights(matches.iter().filter(|m| m.queue_id == queue_id)) })
        .collect();
    out.sort_by(|a, b| b.insights.games.cmp(&a.insights.games).then(a.queue_id.cmp(&b.queue_id)));
    out
}

/// `matches` newest first.
pub fn insights<'a>(matches: impl IntoIterator<Item = &'a MatchLine>) -> Insights {
    let counted: Vec<&MatchLine> = matches.into_iter().filter(|m| m.result != "remake").collect();
    let mut ins = Insights { games: counted.len() as i64, ..Default::default() };
    let minutes: f64 = counted.iter().map(|m| m.duration as f64 / 60.0).sum();
    let mut champs: HashMap<i64, ChampStat> = HashMap::new();
    let mut queues: HashMap<i64, QueueStat> = HashMap::new();
    let mut lanes: HashMap<i64, ChampStat> = HashMap::new();
    let mut enemies: HashMap<i64, ChampStat> = HashMap::new();
    for m in &counted {
        let win = m.result == "win";
        ins.wins += win as i64;
        ins.kills += m.line.kills;
        ins.deaths += m.line.deaths;
        ins.assists += m.line.assists;
        add(&mut champs, m.line.champion_id, m);
        if let Some(id) = m.lane_opponent {
            add(&mut lanes, id, m);
        }
        for &id in &m.enemies {
            add(&mut enemies, id, m);
        }
        let q = queues.entry(m.queue_id).or_insert_with(|| QueueStat { queue_id: m.queue_id, ..Default::default() });
        q.games += 1;
        q.wins += win as i64;
    }
    if minutes > 0.0 {
        let per_min = |f: fn(&MatchLine) -> i64| counted.iter().map(|m| f(m)).sum::<i64>() as f64 / minutes;
        ins.cs_per_min = per_min(|m| m.line.cs);
        ins.damage_per_min = per_min(|m| m.line.damage);
        ins.gold_per_min = per_min(|m| m.line.gold);
    }
    if !counted.is_empty() {
        ins.vision_per_game = counted.iter().map(|m| m.line.vision).sum::<i64>() as f64 / counted.len() as f64;
        let first = counted[0].result == "win";
        let len = counted.iter().take_while(|m| (m.result == "win") == first).count() as i64;
        ins.streak = if first { len } else { -len };
    }
    ins.champions = champs.into_values().collect();
    ins.champions.sort_by(|a, b| b.games.cmp(&a.games).then(b.wins.cmp(&a.wins)).then(a.champion_id.cmp(&b.champion_id)));
    ins.queues = queues.into_values().collect();
    ins.queues.sort_by(|a, b| b.games.cmp(&a.games).then(a.queue_id.cmp(&b.queue_id)));
    ins.toughest_lanes = toughest(lanes);
    ins.toughest_enemies = toughest(enemies);
    ins
}

/// Your recent games (the few dozen the client keeps) with `opponent_id` as
/// your lane opponent, remakes left out. Uses the same full-record fetches as
/// the Profile page, kept for the session.
pub async fn record_against(lcu: &Lcu, opponent_id: i64) -> anyhow::Result<ChampStat> {
    let me = lcu.summoner_ids().await?;
    let puuid = text(&me, "puuid").to_string();
    let history = lcu
        .get_slow(&history_path(&puuid))
        .await?
        .ok_or_else(|| anyhow::anyhow!("the client has no match history for you"))?;
    let mut matches = parse_matches(&history);
    fill_opponents(lcu, &puuid, &mut matches, true).await;
    Ok(lane_record(&matches, opponent_id))
}

fn lane_record(matches: &[MatchLine], opponent_id: i64) -> ChampStat {
    let mut stats = HashMap::new();
    for m in matches.iter().filter(|m| m.result != "remake" && m.lane_opponent == Some(opponent_id)) {
        add(&mut stats, opponent_id, m);
    }
    stats.remove(&opponent_id).unwrap_or(ChampStat { champion_id: opponent_id, ..Default::default() })
}

/// Your match history. The client keeps a few dozen recent games; this asks
/// for more than it has. Right after the client starts, the first request can
/// take longer than the usual 8 s timeout while the client fetches the games
/// from Riot (the Profile page showed "match history: GET …" until Refresh),
/// so it goes through `get_slow`.
fn history_path(puuid: &str) -> String {
    history_path_upto(puuid, 99)
}

/// Another player's games aren't on your PC, so the client fetches them from
/// Riot: asking for 20 keeps that quick.
fn history_path_upto(puuid: &str, end_index: i64) -> String {
    format!("/lol-match-history/v1/products/lol/{puuid}/matches?begIndex=0&endIndex={end_index}")
}

/// Your profile from the client.
pub async fn load(lcu: &Lcu) -> anyhow::Result<MyProfile> {
    let me = lcu.get_req("/lol-summoner/v1/current-summoner").await?;
    let path = history_path(text(&me, "puuid"));
    let (mut p, session) = tokio::join!(load_summoner(lcu, &me, &path, true), lcu.get("/lol-gameflow/v1/session"));
    if let Ok(Some(s)) = session {
        p.current_queue_id = s.pointer("/gameData/queue/id").and_then(Value::as_i64).filter(|q| *q > 0);
    }
    Ok(p)
}

/// Anyone's profile from the client, by puuid: the client answers rank and
/// match history for any player, not just you. `quick` leaves out the full
/// game records (enemy and lane-opponent stats), which take a request per
/// game; the page asks again without it once the rest shows.
pub async fn load_player(lcu: &Lcu, puuid: &str, quick: bool) -> anyhow::Result<MyProfile> {
    let paths = [format!("/lol-summoner/v2/summoners/puuid/{puuid}"), format!("/lol-summoner/v1/summoners-by-puuid-cached/{puuid}")];
    for path in paths {
        if let Ok(Some(s)) = lcu.get(&path).await {
            if !text(&s, "puuid").is_empty() {
                return Ok(load_summoner(lcu, &s, &history_path_upto(puuid, 19), !quick).await);
            }
        }
    }
    anyhow::bail!("the League client couldn't find this player")
}

/// A player's puuid from their Riot ID, through the client. Clients have
/// answered Riot ID lookups at different endpoints over the years, so this
/// tries each, newest first. A name without a #TAG is tried as a bare name,
/// then with `default_tag` (the tag most players on the server have).
pub async fn find_puuid(lcu: &Lcu, riot_id: &str, default_tag: &str) -> anyhow::Result<String> {
    let riot_id = riot_id.trim();
    if !riot_id.contains('#') {
        if let Ok(Some(v)) = lcu.get(&format!("/lol-summoner/v1/summoners?name={}", encode(riot_id))).await {
            if let Some(p) = first_puuid(&v) {
                return Ok(p);
            }
        }
    }
    let tagged = if riot_id.contains('#') { riot_id.to_string() } else { format!("{riot_id}#{default_tag}") };
    let (name, tag) = crate::opgg_profile::split_riot_id(&tagged)?;
    let query = format!("gameName={}&tagLine={}", encode(name), encode(tag));
    if let Ok(Some(v)) = lcu.get(&format!("/lol-summoner/v1/alias/lookup?{query}")).await {
        if let Some(p) = first_puuid(&v) {
            return Ok(p);
        }
    }
    let body = serde_json::json!([{ "gameName": name, "tagLine": tag }]);
    if let Ok(v) = lcu.post("/lol-summoner/v1/summoners/aliases", &body).await {
        if let Some(p) = first_puuid(&v) {
            return Ok(p);
        }
    }
    if let Ok(Some(v)) = lcu.get(&format!("/lol-summoner/v1/summoners?name={}", encode(&format!("{name}#{tag}")))).await {
        if let Some(p) = first_puuid(&v) {
            return Ok(p);
        }
    }
    anyhow::bail!("no player called {name}#{tag} on your server")
}

/// Tags many players picked or were given, tried for a name typed without one.
const COMMON_TAGS: &[&str] = &[
    "NA1", "EUW", "EUNE", "KR1", "OCE", "BR1", "LAN", "LAS", "TR1", "RU", "JP1", "000", "0001", "001", "01", "1", "2", "123",
    "1234", "777", "69", "420", "666", "999",
];

/// Every account called `name` that the client finds, with your server's
/// usual tag and the common ones (Riot can't list all tags for a name, so
/// these are guesses checked against the client). One batch lookup
/// (`summoners/aliases` takes a list); clients without it get one lookup per tag.
pub async fn players_named(lcu: &Lcu, name: &str, default_tag: &str) -> Vec<PlayerHit> {
    let name = name.trim();
    let mut tags = vec![default_tag.to_string()];
    tags.extend(COMMON_TAGS.iter().map(|t| t.to_string()).filter(|t| t != default_tag));
    let mut found: Vec<Value> = Vec::new();
    let body: Value = tags.iter().map(|t| serde_json::json!({ "gameName": name, "tagLine": t })).collect();
    match lcu.post("/lol-summoner/v1/summoners/aliases", &body).await {
        Ok(Value::Array(list)) => found = list,
        _ => {
            let mut set = tokio::task::JoinSet::new();
            for t in tags {
                let (lcu, path) = (lcu.clone(), format!("/lol-summoner/v1/alias/lookup?gameName={}&tagLine={}", encode(name), encode(&t)));
                set.spawn(async move { lcu.get(&path).await.ok().flatten() });
            }
            while let Some(done) = set.join_next().await {
                found.extend(done.ok().flatten());
            }
        }
    }
    let mut out: Vec<PlayerHit> = Vec::new();
    for v in found {
        let puuid = text(&v, "puuid");
        if let (false, Some(n)) = (puuid.is_empty(), riot_name(&v).filter(|n| n.contains('#'))) {
            if !out.iter().any(|h| h.puuid == puuid) {
                out.push(PlayerHit { puuid: puuid.to_string(), name: n, friend: false });
            }
        }
    }
    // Your server's usual tag first, then by name.
    let usual = format!("#{}", default_tag.to_lowercase());
    out.sort_by_key(|h| (!h.name.to_lowercase().ends_with(&usual), h.name.to_lowercase()));
    out
}

/// The puuid in a lookup answer (one summoner, or a list of them).
fn first_puuid(v: &Value) -> Option<String> {
    let one = v.as_array().and_then(|a| a.first()).unwrap_or(v);
    Some(text(one, "puuid").to_string()).filter(|p| !p.is_empty())
}

/// The #TAG most players on a server have (the one Riot gave everyone when
/// Riot IDs came in), by OP.GG region code. Used when a search has no tag.
pub fn default_tag(region: &str) -> String {
    match region {
        "na" => "NA1",
        "euw" => "EUW",
        "eune" => "EUNE",
        "kr" => "KR1",
        "br" => "BR1",
        "lan" => "LAN",
        "las" => "LAS",
        "oce" => "OCE",
        "tr" => "TR1",
        "ru" => "RU",
        "jp" => "JP1",
        "me" => "ME1",
        "ph" => "PH2",
        "sg" => "SG2",
        "th" => "TH2",
        "tw" => "TW2",
        "vn" => "VN2",
        r => return r.to_ascii_uppercase(),
    }
    .to_string()
}

/// A player the search suggests.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PlayerHit {
    pub puuid: String,
    pub name: String,
    /// On your friends list (else seen in a game this session).
    pub friend: bool,
}

/// Players from full game records loaded this session (your games and any
/// profile you opened), puuid → Riot ID, for the search's suggestions.
static SEEN_PLAYERS: LazyLock<Mutex<HashMap<String, String>>> = LazyLock::new(Default::default);

fn remember_players(game: &Value) {
    let mut seen = SEEN_PLAYERS.lock().unwrap();
    for i in list(game, "participantIdentities") {
        let Some(player) = i.get("player") else { continue };
        let puuid = text(player, "puuid");
        if let (false, Some(name)) = (puuid.is_empty(), riot_name(player).filter(|n| n.contains('#'))) {
            seen.insert(puuid.to_string(), name);
        }
    }
}

/// "Hide on bush#KR1" → "hideonbush#kr1": searches ignore case and spaces.
fn squash(s: &str) -> String {
    s.chars().filter(|c| !c.is_whitespace()).flat_map(char::to_lowercase).collect()
}

/// Friends, then players from games seen this session, whose Riot ID contains
/// `query` (ignoring case and spaces), at most 8, names starting with it first.
/// The client's friends list (`/lol-chat/v1/friends`) has `gameName`,
/// `gameTag` and `puuid`.
pub fn player_hits(friends: &Value, query: &str) -> Vec<PlayerHit> {
    let seen = SEEN_PLAYERS.lock().unwrap().clone();
    hits(friends, &seen, query)
}

fn hits(friends: &Value, seen: &HashMap<String, String>, query: &str) -> Vec<PlayerHit> {
    let q = squash(query);
    let friends = friends.as_array().map(Vec::as_slice).unwrap_or_default().iter().filter_map(|f| {
        let (game, tag, puuid) = (text(f, "gameName"), text(f, "gameTag"), text(f, "puuid"));
        let name = if tag.is_empty() { game.to_string() } else { format!("{game}#{tag}") };
        (!game.is_empty() && !puuid.is_empty()).then(|| PlayerHit { puuid: puuid.to_string(), name, friend: true })
    });
    let others = seen.iter().map(|(puuid, name)| PlayerHit { puuid: puuid.clone(), name: name.clone(), friend: false });
    let mut out: Vec<PlayerHit> = Vec::new();
    for h in friends.chain(others) {
        if squash(&h.name).contains(&q) && !out.iter().any(|o| o.puuid == h.puuid) {
            out.push(h);
        }
    }
    out.sort_by_key(|h| (!h.friend, !squash(&h.name).starts_with(&q), h.name.to_lowercase()));
    out.truncate(8);
    out
}

/// Percent-encodes a query value.
fn encode(s: &str) -> String {
    s.bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => (b as char).to_string(),
            _ => format!("%{b:02X}"),
        })
        .collect()
}

/// Rank, match history and insights for a summoner from the client
/// (`current-summoner` or a lookup by puuid).
async fn load_summoner(lcu: &Lcu, summoner: &Value, history_path: &str, full_records: bool) -> MyProfile {
    let puuid = text(summoner, "puuid").to_string();
    let mut p = MyProfile {
        name: riot_name(summoner).unwrap_or_default(),
        icon_id: int(summoner, "profileIconId"),
        level: int(summoner, "summonerLevel"),
        puuid: puuid.clone(),
        source: "client".into(),
        ..Default::default()
    };
    let mut errors = Vec::new();
    let stats_path = format!("/lol-ranked/v1/ranked-stats/{puuid}");
    let (stats, history) = tokio::join!(lcu.get(&stats_path), lcu.get_slow(history_path));
    match stats {
        Ok(Some(stats)) => {
            p.solo = scout::parse_rank(&stats, "RANKED_SOLO_5x5");
            p.flex = scout::parse_rank(&stats, "RANKED_FLEX_SR");
        }
        Ok(None) => {}
        Err(e) => errors.push(format!("rank: {e:#}")),
    }
    match history {
        Ok(Some(h)) => p.matches = parse_matches(&h),
        Ok(None) => {}
        // `:#` adds the cause ("operation timed out") to "GET /lol-match-history/…".
        Err(e) => errors.push(format!("match history: {e:#}")),
    }
    let failed = fill_opponents(lcu, &puuid, &mut p.matches, full_records).await;
    if failed > 0 {
        errors.push(format!("{failed} full game {} (enemy stats)", if failed == 1 { "record" } else { "records" }));
    }
    p.insights = insights(&p.matches);
    p.modes = modes(&p.matches);
    if !errors.is_empty() {
        p.error = Some(errors.join("; "));
    }
    p
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn game(id: i64, created: i64, queue: i64, mode: &str, kind: &str, champ: i64, win: bool, remake: bool, k: i64, d: i64, a: i64) -> Value {
        json!({
            "gameId": id, "gameCreation": created, "gameDuration": 1800, "queueId": queue, "gameMode": mode, "gameType": kind,
            "participants": [{ "championId": champ, "spell1Id": 4, "spell2Id": 14, "stats": {
                "win": win, "gameEndedInEarlySurrender": remake, "kills": k, "deaths": d, "assists": a,
                "totalMinionsKilled": 200, "neutralMinionsKilled": 10, "goldEarned": 12000,
                "totalDamageDealtToChampions": 24000, "visionScore": 20, "champLevel": 16,
                "item0": 3020, "item1": 0, "item2": 0, "item3": 0, "item4": 0, "item5": 0, "item6": 3340
            }}]
        })
    }

    fn history() -> Value {
        json!({ "games": { "games": [
            game(1, 100, 420, "CLASSIC", "MATCHED_GAME", 157, true, false, 10, 2, 5),
            game(2, 300, 420, "CLASSIC", "MATCHED_GAME", 157, true, false, 4, 4, 4),
            game(3, 200, 400, "CLASSIC", "MATCHED_GAME", 103, false, false, 1, 6, 2),
            game(4, 400, 480, "SWIFTPLAY", "MATCHED_GAME", 157, true, true, 1, 0, 0),
            game(5, 500, 3100, "CLASSIC", "CUSTOM_GAME", 84, false, false, 0, 0, 0),
            game(6, 600, 2400, "BRAWL", "MATCHED_GAME", 64, true, false, 9, 9, 9),
            game(7, 700, 0, "CLASSIC", "MATCHED_GAME", 60103, true, false, 9, 9, 9),
        ]}})
    }

    #[test]
    fn leaves_out_custom_brawl_and_league_classic() {
        let m = parse_matches(&history());
        assert_eq!(m.iter().map(|m| m.game_id).collect::<Vec<_>>(), vec![4, 2, 3, 1]);
        assert_eq!(m[0].result, "remake");
        assert_eq!((m[1].line.cs, m[1].line.level, m[1].line.items.len(), m[1].line.spells), (210, 16, 7, [4, 14]));
    }

    #[test]
    fn insights_skip_remakes() {
        let ins = insights(&parse_matches(&history()));
        assert_eq!((ins.games, ins.wins, ins.kills, ins.deaths, ins.assists), (3, 2, 15, 12, 11));
        // 3 games x 30 min, 210 CS and 24k damage each.
        assert!((ins.cs_per_min - 7.0).abs() < 1e-9);
        assert!((ins.damage_per_min - 800.0).abs() < 1e-9);
        // Newest counted games: win (id 2), loss (id 3) -> streak of 1 win.
        assert_eq!(ins.streak, 1);
        assert_eq!(ins.champions[0], ChampStat { champion_id: 157, games: 2, wins: 2, kills: 14, deaths: 6, assists: 9 });
        assert_eq!(ins.queues[0], QueueStat { queue_id: 420, games: 2, wins: 2 });
    }

    fn player(pid: i64, team: i64, champ: i64, lane: &str, role: &str, smite: bool, cs: i64) -> Value {
        json!({ "participantId": pid, "teamId": team, "championId": champ, "spell1Id": 4, "spell2Id": if smite { 11 } else { 14 },
            "timeline": { "lane": lane, "role": role }, "stats": { "totalMinionsKilled": cs } })
    }

    fn sr_game() -> Value {
        let players = vec![
            player(1, 100, 1, "TOP", "SOLO", false, 180),
            // Jungle by Smite, though the client says mid.
            player(2, 100, 2, "MIDDLE", "SOLO", true, 40),
            player(3, 100, 3, "MIDDLE", "SOLO", false, 200),
            player(4, 100, 4, "BOTTOM", "DUO", false, 220),
            player(5, 100, 5, "BOTTOM", "DUO", false, 30),
            player(6, 200, 6, "TOP", "SOLO", false, 170),
            player(7, 200, 7, "JUNGLE", "NONE", true, 30),
            player(8, 200, 8, "MIDDLE", "SOLO", false, 190),
            player(9, 200, 9, "BOTTOM", "DUO_SUPPORT", false, 20),
            player(10, 200, 10, "BOTTOM", "DUO_CARRY", false, 210),
        ];
        let idents: Vec<Value> =
            (1..=10).map(|i| json!({ "participantId": i, "player": { "puuid": format!("p{i}") } })).collect();
        json!({ "mapId": 11, "participants": players, "participantIdentities": idents })
    }

    #[test]
    fn lane_opponents_from_the_full_record() {
        let g = sr_game();
        assert_eq!(opponents(&g, "p3").unwrap(), Opponents { lane: Some(8), enemies: vec![6, 7, 8, 9, 10] });
        assert_eq!(opponents(&g, "p2").unwrap().lane, Some(7));
        // Bot lane without roles: the one with less CS is the support.
        assert_eq!(opponents(&g, "p5").unwrap().lane, Some(9));
        assert_eq!(opponents(&g, "p4").unwrap().lane, Some(10));
        assert_eq!(opponents(&g, "p9").unwrap().lane, Some(5));
        assert_eq!(opponents(&g, "nobody"), None);
    }

    #[test]
    fn no_lane_opponent_when_unclear_or_off_the_rift() {
        let mut g = sr_game();
        // Two enemy mids: can't tell which one you laned against.
        g["participants"][5]["timeline"]["lane"] = json!("MIDDLE");
        assert_eq!(opponents(&g, "p3").unwrap().lane, None);
        assert_eq!(opponents(&g, "p1").unwrap().lane, None);
        let mut aram = sr_game();
        aram["mapId"] = json!(12);
        let o = opponents(&aram, "p3").unwrap();
        assert_eq!((o.lane, o.enemies.len()), (None, 5));
        // Arena: teamId doesn't mark who you played against.
        let mut arena = sr_game();
        arena["mapId"] = json!(30);
        assert_eq!(opponents(&arena, "p3").unwrap(), Opponents::default());
    }

    #[test]
    fn toughest_matchups_and_modes() {
        let mut m = parse_matches(&history());
        // Newest first: 4 (remake), 2 (win), 3 (loss), 1 (win).
        for i in 1..=3 {
            m[i].lane_opponent = Some(238);
            m[i].enemies = vec![7];
        }
        m[1].enemies.push(238);
        m[2].enemies.push(238);
        m[0].enemies = vec![7];
        let ins = insights(&m);
        // 2-1 against 238 and 7: not tough.
        assert!(ins.toughest_lanes.is_empty() && ins.toughest_enemies.is_empty());
        m[1].result = "loss".into();
        let ins = insights(&m);
        assert_eq!(ins.toughest_lanes, vec![ChampStat { champion_id: 238, games: 3, wins: 1, kills: 15, deaths: 12, assists: 11 }]);
        assert_eq!(lane_record(&m, 238), ins.toughest_lanes[0]);
        assert_eq!((lane_record(&m, 7).games, lane_record(&m, 7).champion_id), (0, 7));
        // The remake doesn't count: 238 is 0-2, 7 is 1-2.
        let tough: Vec<_> = ins.toughest_enemies.iter().map(|c| (c.champion_id, c.games, c.wins)).collect();
        assert_eq!(tough, vec![(238, 2, 0), (7, 3, 1)]);
        let modes = modes(&m);
        let games: Vec<_> = modes.iter().map(|q| (q.queue_id, q.insights.games)).collect();
        assert_eq!(games, vec![(420, 2), (400, 1), (480, 0)]);
    }

    #[test]
    fn empty_history() {
        let ins = insights(&[]);
        assert_eq!((ins.games, ins.streak, ins.cs_per_min), (0, 0, 0.0));
    }

    #[test]
    fn players_matching_a_search() {
        let friends = serde_json::json!([
            { "gameName": "Hubcus", "gameTag": "NA1", "puuid": "a" },
            { "gameName": "Big Hub", "gameTag": "777", "puuid": "b" },
            { "gameName": "Tylor", "gameTag": "NA1", "puuid": "c" },
            { "gameName": "", "gameTag": "", "puuid": "d" },
        ]);
        let seen: HashMap<String, String> = [("e", "Hub Shrub#KR1"), ("a", "Hubcus#NA1"), ("f", "Hide on bush#KR1")]
            .into_iter()
            .map(|(p, n)| (p.to_string(), n.to_string()))
            .collect();
        let names: Vec<_> = hits(&friends, &seen, "HUB").into_iter().map(|h| (h.name, h.friend)).collect();
        assert_eq!(names, vec![("Hubcus#NA1".into(), true), ("Big Hub#777".into(), true), ("Hub Shrub#KR1".into(), false)]);
        assert_eq!(hits(&friends, &seen, "hideonbush")[0].name, "Hide on bush#KR1");
        assert_eq!(default_tag("na"), "NA1");
        assert_eq!(default_tag("xx"), "XX");
    }

    #[test]
    fn query_encoding() {
        assert_eq!(encode("Hide on bush"), "Hide%20on%20bush");
        assert_eq!(encode("Né#KR1"), "N%C3%A9%23KR1");
    }

    #[test]
    fn allowed_games() {
        assert!(allowed(&json!({"gameMode": "CLASSIC", "queueId": 420}), 157));
        assert!(!allowed(&json!({"gameMode": "BRAWL", "queueId": 0}), 157));
        assert!(!allowed(&json!({"gameMode": "CLASSIC", "queueId": 420}), 60157));
    }
}
