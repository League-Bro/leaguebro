//! Player lookups (rank + recent games) through the local League client.
//! No Riot API key is needed: the client exposes these for any player.

use crate::profile::{parse_matches, MatchLine};
use crate::util::{int, text};
use crate::lcu::Lcu;
use serde::Serialize;
use serde_json::Value;
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RankLine {
    pub tier: String,
    pub division: String,
    pub lp: i64,
    pub wins: i64,
    pub losses: i64,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GameLine {
    pub champion_id: i64,
    pub win: bool,
    pub kills: i64,
    pub deaths: i64,
    pub assists: i64,
    pub queue_id: i64,
    pub created: i64,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ChampLine {
    pub champion_id: i64,
    pub games: i64,
    pub wins: i64,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Profile {
    pub puuid: String,
    pub solo: Option<RankLine>,
    pub flex: Option<RankLine>,
    pub recent_games: i64,
    pub recent_wins: i64,
    pub avg_kills: f64,
    pub avg_deaths: f64,
    pub avg_assists: f64,
    pub top_champs: Vec<ChampLine>,
    pub last_games: Vec<GameLine>,
    pub error: Option<String>,
}

pub fn parse_rank(stats: &Value, queue: &str) -> Option<RankLine> {
    let q = stats.get("queueMap").and_then(|m| m.get(queue)).or_else(|| {
        stats
            .get("queues")?
            .as_array()?
            .iter()
            .find(|q| q.get("queueType").and_then(Value::as_str) == Some(queue))
    })?;
    let tier = text(q, "tier");
    if tier.is_empty() || tier.eq_ignore_ascii_case("NONE") {
        return None;
    }
    let division = text(q, "division");
    Some(RankLine {
        tier: tier.to_string(),
        division: if division == "NA" { String::new() } else { division.to_string() },
        lp: int(q, "leaguePoints"),
        wins: int(q, "wins"),
        losses: int(q, "losses"),
    })
}

/// Short lines for a match-history response, newest first.
pub fn parse_history(history: &Value) -> Vec<GameLine> {
    let line = |m: MatchLine| GameLine {
        champion_id: m.line.champion_id,
        win: m.result == "win",
        kills: m.line.kills,
        deaths: m.line.deaths,
        assists: m.line.assists,
        queue_id: m.queue_id,
        created: m.created,
    };
    parse_matches(history).into_iter().map(line).collect()
}

pub fn summarize(puuid: &str, stats: Option<&Value>, games: Vec<GameLine>) -> Profile {
    let mut p = Profile { puuid: puuid.to_string(), ..Default::default() };
    if let Some(stats) = stats {
        p.solo = parse_rank(stats, "RANKED_SOLO_5x5");
        p.flex = parse_rank(stats, "RANKED_FLEX_SR");
    }
    let n = games.len() as i64;
    p.recent_games = n;
    p.recent_wins = games.iter().filter(|g| g.win).count() as i64;
    if n > 0 {
        let avg = |f: fn(&GameLine) -> i64| games.iter().map(f).sum::<i64>() as f64 / n as f64;
        p.avg_kills = avg(|g| g.kills);
        p.avg_deaths = avg(|g| g.deaths);
        p.avg_assists = avg(|g| g.assists);
    }
    let mut by_champ: HashMap<i64, (i64, i64)> = HashMap::new();
    for g in &games {
        let e = by_champ.entry(g.champion_id).or_default();
        e.0 += 1;
        if g.win {
            e.1 += 1;
        }
    }
    let mut champs: Vec<ChampLine> =
        by_champ.into_iter().map(|(champion_id, (games, wins))| ChampLine { champion_id, games, wins }).collect();
    champs.sort_by(|a, b| b.games.cmp(&a.games).then(b.wins.cmp(&a.wins)));
    champs.truncate(3);
    p.top_champs = champs;
    p.last_games = games.into_iter().take(10).collect();
    p
}

pub async fn lookup(lcu: &Lcu, puuid: &str) -> Profile {
    let stats = lcu.get(&format!("/lol-ranked/v1/ranked-stats/{puuid}")).await;
    let history = lcu
        .get(&format!("/lol-match-history/v1/products/lol/{puuid}/matches?begIndex=0&endIndex=19"))
        .await;
    let mut errors = Vec::new();
    let stats = match stats {
        Ok(v) => v,
        Err(e) => {
            errors.push(format!("rank: {e}"));
            None
        }
    };
    let games = match history {
        Ok(Some(h)) => parse_history(&h),
        Ok(None) => Vec::new(),
        Err(e) => {
            errors.push(format!("history: {e}"));
            Vec::new()
        }
    };
    let mut p = summarize(puuid, stats.as_ref(), games);
    if !errors.is_empty() {
        p.error = Some(errors.join("; "));
    }
    p
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn rank_from_queue_map() {
        let s = json!({"queueMap": {
            "RANKED_SOLO_5x5": {"tier": "GOLD", "division": "II", "leaguePoints": 41, "wins": 30, "losses": 25},
            "RANKED_FLEX_SR": {"tier": "", "division": "NA"}
        }});
        let r = parse_rank(&s, "RANKED_SOLO_5x5").unwrap();
        assert_eq!((r.tier.as_str(), r.division.as_str(), r.lp), ("GOLD", "II", 41));
        assert!(parse_rank(&s, "RANKED_FLEX_SR").is_none());
    }

    #[test]
    fn history_and_summary() {
        let game = |id: i64, champ: i64, win: bool, k: i64, created: i64| {
            json!({"gameId": id, "queueId": 420, "gameCreation": created,
                   "participantIdentities": [{"participantId": 1, "player": {"puuid": "abc"}}],
                   "participants": [{"participantId": 1, "championId": champ,
                       "stats": {"win": win, "kills": k, "deaths": 2, "assists": 4}}]})
        };
        let h = json!({"games": {"games": [game(1, 103, true, 6, 10), game(2, 103, false, 2, 30), game(3, 1, true, 10, 20)]}});
        let games = parse_history(&h);
        assert_eq!(games.len(), 3);
        assert_eq!(games[0].created, 30);
        let p = summarize("abc", None, games);
        assert_eq!((p.recent_games, p.recent_wins), (3, 2));
        assert!((p.avg_kills - 6.0).abs() < 1e-9);
        assert_eq!(p.top_champs[0], ChampLine { champion_id: 103, games: 2, wins: 1 });
    }
}
