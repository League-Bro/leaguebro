//! Post-game summary, built from the League client's match-history record
//! (`/lol-match-history/v1/games/{gameId}`) once the game has ended.

use crate::profile;
use crate::util::{flag, int, list, text};
use serde::Serialize;
use serde_json::Value;
use std::collections::HashMap;

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
    /// Your team's gold lead each minute (see `gold_lead`); empty without a timeline.
    pub gold_lead: Vec<GoldPoint>,
    /// LP gained or lost, for ranked games League Bro saw your rank around.
    pub lp_change: Option<crate::lp_history::LpChange>,
}

/// Your team's gold minus the other team's at a game time.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct GoldPoint {
    /// Seconds.
    pub t: i64,
    pub lead: i64,
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
    /// "top", "jungle", "mid", "adc" or "support"; None outside a 5v5 on
    /// Summoner's Rift or when it's unclear (`profile::positions`).
    pub position: Option<&'static str>,
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

/// `lanes` is OP.GG's games per lane for each champion (`TierLists::lane_games`,
/// may be empty), for players whose lane the record doesn't say.
pub fn parse(game: &Value, my_puuid: &str, queue_name: &str, lanes: &HashMap<i64, [i64; 5]>) -> Option<PostGame> {
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
            (int(p, "teamId"), PostPlayer { puuid, name, is_me, position: None, line: PlayerLine::parse(p) }, p)
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
            let rows: Vec<&(i64, PostPlayer, &Value)> = players.iter().filter(|(t, _, _)| *t == id).collect();
            // Positions only mean something in a 5v5 on Summoner's Rift.
            let raw: Vec<&Value> = rows.iter().map(|(_, _, raw)| *raw).collect();
            let positions = (int(game, "mapId") == 11 && rows.len() == 5 && players.len() == 10)
                .then(|| assign_lanes(&raw, &profile::positions(&raw), lanes));
            let mut members: Vec<PostPlayer> = rows
                .iter()
                .enumerate()
                .map(|(i, (_, p, _))| PostPlayer { position: positions.as_ref().and_then(|l| l[i]), ..p.clone() })
                .collect();
            // Top to support, so each row sits across from its lane opponent on the other team.
            // Players without a position keep their order, after the rest.
            members.sort_by_key(|p| lane_rank(p.position));
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
        gold_lead: Vec::new(),
        lp_change: None,
    })
}

/// The client's timeline for a game.
pub fn timeline_path(game_id: i64) -> String {
    format!("/lol-match-history/v1/game-timelines/{game_id}")
}

/// Your team's gold lead from the game's timeline (one frame a minute, each
/// player's `totalGold`). `game` is the match-history record, for who's on which
/// team. Empty when there's no other team or no frames.
pub fn gold_lead(game: &Value, timeline: &Value, my_team: i64) -> Vec<GoldPoint> {
    let teams: std::collections::HashMap<i64, i64> =
        list(game, "participants").iter().map(|p| (int(p, "participantId"), int(p, "teamId"))).collect();
    if !teams.values().any(|t| *t != my_team) {
        return Vec::new();
    }
    let mut points = list(timeline, "frames")
        .iter()
        .map(|f| {
            // An object keyed by participant id ("1".."10"); accept a list too.
            let frames: Vec<&Value> = match f.get("participantFrames") {
                Some(Value::Object(m)) => m.values().collect(),
                Some(Value::Array(a)) => a.iter().collect(),
                _ => Vec::new(),
            };
            let lead = frames
                .iter()
                .map(|p| {
                    let gold = int(p, "totalGold");
                    match teams.get(&int(p, "participantId")) {
                        Some(t) if *t == my_team => gold,
                        Some(_) => -gold,
                        None => 0,
                    }
                })
                .sum();
            GoldPoint { t: int(f, "timestamp") / 1000, lead }
        })
        .collect::<Vec<_>>();
    // Frames come once a minute, so the last one is up to a minute before the
    // end. The graph ends on the final gold instead (`goldEarned`, what the
    // team totals add up), so its lead matches the scoreboard.
    if !points.is_empty() {
        let end = int(game, "gameDuration");
        let lead = list(game, "participants")
            .iter()
            .map(|p| if int(p, "teamId") == my_team { 1 } else { -1 } * int(p, "/stats/goldEarned"))
            .sum();
        if points.last().is_some_and(|l| l.t >= end) {
            points.pop();
        }
        points.push(GoldPoint { t: end, lead });
    }
    points
}

/// Positions in scoreboard order, the same order as `tierlist::LANES`.
const POSITIONS: [&str; 5] = ["top", "jungle", "mid", "adc", "support"];

