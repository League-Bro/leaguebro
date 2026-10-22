//! Post-game summary, built from the League client's match-history record
//! (`/lol-match-history/v1/games/{gameId}`) once the game has ended.

use crate::util::{flag, int, list, text};
use serde::Serialize;
use serde_json::Value;

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PostGame {
    pub game_id: i64,
    pub queue_id: i64,
    pub queue_name: String,
    pub game_mode: String,
    /// Seconds.
    pub duration: i64,
    /// "win", "loss" or "remake".
    pub result: String,
    /// Your team first.
    pub teams: Vec<PostTeam>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PostTeam {
    pub team_id: i64,
    pub win: bool,
    pub is_mine: bool,
    pub kills: i64,
    pub gold: i64,
    pub dragons: i64,
    pub barons: i64,
    pub towers: i64,
    pub players: Vec<PostPlayer>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PostPlayer {
    pub puuid: String,
    /// Riot ID, or None for bots and hidden players.
    pub name: Option<String>,
    pub is_me: bool,
    #[serde(flatten)]
    pub line: PlayerLine,
}

/// One player's numbers from a match-history record, shared by the
/// scoreboard and the profile's match list.
#[derive(Debug, Clone, Serialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct PlayerLine {
    pub champion_id: i64,
    pub level: i64,
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

impl PlayerLine {
    /// `p` is one of the record's `participants`.
    pub fn parse(p: &Value) -> PlayerLine {
        let s = |k: &str| int(p, &format!("/stats/{k}"));
        PlayerLine {
            champion_id: int(p, "championId"),
            level: s("champLevel"),
            kills: s("kills"),
            deaths: s("deaths"),
            assists: s("assists"),
            cs: s("totalMinionsKilled") + s("neutralMinionsKilled"),
            gold: s("goldEarned"),
            damage: s("totalDamageDealtToChampions"),
            vision: s("visionScore"),
            items: (0..=6).map(|i| s(&format!("item{i}"))).collect(),
            spells: [int(p, "spell1Id"), int(p, "spell2Id")],
        }
    }
}

/// "win", "loss" or "remake" for one of the record's `participants`.
pub fn result(p: &Value) -> &'static str {
    if flag(p, "/stats/gameEndedInEarlySurrender") {
        "remake"
    } else if flag(p, "/stats/win") {
        "win"
    } else {
        "loss"
    }
}

pub fn parse(game: &Value, my_puuid: &str, queue_name: &str) -> Option<PostGame> {
    let idents = list(game, "participantIdentities");
    let mut players: Vec<(i64, PostPlayer, &Value)> = list(game, "participants")
        .iter()
        .map(|p| {
            let pid = int(p, "participantId");
            let player = idents.iter().find(|i| int(i, "participantId") == pid).map_or(&Value::Null, |i| &i["player"]);
            let puuid = text(player, "puuid").to_string();
            let name = match (text(player, "gameName"), text(player, "tagLine")) {
                ("", _) => None,
                (g, "") => Some(g.to_string()),
                (g, t) => Some(format!("{g}#{t}")),
            };
            let is_me = !puuid.is_empty() && puuid == my_puuid;
            (int(p, "teamId"), PostPlayer { puuid, name, is_me, line: PlayerLine::parse(p) }, p)
        })
        .collect();
    // A solo custom game may not carry the puuid we know; one player means it's us.
    if players.len() == 1 {
        players[0].1.is_me = true;
    }
    let &(my_team, _, me) = players.iter().find(|(_, p, _)| p.is_me)?;

    let mut team_ids: Vec<i64> = players.iter().map(|(t, _, _)| *t).collect();
    team_ids.sort();
    team_ids.dedup();
    team_ids.sort_by_key(|t| *t != my_team);
    let teams = team_ids
        .into_iter()
        .map(|id| {
            let row = list(game, "teams").iter().find(|t| int(t, "teamId") == id).unwrap_or(&Value::Null);
            let members: Vec<PostPlayer> = players.iter().filter(|(t, _, _)| *t == id).map(|(_, p, _)| p.clone()).collect();
            PostTeam {
                team_id: id,
                win: text(row, "win") == "Win",
                is_mine: id == my_team,
                kills: members.iter().map(|p| p.line.kills).sum(),
                gold: members.iter().map(|p| p.line.gold).sum(),
                dragons: int(row, "dragonKills"),
                barons: int(row, "baronKills"),
                towers: int(row, "towerKills"),
                players: members,
            }
        })
        .collect();

    let completed = game.get("endOfGameResult").and_then(Value::as_str).is_none_or(|r| r == "GameComplete");
    Some(PostGame {
        game_id: int(game, "gameId"),
        queue_id: int(game, "queueId"),
        queue_name: queue_name.to_string(),
        game_mode: text(game, "gameMode").to_string(),
        duration: int(game, "gameDuration"),
        result: (if completed { result(me) } else { "remake" }).to_string(),
        teams,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture() -> Value {
        let text = std::fs::read_to_string(format!("{}/tests/fixtures/match_game.json", env!("CARGO_MANIFEST_DIR"))).unwrap();
        serde_json::from_str(&text).unwrap()
    }

    #[test]
    fn full_game() {
        let g = parse(&fixture(), "me-puuid", "Ranked Solo/Duo").unwrap();
        assert_eq!(g.result, "win");
        assert_eq!(g.duration, 1834);
        assert_eq!(g.queue_name, "Ranked Solo/Duo");
        assert_eq!(g.teams.len(), 2);
        let mine = &g.teams[0];
        assert!(mine.is_mine && mine.win);
        assert_eq!((mine.kills, mine.dragons, mine.barons, mine.towers), (15, 3, 1, 8));
        let me = &mine.players[0];
        assert!(me.is_me);
        assert_eq!(me.name.as_deref(), Some("Me#NA1"));
        assert_eq!((me.line.kills, me.line.deaths, me.line.assists, me.line.cs), (9, 2, 11, 220));
        assert_eq!(me.line.items, vec![6655, 3020, 4645, 0, 1058, 0, 3340]);
        assert!(!mine.players[1].is_me);
        let enemy = &g.teams[1];
        assert!(!enemy.is_mine && !enemy.win);
        assert_eq!(enemy.players[1].name, None);
    }

    #[test]
    fn loss_from_the_other_side() {
        let g = parse(&fixture(), "enemy-puuid", "").unwrap();
        assert_eq!(g.result, "loss");
        assert_eq!(g.teams[0].team_id, 200);
        assert!(g.teams[0].players[0].is_me);
    }

    #[test]
    fn unknown_player_gives_nothing() {
        assert_eq!(parse(&fixture(), "someone-else", ""), None);
    }

    #[test]
    fn aborted_solo_custom_is_a_remake() {
        // Shape of a real practice/custom game that ended early.
        let g: Value = serde_json::json!({
            "endOfGameResult": "Abort_TooFewPlayers", "gameDuration": 104, "gameId": 1, "gameMode": "CLASSIC", "queueId": 3100,
            "participantIdentities": [{ "participantId": 1, "player": { "gameName": "Solo", "tagLine": "NA1", "puuid": "p" } }],
            "participants": [{ "participantId": 1, "teamId": 100, "championId": 84,
                "stats": { "win": false, "kills": 0, "deaths": 0, "assists": 0, "totalMinionsKilled": 1, "neutralMinionsKilled": 0 } }],
            "teams": [{ "teamId": 100, "win": "Fail" }]
        });
        let pg = parse(&g, "p", "").unwrap();
        assert_eq!(pg.result, "remake");
        assert_eq!(pg.teams.len(), 1);
        assert!(pg.teams[0].players[0].is_me);
    }
}
