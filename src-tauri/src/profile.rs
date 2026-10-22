//! Your own profile: rank, recent matches and insights, from the League
//! client's match history (`/lol-match-history/v1/products/lol/{puuid}/matches`).
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
fn positions(team: &[&Value]) -> Vec<Option<&'static str>> {
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
/// records didn't load.
async fn fill_opponents(lcu: &Lcu, puuid: &str, matches: &mut [MatchLine]) -> usize {
    let missing: Vec<i64> = {
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
        match done.map(|(id, res)| (id, res.ok().flatten().and_then(|g| opponents(&g, puuid)))) {
            Ok((id, Some(o))) => {
                OPPONENTS.lock().unwrap().insert((puuid.to_string(), id), o);
            }
            _ => failed += 1,
        }
    }
    let cache = OPPONENTS.lock().unwrap();
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

pub async fn load(lcu: &Lcu) -> anyhow::Result<MyProfile> {
    let me = lcu.get_req("/lol-summoner/v1/current-summoner").await?;
    let puuid = text(&me, "puuid").to_string();
    let mut p = MyProfile {
        name: riot_name(&me).unwrap_or_default(),
        icon_id: int(&me, "profileIconId"),
        level: int(&me, "summonerLevel"),
        puuid: puuid.clone(),
        ..Default::default()
    };
    let mut errors = Vec::new();
    match lcu.get(&format!("/lol-ranked/v1/ranked-stats/{puuid}")).await {
        Ok(Some(stats)) => {
            p.solo = scout::parse_rank(&stats, "RANKED_SOLO_5x5");
            p.flex = scout::parse_rank(&stats, "RANKED_FLEX_SR");
        }
        Ok(None) => {}
        Err(e) => errors.push(format!("rank: {e}")),
    }
    // The client keeps a few dozen recent games; ask for more than it has.
    match lcu.get(&format!("/lol-match-history/v1/products/lol/{puuid}/matches?begIndex=0&endIndex=99")).await {
        Ok(Some(h)) => p.matches = parse_matches(&h),
        Ok(None) => {}
        Err(e) => errors.push(format!("match history: {e}")),
    }
    let (failed, session) = tokio::join!(fill_opponents(lcu, &puuid, &mut p.matches), lcu.get("/lol-gameflow/v1/session"));
    if failed > 0 {
        errors.push(format!("{failed} full game {} (enemy stats)", if failed == 1 { "record" } else { "records" }));
    }
    p.insights = insights(&p.matches);
    p.modes = modes(&p.matches);
    if let Ok(Some(s)) = session {
        p.current_queue_id = s.pointer("/gameData/queue/id").and_then(Value::as_i64).filter(|q| *q > 0);
    }
    if !errors.is_empty() {
        p.error = Some(errors.join("; "));
    }
    Ok(p)
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
                "totalDamageDealtToChampions": 24000, "visionScore": 20,
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
        assert_eq!((m[1].line.cs, m[1].line.items.len(), m[1].line.spells), (210, 7, [4, 14]));
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
    fn allowed_games() {
        assert!(allowed(&json!({"gameMode": "CLASSIC", "queueId": 420}), 157));
        assert!(!allowed(&json!({"gameMode": "BRAWL", "queueId": 0}), 157));
        assert!(!allowed(&json!({"gameMode": "CLASSIC", "queueId": 420}), 60157));
    }
}
