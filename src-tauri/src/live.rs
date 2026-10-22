//! In-game data from Riot's Live Client Data API (https://127.0.0.1:2999),
//! which the game itself serves while a match is running.
//!
//! Only information already visible to you in game is used: the game clock,
//! objective kills and everyone's items (both on the scoreboard), and your own
//! gold. Nothing tracks enemy cooldowns, in line with Riot's third-party rules.

use crate::util::{float, int, list, text};
use crate::config::TimerConfig;
use serde::Serialize;
use serde_json::Value;
use std::collections::HashMap;

pub const LIVE_URL: &str = "https://127.0.0.1:2999/liveclientdata/allgamedata";

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Timer {
    pub key: String,
    pub label: String,
    /// Game time (seconds) when it spawns.
    pub spawn_at: f64,
    /// "ally" / "enemy" / "neutral", for colouring.
    pub side: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct NextItem {
    pub id: i64,
    pub name: String,
    pub price: i64,
    pub affordable: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct OverlayState {
    pub game_time: f64,
    pub game_mode: String,
    pub champion_name: String,
    pub gold: f64,
    pub kills: i64,
    pub deaths: i64,
    pub assists: i64,
    pub timers: Vec<Timer>,
    pub next_items: Vec<NextItem>,
    pub has_build: bool,
    /// Ability max order, e.g. ["Q", "W", "E"]; empty when the hint is off.
    pub skill_max: Vec<String>,
    /// Ability to put your next point in, when you have one unspent.
    pub next_skill: Option<String>,
    /// Your item value against your lane opponent's; None without roles (ARAM etc.).
    pub lane: Option<LaneDiff>,
}

/// Item value (total cost of the items each of you holds). The game doesn't
/// share enemy gold, so this is what the scoreboard lets you compare.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LaneDiff {
    pub opponent: String,
    pub mine: i64,
    pub theirs: i64,
}

fn item_value(player: &Value, items: &HashMap<i64, (String, i64)>) -> i64 {
    list(player, "items")
        .iter()
        .map(|it| {
            let price = items.get(&int(it, "itemID")).map_or_else(|| int(it, "price"), |(_, p)| *p);
            price * int(it, "count").max(1)
        })
        .sum()
}

/// The enemy in your position, compared by item value.
pub fn lane_diff(data: &Value, items: &HashMap<i64, (String, i64)>) -> Option<LaneDiff> {
    let me = find_me(data)?;
    let pos = text(me, "position");
    if pos.is_empty() || pos.eq_ignore_ascii_case("NONE") {
        return None;
    }
    let team = text(me, "team");
    let opp = list(data, "allPlayers")
        .iter()
        .find(|p| text(p, "team") != team && text(p, "position").eq_ignore_ascii_case(pos))?;
    Some(LaneDiff { opponent: text(opp, "championName").to_string(), mine: item_value(me, items), theirs: item_value(opp, items) })
}

/// What the overlay should suggest beyond timers.
#[derive(Default)]
pub struct Guidance<'a> {
    /// OP.GG's build order.
    pub build: Option<&'a [i64]>,
    pub skill_max: &'a [String],
    pub skill_order: &'a [String],
}

/// The ability to level next, if you have an unspent skill point, following
/// the recommended level-by-level order.
pub fn next_skill(data: &Value, order: &[String]) -> Option<String> {
    let ap = data.get("activePlayer")?;
    let level = ap.get("level").and_then(Value::as_i64)?;
    let abilities = ap.get("abilities")?;
    let spent: i64 = ["Q", "W", "E", "R"]
        .iter()
        .map(|k| int(abilities, &format!("/{k}/abilityLevel")))
        .sum();
    if spent >= level {
        return None;
    }
    order.get(spent as usize).cloned()
}

