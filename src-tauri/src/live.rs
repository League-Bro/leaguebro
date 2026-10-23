//! In-game data from Riot's Live Client Data API (https://127.0.0.1:2999),
//! which the game itself serves while a match is running.
//!
//! Only information already visible to you in game is used: the game clock,
//! objective kills and everyone's items (both on the scoreboard), and your own
//! gold. Nothing tracks enemy cooldowns, in line with Riot's third-party rules.

use crate::util::{float, int, list, text};
use crate::config::TimerConfig;
use crate::situational::SituationalItem;
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
    /// What's left to pay: the full cost minus components you already own.
    pub price: i64,
    pub affordable: bool,
}

/// A situational item on the overlay, with what's left to pay for it.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SituationalPick {
    #[serde(flatten)]
    pub item: SituationalItem,
    pub price: i64,
    pub affordable: bool,
}

/// What the live view needs from the client's item list.
pub struct ShopItem {
    pub name: String,
    pub price: i64,
    /// Components it's built from.
    pub from: Vec<i64>,
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
    /// Everything left of the recommended build, in purchase order (owned items drop off).
    pub next_items: Vec<NextItem>,
    pub has_build: bool,
    /// Ability max order, e.g. ["Q", "W", "E"]; empty when the hint is off.
    pub skill_max: Vec<String>,
    /// Ability to put your next point in, when you have one unspent.
    pub next_skill: Option<String>,
    /// Your item value against your lane opponent's; None without roles (ARAM etc.).
    pub lane: Option<LaneDiff>,
    /// Situational items for this game, best first (empty when off in Settings).
    pub situational: Vec<SituationalPick>,
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

fn item_value(player: &Value, items: &HashMap<i64, ShopItem>) -> i64 {
    list(player, "items")
        .iter()
        .map(|it| {
            let price = items.get(&int(it, "itemID")).map_or_else(|| int(it, "price"), |i| i.price);
            price * int(it, "count").max(1)
        })
        .sum()
}

/// The enemy in your position, compared by item value.
pub fn lane_diff(data: &Value, items: &HashMap<i64, ShopItem>) -> Option<LaneDiff> {
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

/// An enemy as the scoreboard shows them.
pub struct ScoreboardEnemy {
    pub champion_name: String,
    pub items: Vec<i64>,
    pub kills: i64,
    pub deaths: i64,
    pub assists: i64,
}

/// The other team, with their items and scores.
pub fn enemies(data: &Value) -> Vec<ScoreboardEnemy> {
    let Some(team) = find_me(data).map(|p| text(p, "team")) else { return Vec::new() };
    list(data, "allPlayers")
        .iter()
        .filter(|p| text(p, "team") != team)
        .map(|p| ScoreboardEnemy {
            champion_name: text(p, "championName").to_string(),
            items: list(p, "items").iter().map(|i| int(i, "itemID")).collect(),
            kills: int(p, "/scores/kills"),
            deaths: int(p, "/scores/deaths"),
            assists: int(p, "/scores/assists"),
        })
        .collect()
}

/// Your item ids, as the normal items (`base_item`), so they match OP.GG's builds.
pub fn my_items(data: &Value, items: &HashMap<i64, ShopItem>) -> Vec<i64> {
    find_me(data)
        .map(|p| list(p, "items").iter().map(|i| base_item(int(i, "itemID"), items)).collect())
        .unwrap_or_default()
}

/// The normal item behind a variant. The client lists some items again under
/// a prefixed id with the same name but another price or recipe, e.g. the
/// support versions (Locket of the Iron Solari bought on a support is 323190,
/// not 3190; seen in a real game, October 2026). OP.GG's builds use the normal id.
pub fn base_item(id: i64, items: &HashMap<i64, ShopItem>) -> i64 {
    let base = id % 10_000;
    match (items.get(&id), items.get(&base)) {
        (Some(variant), Some(normal)) if id >= 100_000 && variant.name == normal.name => base,
        _ => id,
    }
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

/// Gold your owned items take off `id`'s cost, like the shop's discount: an
/// owned component counts its full price (and is used up, so it only counts
/// once), otherwise look inside its own components.
fn owned_discount(id: i64, items: &HashMap<i64, ShopItem>, owned: &mut Vec<i64>, depth: u8) -> i64 {
    let Some(item) = items.get(&id) else { return 0 };
    if depth > 0 {
        if let Some(pos) = owned.iter().position(|o| *o == id) {
            owned.remove(pos);
            return item.price;
        }
    }
    // The client's recipes are shallow; the limit only guards against bad data.
    if depth >= 4 {
        return 0;
    }
    item.from.iter().map(|c| owned_discount(*c, items, owned, depth + 1)).sum()
}

/// Your next items from the recommended build, priced after the components
/// you already own.
pub fn next_items(
    data: &Value,
    build: &[i64],
    items: &HashMap<i64, ShopItem>,
    limit: usize,
) -> Vec<NextItem> {
    let gold = float(data, "/activePlayer/currentGold");
    let mut owned_left = my_items(data, items);
    let mut out = Vec::new();
    for id in build {
        // Each owned copy satisfies one entry, so a build listing an item
        // twice still asks for the second copy.
        if let Some(pos) = owned_left.iter().position(|o| o == id) {
            owned_left.remove(pos);
            continue;
        }
        let (name, price) = match items.get(id) {
            Some(it) => (it.name.clone(), (it.price - owned_discount(*id, items, &mut owned_left, 0)).max(0)),
            None => (format!("Item {id}"), 0),
        };
        out.push(NextItem { id: *id, name, price, affordable: price > 0 && gold >= price as f64 });
        if out.len() >= limit {
            break;
        }
    }
    out
}

/// Prices the situational items after the components you own. Each is priced
/// on its own, since they're alternatives rather than a build.
pub fn price_situational(data: &Value, picks: Vec<SituationalItem>, items: &HashMap<i64, ShopItem>) -> Vec<SituationalPick> {
    let gold = float(data, "/activePlayer/currentGold");
    let owned = my_items(data, items);
    picks
        .into_iter()
        .map(|item| {
            let price = items.get(&item.id).map_or(0, |it| (it.price - owned_discount(item.id, items, &mut owned.clone(), 0)).max(0));
            SituationalPick { item, price, affordable: price > 0 && gold >= price as f64 }
        })
        .collect()
}

pub fn overlay_state(
    data: &Value,
    cfg: &TimerConfig,
    guide: &Guidance,
    items: &HashMap<i64, ShopItem>,
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
        next_items: build.map(|b| next_items(data, b, items, usize::MAX)).unwrap_or_default(),
        has_build: build.map(|b| !b.is_empty()).unwrap_or(false),
        skill_max: guide.skill_max.to_vec(),
        next_skill: next_skill(data, guide.skill_order),
        lane: lane_diff(data, items),
        situational: Vec::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn shop(list: &[(i64, &str, i64, &[i64])]) -> HashMap<i64, ShopItem> {
        list.iter().map(|(id, name, price, from)| (*id, ShopItem { name: name.to_string(), price: *price, from: from.to_vec() })).collect()
    }

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
        let items = shop(&[(3020, "Sorcerer's Shoes", 1100, &[]), (6655, "Luden's Companion", 2850, &[]), (1058, "Needlessly Large Rod", 1200, &[])]);
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
    fn owned_components_lower_the_price() {
        let items = shop(&[
            (6655, "Luden's Companion", 2850, &[3802, 1026]),
            (3802, "Lost Chapter", 1200, &[1052, 1027]),
            (1026, "Blasting Wand", 850, &[]),
            (1052, "Amplifying Tome", 400, &[]),
            (1027, "Sapphire Crystal", 300, &[]),
            (3089, "Rabadon's Deathcap", 3500, &[1058, 1026]),
            (1058, "Needlessly Large Rod", 1200, &[]),
        ]);
        let mut d = sample(600.0, json!([]));
        // A Blasting Wand plus a Tome from inside the Lost Chapter.
        d["allPlayers"][0]["items"] = json!([{"itemID": 1026}, {"itemID": 1052}]);
        let next = next_items(&d, &[6655, 3089], &items, 2);
        assert_eq!(next[0].price, 2850 - 850 - 400);
        // The Wand already went to Luden's, so Deathcap is full price.
        assert_eq!(next[1].price, 3500);
        // A finished component counts whole, not its parts.
        d["allPlayers"][0]["items"] = json!([{"itemID": 3802}]);
        // Short of the full 2850 but enough for what's left.
        d["activePlayer"]["currentGold"] = json!(1700.0);
        let next = next_items(&d, &[6655], &items, 1);
        assert_eq!(next[0].price, 2850 - 1200);
        assert!(next[0].affordable);
    }

    #[test]
    fn support_variants_count_as_the_normal_item() {
        // Ids as a real Swiftplay game on Blitzcrank reported them (October 2026).
        let items = shop(&[
            (3190, "Locket of the Iron Solari", 2200, &[3067]),
            (323190, "Locket of the Iron Solari", 2600, &[3067]),
            (3050, "Zeke's Convergence", 2200, &[3067]),
            (3067, "Kindlegem", 800, &[]),
            (323070, "Tear of the Goddess", 400, &[]),
        ]);
        let mut d = sample(600.0, json!([]));
        d["allPlayers"][0]["items"] = json!([{"itemID": 323190}, {"itemID": 323070}]);
        assert_eq!(my_items(&d, &items), vec![3190, 323070], "unknown base items keep their id");
        let next = next_items(&d, &[3190, 3050], &items, 5);
        assert_eq!(next.iter().map(|n| n.id).collect::<Vec<_>>(), vec![3050]);
    }

    #[test]
    fn situational_prices() {
        let items = shop(&[(3165, "Morellonomicon", 2950, &[3916, 1026]), (3916, "Oblivion Orb", 800, &[]), (1026, "Blasting Wand", 850, &[]), (3102, "Banshee's Veil", 3000, &[])]);
        let mut d = sample(600.0, json!([]));
        d["allPlayers"][0]["items"] = json!([{"itemID": 3916}]);
        d["activePlayer"]["currentGold"] = json!(2200.0);
        let pick = |id| SituationalItem { id, ..Default::default() };
        let priced = price_situational(&d, vec![pick(3165), pick(3102)], &items);
        // The Oblivion Orb comes off Morellonomicon; both are priced against the same items.
        assert_eq!(priced.iter().map(|p| (p.item.id, p.price, p.affordable)).collect::<Vec<_>>(), vec![(3165, 2150, true), (3102, 3000, false)]);
    }

    #[test]
    fn lane_item_value() {
        let items = shop(&[(1056, "Doran's Ring", 400, &[]), (3020, "Sorcerer's Shoes", 1100, &[]), (2003, "Health Potion", 50, &[])]);
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
    fn scoreboard_enemies() {
        let mut d = sample(600.0, json!([]));
        d["allPlayers"][2]["items"] = json!([{"itemID": 3075}]);
        d["allPlayers"][2]["scores"] = json!({"kills": 5, "deaths": 2, "assists": 1});
        let foes = enemies(&d);
        assert_eq!(foes.len(), 1);
        assert_eq!((foes[0].champion_name.as_str(), foes[0].items.clone(), foes[0].kills, foes[0].deaths), ("Zed", vec![3075], 5, 2));
        assert_eq!(my_items(&d, &HashMap::new()), vec![1056, 3020]);
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