/// Puts each of a team's five players in a different lane, so every row on the
/// scoreboard faces its lane opponent. The record's `timeline.lane`/`role` is
/// often missing (custom games, and unreliable elsewhere), so `guess`
/// (`profile::positions`) only weighs in, next to Smite, the support item, CS
/// and how often OP.GG sees each champion in each lane. Tries all 120 ways.
fn assign_lanes(team: &[&Value], guess: &[Option<&'static str>], lanes: &HashMap<i64, [i64; 5]>) -> Vec<Option<&'static str>> {
    let minions = |p: &Value| int(p, "/stats/totalMinionsKilled");
    let fewest_minions = team.iter().map(|p| minions(p)).min().unwrap_or(0);
    let score = |i: usize, lane: usize| -> f64 {
        let p = team[i];
        let mut s = 0.0;
        if guess[i] == Some(POSITIONS[lane]) {
            s += 3.0;
        }
        let smite = int(p, "spell1Id") == 11 || int(p, "spell2Id") == 11;
        s += match (smite, lane) {
            (true, 1) => 6.0,
            (true, _) | (false, 1) => -6.0,
            _ => 0.0,
        };
        // World Atlas and its upgrades.
        let support_item = (0..=6).any(|k| (3865..=3877).contains(&int(p, &format!("/stats/item{k}"))));
        if support_item && lane == 4 {
            s += 5.0;
        }
        if lane == 4 && minions(p) == fewest_minions {
            s += 1.5;
        }
        if let Some(games) = lanes.get(&int(p, "championId")) {
            let total: i64 = games.iter().sum();
            if total > 0 {
                s += (games[lane] as f64 / total as f64 + 0.01).ln();
            }
        }
        s
    };
    let mut best = (f64::NEG_INFINITY, [0usize; 5]);
    let mut lane_of = [0usize; 5];
    fn search(i: usize, used: &mut [bool; 5], lane_of: &mut [usize; 5], total: f64, score: &dyn Fn(usize, usize) -> f64, best: &mut (f64, [usize; 5])) {
        if i == 5 {
            if total > best.0 {
                *best = (total, *lane_of);
            }
            return;
        }
        for lane in 0..5 {
            if !used[lane] {
                used[lane] = true;
                lane_of[i] = lane;
                search(i + 1, used, lane_of, total + score(i, lane), score, best);
                used[lane] = false;
            }
        }
    }
    if team.len() != 5 {
        return guess.to_vec();
    }
    search(0, &mut [false; 5], &mut lane_of, 0.0, &score, &mut best);
    best.1.iter().map(|&l| Some(POSITIONS[l])).collect()
}

/// OP.GG's games per lane for every champion (for `parse`); empty when it can't be loaded.
pub async fn lane_games(state: &crate::engine::AppState) -> HashMap<i64, [i64; 5]> {
    let names: Vec<(i64, String)> = state
        .shared
        .lock()
        .await
        .statics
        .as_ref()
        .map(|s| s.champions.iter().filter(|c| !c.classic).map(|c| (c.id, c.name.clone())).collect())
        .unwrap_or_default();
    state.tiers.lane_games(Some(names).filter(|n| !n.is_empty())).await.unwrap_or_else(|e| {
        eprintln!("post-game lanes: {e:#}");
        HashMap::new()
    })
}

/// Scoreboard order for a position: top, jungle, mid, ADC, support, then unknown.
pub fn lane_rank(position: Option<&str>) -> usize {
    match position {
        Some("top") => 0,
        Some("jungle") => 1,
        Some("mid") => 2,
        Some("adc") => 3,
        Some("support") => 4,
        _ => 5,
    }
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
        let g = parse(&fixture(), "me-puuid", "Ranked Solo/Duo", &HashMap::new()).unwrap();
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
        // Only 4 players, so no positions.
        assert!(g.teams.iter().flat_map(|t| &t.players).all(|p| p.position.is_none()));
    }

    #[test]
    fn positions_in_a_full_rift_game() {
        let lanes = [("TOP", "SOLO"), ("JUNGLE", "NONE"), ("MIDDLE", "SOLO"), ("BOTTOM", "DUO"), ("BOTTOM", "DUO")];
        let cs = [180, 40, 200, 230, 30];
        let mut parts = Vec::new();
        let mut idents = Vec::new();
        for i in 0..10 {
            let (lane, role) = lanes[i % 5];
            let id = i + 1;
            parts.push(serde_json::json!({ "participantId": id, "teamId": if i < 5 { 100 } else { 200 }, "championId": id,
                "spell1Id": 4, "spell2Id": if i % 5 == 1 { 11 } else { 14 }, "timeline": { "lane": lane, "role": role },
                "stats": { "totalMinionsKilled": cs[i % 5] } }));
            idents.push(serde_json::json!({ "participantId": id, "player": { "puuid": format!("p{id}") } }));
        }
        let g = serde_json::json!({ "mapId": 11, "gameDuration": 1800, "participants": parts, "participantIdentities": idents,
            "teams": [{ "teamId": 100 }, { "teamId": 200 }] });
        let pg = parse(&g, "p5", "", &HashMap::new()).unwrap();
        let mine: Vec<_> = pg.teams[0].players.iter().map(|p| p.position).collect();
        assert_eq!(mine, [Some("top"), Some("jungle"), Some("mid"), Some("adc"), Some("support")]);
        assert_eq!(pg.teams[1].players[3].position, Some("adc"));
        // Listed out of lane order, the enemies still come out top to support, facing their lane opponents.
        let mut shuffled = g.clone();
        shuffled["participants"].as_array_mut().unwrap()[5..].reverse();
        let theirs: Vec<_> = parse(&shuffled, "p5", "", &HashMap::new()).unwrap().teams[1].players.iter().map(|p| p.position).collect();
        assert_eq!(theirs, [Some("top"), Some("jungle"), Some("mid"), Some("adc"), Some("support")]);
        // No lane in the record (seen in custom games): Smite, the support item, CS and OP.GG's lane stats place them.
        let mut blank = g.clone();
        for (i, p) in blank["participants"].as_array_mut().unwrap().iter_mut().enumerate() {
            p["timeline"] = serde_json::json!({ "lane": "NONE", "role": "NONE" });
            if i % 5 == 4 {
                p["stats"]["item0"] = serde_json::json!(3867);
            }
        }
        blank["participants"].as_array_mut().unwrap()[5..].reverse();
        // Champion ids are 1-10: 1/6 top, 3/8 mid, 4/9 bot.
        let lanes: HashMap<i64, [i64; 5]> = [(1, [900, 0, 100, 0, 0]), (6, [900, 0, 100, 0, 0]), (3, [50, 0, 950, 0, 0]),
            (8, [50, 0, 950, 0, 0]), (4, [0, 0, 20, 980, 0]), (9, [0, 0, 20, 980, 0])].into();
        let pg = parse(&blank, "p5", "", &lanes).unwrap();
        for t in &pg.teams {
            let champs: Vec<i64> = t.players.iter().map(|p| p.line.champion_id).collect();
            let base = if t.team_id == 100 { 0 } else { 5 };
            assert_eq!(champs, [1, 2, 3, 4, 5].map(|c| c + base), "team {}", t.team_id);
        }
        let mut aram = g.clone();
        aram["mapId"] = serde_json::json!(12);
        assert!(parse(&aram, "p5", "", &HashMap::new()).unwrap().teams[0].players.iter().all(|p| p.position.is_none()));
    }

    #[test]
    fn loss_from_the_other_side() {
        let g = parse(&fixture(), "enemy-puuid", "", &HashMap::new()).unwrap();
        assert_eq!(g.result, "loss");
        assert_eq!(g.teams[0].team_id, 200);
        assert!(g.teams[0].players[0].is_me);
    }

    #[test]
    fn unknown_player_gives_nothing() {
        assert_eq!(parse(&fixture(), "someone-else", "", &HashMap::new()), None);
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
        let pg = parse(&g, "p", "", &HashMap::new()).unwrap();
        assert_eq!(pg.result, "remake");
        assert_eq!(pg.teams.len(), 1);
        assert!(pg.teams[0].players[0].is_me);
    }

    #[test]
    fn gold_lead_from_timeline() {
        use serde_json::json;
        let game = json!({ "gameDuration": 95, "participants": [
            { "participantId": 1, "teamId": 100, "stats": { "goldEarned": 1700 } }, { "participantId": 2, "teamId": 200, "stats": { "goldEarned": 1300 } }
        ]});
        let timeline = json!({ "frames": [
            { "timestamp": 0, "participantFrames": { "1": { "participantId": 1, "totalGold": 500 }, "2": { "participantId": 2, "totalGold": 500 } } },
            { "timestamp": 60_030, "participantFrames": { "1": { "participantId": 1, "totalGold": 1200 }, "2": { "participantId": 2, "totalGold": 900 } } }
        ]});
        // Ends on the final gold, the same numbers as the team totals.
        let lead = gold_lead(&game, &timeline, 200);
        assert_eq!(lead, vec![GoldPoint { t: 0, lead: 0 }, GoldPoint { t: 60, lead: -300 }, GoldPoint { t: 95, lead: -400 }]);
        assert!(gold_lead(&json!({ "participants": [{ "participantId": 1, "teamId": 100 }] }), &timeline, 100).is_empty());
    }
}