/// Every player's identifying names, so event KillerName can be matched.
fn player_names(p: &Value) -> Vec<String> {
    let mut v = Vec::new();
    for k in ["riotId", "summonerName", "riotIdGameName"] {
        let n = text(p, k);
        if !n.is_empty() {
            v.push(n.to_string());
            if let Some((game, _)) = n.split_once('#') {
                v.push(game.to_string());
            }
        }
    }
    v
}

pub fn find_me(data: &Value) -> Option<&Value> {
    let active = data.get("activePlayer")?;
    let my_names = player_names(active);
    list(data, "allPlayers").iter().find(|p| player_names(p).iter().any(|n| my_names.contains(n)))
}

/// Works out upcoming objective spawns from the event log.
pub fn compute_timers(data: &Value, cfg: &TimerConfig) -> Vec<Timer> {
    let now = float(data, "/gameData/gameTime");
    let my_team = find_me(data).map(|p| text(p, "team").to_string()).unwrap_or_default();
    let mut team_of: HashMap<String, String> = HashMap::new();
    for p in list(data, "allPlayers") {
        for n in player_names(p) {
            team_of.insert(n, text(p, "team").to_string());
        }
    }
    let side_of_team = |team: &str| -> String {
        if team.is_empty() || my_team.is_empty() {
            "neutral".into()
        } else if team == my_team {
            "ally".into()
        } else {
            "enemy".into()
        }
    };

    let mut last_dragon: Option<f64> = None;
    let mut dragons_by_team: HashMap<String, i64> = HashMap::new();
    let mut last_baron: Option<f64> = None;
    // inhib name -> (killed at, respawned?)
    let mut inhibs: HashMap<String, (f64, bool)> = HashMap::new();

    for e in list(data, "/events/Events") {
        let t = float(e, "EventTime");
        match text(e, "EventName") {
            "DragonKill" => {
                last_dragon = Some(t);
                if text(e, "DragonType") != "Elder" {
                    if let Some(team) = team_of.get(text(e, "KillerName")) {
                        *dragons_by_team.entry(team.clone()).or_default() += 1;
                    }
                }
            }
            "BaronKill" => last_baron = Some(t),
            "InhibKilled" => {
                inhibs.insert(text(e, "InhibKilled").to_string(), (t, false));
            }
            "InhibRespawned" => {
                if let Some(entry) = inhibs.get_mut(text(e, "InhibRespawned")) {
                    entry.1 = true;
                }
            }
            _ => {}
        }
    }

    let mut timers = Vec::new();
    let soul_taken = dragons_by_team.values().any(|&n| n >= 4);
    let (dragon_label, respawn) =
        if soul_taken { ("Elder", cfg.elder_respawn) } else { ("Dragon", cfg.dragon_respawn) };
    let dragon_at = match last_dragon {
        Some(t) => t + respawn,
        None => cfg.first_dragon,
    };
    if dragon_at > now {
        timers.push(Timer { key: "dragon".into(), label: dragon_label.into(), spawn_at: dragon_at, side: "neutral".into() });
    }
    let baron_at = match last_baron {
        Some(t) => t + cfg.baron_respawn,
        None => cfg.first_baron,
    };
    if baron_at > now {
        timers.push(Timer { key: "baron".into(), label: "Baron".into(), spawn_at: baron_at, side: "neutral".into() });
    }
    for (name, (t, respawned)) in &inhibs {
        let at = t + cfg.inhib_respawn;
        if *respawned || at <= now {
            continue;
        }
        // Names look like "Barracks_T1_L1": T1 is the blue side (ORDER),
        // T2 the red side (CHAOS); the letter is the lane.
        let owner = if name.contains("_T1_") { "ORDER" } else if name.contains("_T2_") { "CHAOS" } else { "" };
        let lane = if name.contains("_L") { "Top" } else if name.contains("_C") { "Mid" } else if name.contains("_R") { "Bot" } else { "" };
        let side = side_of_team(owner);
        let whose = match side.as_str() {
            "ally" => "Our",
            "enemy" => "Enemy",
            _ => "",
        };
        let label = format!("{whose} {lane} inhib").split_whitespace().collect::<Vec<_>>().join(" ");
        timers.push(Timer { key: format!("inhib-{name}"), label, spawn_at: at, side });
    }
    timers.sort_by(|a, b| a.spawn_at.total_cmp(&b.spawn_at));
    timers
}

