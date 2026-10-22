//! Your own profile: rank, recent matches and insights, from the League
//! client's match history (`/lol-match-history/v1/products/lol/{puuid}/matches`).
//!
//! Custom and practice games are left out, and so are Brawl and League
//! Classic games, which Riot's third-party rules don't allow match data for.

use crate::lcu::Lcu;
use crate::scout::{self, RankLine};
use serde::Serialize;
use serde_json::Value;
use std::collections::HashMap;

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
    pub champion_id: i64,
    pub kills: i64,
    pub deaths: i64,
    pub assists: i64,
    pub cs: i64,
    pub gold: i64,
    pub damage: i64,
    pub vision: i64,
    pub items: Vec<i64>,
    pub spells: [i64; 2],
}

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
    pub insights: Insights,
    pub error: Option<String>,
}

/// Games League Bro may show match data for. Brawl's markers (mode `BRAWL`,
/// queue 2400) haven't been seen in a real response yet.
pub fn allowed(game: &Value, champion_id: i64) -> bool {
    let mode = game.get("gameMode").and_then(Value::as_str).unwrap_or("");
    let queue = game.get("queueId").and_then(Value::as_i64).unwrap_or(0);
    let brawl = mode.eq_ignore_ascii_case("BRAWL") || queue == 2400;
    let league_classic = champion_id >= 60000;
    !brawl && !league_classic
}

fn is_custom(game: &Value) -> bool {
    game.get("gameType").and_then(Value::as_str) == Some("CUSTOM_GAME")
}

/// Your line from each game in a match-history response, newest first.
pub fn parse_matches(history: &Value) -> Vec<MatchLine> {
    let games = history.pointer("/games/games").and_then(Value::as_array).cloned().unwrap_or_default();
    let n = |v: &Value, k: &str| v.get(k).and_then(Value::as_i64).unwrap_or(0);
    let mut out: Vec<MatchLine> = games
        .iter()
        .filter(|g| !is_custom(g))
        .filter_map(|g| {
            // This endpoint returns only the requested player in each game.
            let p = g.get("participants")?.as_array()?.first()?;
            let champion_id = n(p, "championId");
            if !allowed(g, champion_id) {
                return None;
            }
            let s = p.get("stats").cloned().unwrap_or(Value::Null);
            let remake = s.get("gameEndedInEarlySurrender").and_then(Value::as_bool).unwrap_or(false);
            let win = s.get("win").and_then(Value::as_bool).unwrap_or(false);
            Some(MatchLine {
                game_id: n(g, "gameId"),
                queue_id: n(g, "queueId"),
                game_mode: g.get("gameMode").and_then(Value::as_str).unwrap_or("").to_string(),
                created: n(g, "gameCreation"),
                duration: n(g, "gameDuration"),
                result: (if remake { "remake" } else if win { "win" } else { "loss" }).to_string(),
                champion_id,
                kills: n(&s, "kills"),
                deaths: n(&s, "deaths"),
                assists: n(&s, "assists"),
                cs: n(&s, "totalMinionsKilled") + n(&s, "neutralMinionsKilled"),
                gold: n(&s, "goldEarned"),
                damage: n(&s, "totalDamageDealtToChampions"),
                vision: n(&s, "visionScore"),
                items: (0..=6).map(|i| n(&s, &format!("item{i}"))).collect(),
                spells: [n(p, "spell1Id"), n(p, "spell2Id")],
            })
        })
        .collect();
    out.sort_by(|a, b| b.created.cmp(&a.created));
    out
}

/// `matches` newest first.
pub fn insights(matches: &[MatchLine]) -> Insights {
    let counted: Vec<&MatchLine> = matches.iter().filter(|m| m.result != "remake").collect();
    let mut ins = Insights { games: counted.len() as i64, ..Default::default() };
    let minutes: f64 = counted.iter().map(|m| m.duration as f64 / 60.0).sum();
    let mut champs: HashMap<i64, ChampStat> = HashMap::new();
    let mut queues: HashMap<i64, QueueStat> = HashMap::new();
    for m in &counted {
        let win = m.result == "win";
        ins.wins += win as i64;
        ins.kills += m.kills;
        ins.deaths += m.deaths;
        ins.assists += m.assists;
        let c = champs.entry(m.champion_id).or_insert_with(|| ChampStat { champion_id: m.champion_id, ..Default::default() });
        c.games += 1;
        c.wins += win as i64;
        c.kills += m.kills;
        c.deaths += m.deaths;
        c.assists += m.assists;
        let q = queues.entry(m.queue_id).or_insert_with(|| QueueStat { queue_id: m.queue_id, ..Default::default() });
        q.games += 1;
        q.wins += win as i64;
    }
    if minutes > 0.0 {
        let per_min = |f: fn(&MatchLine) -> i64| counted.iter().map(|m| f(m)).sum::<i64>() as f64 / minutes;
        ins.cs_per_min = per_min(|m| m.cs);
        ins.damage_per_min = per_min(|m| m.damage);
        ins.gold_per_min = per_min(|m| m.gold);
    }
    if !counted.is_empty() {
        ins.vision_per_game = counted.iter().map(|m| m.vision).sum::<i64>() as f64 / counted.len() as f64;
        let first = counted[0].result == "win";
        let len = counted.iter().take_while(|m| (m.result == "win") == first).count() as i64;
        ins.streak = if first { len } else { -len };
    }
    ins.champions = champs.into_values().collect();
    ins.champions.sort_by(|a, b| b.games.cmp(&a.games).then(b.wins.cmp(&a.wins)).then(a.champion_id.cmp(&b.champion_id)));
    ins.queues = queues.into_values().collect();
    ins.queues.sort_by(|a, b| b.games.cmp(&a.games).then(a.queue_id.cmp(&b.queue_id)));
    ins
}

pub async fn load(lcu: &Lcu) -> anyhow::Result<MyProfile> {
    let me = lcu.get_req("/lol-summoner/v1/current-summoner").await?;
    let puuid = me.get("puuid").and_then(Value::as_str).unwrap_or("").to_string();
    let mut p = MyProfile {
        name: crate::engine::riot_name(&me).unwrap_or_default(),
        icon_id: me.get("profileIconId").and_then(Value::as_i64).unwrap_or(0),
        level: me.get("summonerLevel").and_then(Value::as_i64).unwrap_or(0),
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
    p.insights = insights(&p.matches);
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
        assert_eq!((m[1].cs, m[1].items.len(), m[1].spells), (210, 7, [4, 14]));
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