/// Your next items from the recommended build.
pub fn next_items(
    data: &Value,
    build: &[i64],
    items: &HashMap<i64, (String, i64)>,
    limit: usize,
) -> Vec<NextItem> {
    let gold = float(data, "/activePlayer/currentGold");
    let mut owned_left: Vec<i64> = find_me(data).map(|p| list(p, "items").iter().map(|i| int(i, "itemID")).collect()).unwrap_or_default();
    let mut out = Vec::new();
    for id in build {
        // Each owned copy satisfies one entry, so a build listing an item
        // twice still asks for the second copy.
        if let Some(pos) = owned_left.iter().position(|o| o == id) {
            owned_left.remove(pos);
            continue;
        }
        let (name, price) = items.get(id).cloned().unwrap_or_else(|| (format!("Item {id}"), 0));
        out.push(NextItem { id: *id, name, price, affordable: price > 0 && gold >= price as f64 });
        if out.len() >= limit {
            break;
        }
    }
    out
}

pub fn overlay_state(
    data: &Value,
    cfg: &TimerConfig,
    guide: &Guidance,
    items: &HashMap<i64, (String, i64)>,
) -> OverlayState {
    let build = guide.build;
    let me = find_me(data);
    let score = |k: &str| me.and_then(|p| p.pointer(&format!("/scores/{k}"))).and_then(Value::as_i64).unwrap_or(0);
    OverlayState {
        game_time: float(data, "/gameData/gameTime"),
        game_mode: text(data, "/gameData/gameMode").to_string(),
        champion_name: me.map(|p| text(p, "championName").to_string()).unwrap_or_default(),
        gold: float(data, "/activePlayer/currentGold"),
        kills: score("kills"),
        deaths: score("deaths"),
        assists: score("assists"),
        timers: compute_timers(data, cfg),
        next_items: build.map(|b| next_items(data, b, items, 2)).unwrap_or_default(),
        has_build: build.map(|b| !b.is_empty()).unwrap_or(false),
        skill_max: guide.skill_max.to_vec(),
        next_skill: next_skill(data, guide.skill_order),
        lane: lane_diff(data, items),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn sample(now: f64, events: Value) -> Value {
        json!({
            "activePlayer": {"riotId": "Dom#NA1", "currentGold": 1300.0},
            "allPlayers": [
                {"riotId": "Dom#NA1", "championName": "Ahri", "team": "ORDER", "position": "MIDDLE",
                 "scores": {"kills": 3, "deaths": 1, "assists": 4, "creepScore": 120},
                 "items": [{"itemID": 1056}, {"itemID": 3020}]},
                {"riotId": "Ally#NA1", "championName": "Lee Sin", "team": "ORDER", "position": "JUNGLE", "items": []},
                {"riotId": "Foe#NA1", "championName": "Zed", "team": "CHAOS", "position": "MIDDLE", "items": []}
            ],
            "events": {"Events": events},
            "gameData": {"gameTime": now, "gameMode": "CLASSIC"}
        })
    }

    #[test]
    fn initial_spawns() {
        let t = compute_timers(&sample(60.0, json!([])), &TimerConfig::default());
        assert_eq!(t.iter().map(|t| t.key.as_str()).collect::<Vec<_>>(), vec!["dragon", "baron"]);
        assert_eq!(t[0].spawn_at, 300.0);
    }

    #[test]
    fn respawns_and_inhibs() {
        let ev = json!([
            {"EventName": "DragonKill", "EventTime": 400.0, "DragonType": "Fire", "KillerName": "Ally"},
            {"EventName": "BaronKill", "EventTime": 1250.0, "KillerName": "Foe"},
            {"EventName": "InhibKilled", "EventTime": 1500.0, "InhibKilled": "Barracks_T2_C1"},
            {"EventName": "InhibKilled", "EventTime": 1510.0, "InhibKilled": "Barracks_T1_R1"},
        ]);
        let t = compute_timers(&sample(1520.0, ev), &TimerConfig::default());
        let labels: Vec<_> = t.iter().map(|t| (t.label.as_str(), t.spawn_at, t.side.as_str())).collect();
        assert_eq!(
            labels,
            vec![("Baron", 1610.0, "neutral"), ("Enemy Mid inhib", 1800.0, "enemy"), ("Our Bot inhib", 1810.0, "ally")]
        );
    }

    #[test]
    fn elder_after_soul() {
        let ev: Vec<Value> = (0..4)
            .map(|i| json!({"EventName": "DragonKill", "EventTime": 300.0 + 300.0 * i as f64, "DragonType": "Fire", "KillerName": "Dom"}))
            .collect();
        let t = compute_timers(&sample(1300.0, json!(ev)), &TimerConfig::default());
        assert_eq!(t[0].label, "Elder");
        assert_eq!(t[0].spawn_at, 1200.0 + 360.0);
    }

    #[test]
    fn build_reminder() {
        let mut items = HashMap::new();
        items.insert(3020, ("Sorcerer's Shoes".to_string(), 1100));
        items.insert(6655, ("Luden's Companion".to_string(), 2850));
        items.insert(1058, ("Needlessly Large Rod".to_string(), 1200));
        let next = next_items(&sample(600.0, json!([])), &[3020, 6655, 1058], &items, 2);
        assert_eq!(next.len(), 2);
        assert_eq!(next[0].id, 6655);
        assert!(!next[0].affordable);
        assert!(next[1].affordable);
        let st = overlay_state(&sample(600.0, json!([])), &TimerConfig::default(), &Guidance::default(), &items);
        assert_eq!((st.kills, st.champion_name.as_str()), (3, "Ahri"));
        assert!(st.next_skill.is_none());
    }

    #[test]
    fn lane_item_value() {
        let mut items = HashMap::new();
        items.insert(1056, ("Doran's Ring".to_string(), 400));
        items.insert(3020, ("Sorcerer's Shoes".to_string(), 1100));
        items.insert(2003, ("Health Potion".to_string(), 50));
        let mut d = sample(600.0, json!([]));
        // Zed: two potions in one slot, plus an item the client list doesn't know.
        d["allPlayers"][2]["items"] = json!([{"itemID": 2003, "count": 2}, {"itemID": 9999, "count": 1, "price": 875}]);
        let lane = lane_diff(&d, &items).unwrap();
        assert_eq!(lane, LaneDiff { opponent: "Zed".into(), mine: 1500, theirs: 975 });
        assert_eq!(overlay_state(&d, &TimerConfig::default(), &Guidance::default(), &items).lane, Some(lane));

        // ARAM and other modes have no positions.
        for p in d["allPlayers"].as_array_mut().unwrap() {
            p["position"] = json!("");
        }
        assert_eq!(lane_diff(&d, &items), None);
    }

    #[test]
    fn skill_hint() {
        let order: Vec<String> = ["Q", "W", "E", "Q", "Q", "R"].iter().map(|s| s.to_string()).collect();
        let mut d = sample(100.0, json!([]));
        d["activePlayer"]["level"] = json!(4);
        d["activePlayer"]["abilities"] = json!({"Q": {"abilityLevel": 1}, "W": {"abilityLevel": 1}, "E": {"abilityLevel": 1}, "R": {"abilityLevel": 0}});
        assert_eq!(next_skill(&d, &order).as_deref(), Some("Q"));
        d["activePlayer"]["abilities"]["Q"]["abilityLevel"] = json!(2);
        assert_eq!(next_skill(&d, &order), None);
    }
}
