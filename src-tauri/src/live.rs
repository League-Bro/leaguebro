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
    /// What's left to buy toward it, in recipe order (owned components drop
    /// off). Only filled for the first item, the one the overlay shows.
    pub components: Vec<NextItem>,
}

/// A starting item and how many to buy.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct StarterItem {
    pub id: i64,
    pub name: String,
    pub count: i64,
    pub price: i64,
}

/// Starting items stop mattering once minions meet (~1:05); a little later to
/// be safe.
const STARTER_UNTIL: f64 = 150.0;

/// The starting items to show: the recommended ones, until you own the ones
/// you keep (consumables like potions get used up, so they don't count) or
/// the early game is over.
pub fn starter_items(data: &Value, starter: &[i64], items: &HashMap<i64, ShopItem>) -> Vec<StarterItem> {
    let owned = my_items(data, items);
    let price = |id: &i64| items.get(id).map_or(0, |it| it.price);
    // Potions (50) and Control Wards (75) are consumed; Doran's, Dark Seal,
    // the support item and jungle pets are kept.
    let kept: Vec<&i64> = starter.iter().filter(|id| price(id) >= 100).collect();
    let done = if kept.is_empty() { !owned.is_empty() } else { kept.iter().all(|id| owned.contains(id)) };
    if done || float(data, "/gameData/gameTime") >= STARTER_UNTIL {
        return Vec::new();
    }
    let mut out: Vec<StarterItem> = Vec::new();
    for id in starter {
        match out.iter_mut().find(|s| s.id == *id) {
            Some(s) => s.count += 1,
            None => out.push(StarterItem {
                id: *id,
                name: items.get(id).map_or_else(|| format!("Item {id}"), |it| it.name.clone()),
                count: 1,
                price: price(id),
            }),
        }
    }
    out
}

/// What to buy with the gold you have right now, toward the build. Whole
/// items when you can afford them, otherwise the biggest pieces of the next
/// item that fit, going a level deeper when a component itself is too
/// pricey (530 gold can't buy a Noonquiver, but it can buy its Long Sword).
/// Empty when nothing fits.
pub fn buy_now(data: &Value, next: &[NextItem], items: &HashMap<i64, ShopItem>) -> Vec<StarterItem> {
    let mut left = float(data, "/activePlayer/currentGold").floor() as i64;
    let mut owned = my_items(data, items);
    let mut out: Vec<StarterItem> = Vec::new();
    let add = |out: &mut Vec<StarterItem>, id: i64, name: &str, price: i64| match out.iter_mut().find(|s| s.id == id) {
        Some(s) => s.count += 1,
        None => out.push(StarterItem { id, name: name.to_string(), count: 1, price }),
    };
    // Each pass is one build item; move on to the next only once it's bought.
    for (i, it) in next.iter().take(2).enumerate() {
        if it.price > 0 && it.price <= left {
            left -= it.price;
            add(&mut out, it.id, &it.name, it.price);
            continue;
        }
        // The first item comes with its components; later ones get them now.
        let comps = if i == 0 { it.components.clone() } else { components_left(it.id, items, &owned, left as f64) };
        let mut pieces = Vec::new();
        for c in comps {
            parts_that_fit(c.id, c.price, left, items, &mut owned, &mut pieces, 0);
        }
        pieces.sort_by_key(|(_, price)| -price);
        for (id, price) in pieces {
            if price > 0 && price <= left {
                left -= price;
                add(&mut out, id, &items.get(&id).map_or_else(|| format!("Item {id}"), |c| c.name.clone()), price);
            }
        }
        break;
    }
    out
}

/// `id` itself if `price` fits in `gold`, otherwise its own components you
/// don't own yet (owned ones are used up), a level or two down.
fn parts_that_fit(id: i64, price: i64, gold: i64, items: &HashMap<i64, ShopItem>, owned: &mut Vec<i64>, out: &mut Vec<(i64, i64)>, depth: u8) {
    if price <= gold {
        out.push((id, price));
        return;
    }
    if depth >= 2 {
        return;
    }
    let from = items.get(&id).map(|it| it.from.clone()).unwrap_or_default();
    for c in from {
        if let Some(pos) = owned.iter().position(|o| *o == c) {
            owned.remove(pos);
            continue;
        }
        let Some(comp) = items.get(&c) else { continue };
        let p = (comp.price - owned_discount(c, items, owned, 0)).max(0);
        parts_that_fit(c, p, gold, items, owned, out, depth + 1);
    }
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
    /// Creep score. The game only updates it every 10 CS.
    pub cs: i64,
    pub timers: Vec<Timer>,
    /// The recommended starting items, until you've bought them (see `starter_items`).
    pub starter: Vec<StarterItem>,
    /// Everything left of the recommended build, in purchase order (owned items drop off).
    pub next_items: Vec<NextItem>,
    /// What your gold buys right now toward the build (see `buy_now`).
    pub buy_now: Vec<StarterItem>,
    pub has_build: bool,
    /// Ability max order, e.g. ["Q", "W", "E"]; empty when the hint is off.
    pub skill_max: Vec<String>,
    /// Ability to put your next point in, when you have one unspent.
    pub next_skill: Option<String>,
    /// Your item value against your lane opponent's; None without roles (ARAM etc.).
    pub lane: Option<LaneDiff>,
    /// Your team's item value against the enemy team's (every mode).
    pub team: Option<TeamDiff>,
    /// Champion ids on each team (filled in by the engine), for the Live tab's damage bars.
    pub ally_champions: Vec<i64>,
    pub enemy_champions: Vec<i64>,
    /// Situational items for this game, best first (empty when off in Settings).
    pub situational: Vec<SituationalPick>,
}

/// Item value (total cost of the items each of you holds). The game doesn't
/// share enemy gold, so this is what the scoreboard lets you compare.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LaneDiff {
    pub opponent: String,
    /// Filled in by the engine from `opponent_key` (0 if unknown), for the icon.
    pub champion_id: i64,
    /// The opponent's `rawChampionName` suffix, which is the champion's alias
    /// whatever the client's language (see `raw_champion_key`).
    #[serde(skip)]
    pub opponent_key: String,
    pub mine: i64,
    pub theirs: i64,
}

/// "game_character_displayname_MonkeyKing" -> "MonkeyKing".
pub fn raw_champion_key(player: &Value) -> String {
    let raw = text(player, "rawChampionName");
    raw.strip_prefix("game_character_displayname_").unwrap_or(raw).to_string()
}

/// Item value summed over each team.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TeamDiff {
    pub ours: i64,
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
    Some(LaneDiff {
        opponent: text(opp, "championName").to_string(),
        champion_id: 0,
        opponent_key: raw_champion_key(opp),
        mine: item_value(me, items),
        theirs: item_value(opp, items),
    })
}

/// Both teams compared by item value.
pub fn team_diff(data: &Value, items: &HashMap<i64, ShopItem>) -> Option<TeamDiff> {
    let team = text(find_me(data)?, "team");
    let (mut ours, mut theirs) = (0, 0);
    for p in list(data, "allPlayers") {
        if text(p, "team") == team { ours += item_value(p, items) } else { theirs += item_value(p, items) }
    }
    Some(TeamDiff { ours, theirs })
}

/// What the overlay should suggest beyond timers.
#[derive(Default)]
pub struct Guidance<'a> {
    /// OP.GG's build order.
    pub build: Option<&'a [i64]>,
    /// OP.GG's starting items (a potion twice means two potions).
    pub starter: &'a [i64],
    pub skill_max: &'a [String],
    pub skill_order: &'a [String],
    /// Upgraded boots you were seen holding earlier this game. Finishing the
    /// bot lane quest moves your boots into the quest slot, and the live data
    /// stops listing them (seen October 2026: a Kai'Sa with boots in that slot
    /// had none in `items`), so they still count as owned.
    pub seen_boots: Option<i64>,
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
    /// See `raw_champion_key`.
    pub champion_key: String,
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
            champion_key: raw_champion_key(p),
            items: list(p, "items").iter().map(|i| int(i, "itemID")).collect(),
            kills: int(p, "/scores/kills"),
            deaths: int(p, "/scores/deaths"),
            assists: int(p, "/scores/assists"),
        })
        .collect()
}

/// Every player's champion as (raw key, display name): your team, then the other.
/// Bots are in here too, unlike the client's loading screen data.
pub fn team_champions(data: &Value) -> (Vec<(String, String)>, Vec<(String, String)>) {
    let Some(team) = find_me(data).map(|p| text(p, "team")) else { return Default::default() };
    list(data, "allPlayers")
        .iter()
        .map(|p| (text(p, "team") == team, (raw_champion_key(p), text(p, "championName").to_string())))
        .fold((Vec::new(), Vec::new()), |(mut ours, mut theirs), (mine, c)| {
            if mine { ours.push(c) } else { theirs.push(c) }
            (ours, theirs)
        })
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

/// The basic Boots every pair of boots is built from.
const BOOTS: i64 = 1001;

/// Upgraded boots: built from Boots, directly or through other boots (the
/// tier-3 upgrades build from tier-2 boots). Not the basic Boots themselves.
fn is_upgraded_boots(id: i64, items: &HashMap<i64, ShopItem>) -> bool {
    fn from_boots(id: i64, items: &HashMap<i64, ShopItem>, depth: u8) -> bool {
        let from = items.get(&id).map_or(&[][..], |it| it.from.as_slice());
        from.contains(&BOOTS) || (depth < 3 && from.iter().any(|c| from_boots(*c, items, depth + 1)))
    }
    id != BOOTS && from_boots(id, items, 0)
}

/// Your next items from the recommended build, priced after the components
/// you already own. Any upgraded boots you own count as the build's boots,
/// since you only carry one pair. `seen_boots` (see `Guidance`) counts when
/// the live data lists no boots.
pub fn next_items(
    data: &Value,
    build: &[i64],
    items: &HashMap<i64, ShopItem>,
    limit: usize,
    seen_boots: Option<i64>,
) -> Vec<NextItem> {
    let gold = float(data, "/activePlayer/currentGold");
    let mut owned_left = my_items(data, items);
    if let Some(b) = seen_boots.filter(|_| !owned_left.iter().any(|o| is_upgraded_boots(*o, items))) {
        owned_left.push(b);
    }
    let mut out = Vec::new();
    for id in build {
        // Each owned copy satisfies one entry, so a build listing an item
        // twice still asks for the second copy.
        if let Some(pos) = owned_left.iter().position(|o| o == id) {
            owned_left.remove(pos);
            continue;
        }
        if is_upgraded_boots(*id, items) {
            if let Some(pos) = owned_left.iter().position(|o| is_upgraded_boots(*o, items)) {
                owned_left.remove(pos);
                continue;
            }
        }
        let components = if out.is_empty() { components_left(*id, items, &owned_left, gold) } else { Vec::new() };
        let (name, price) = match items.get(id) {
            Some(it) => (it.name.clone(), (it.price - owned_discount(*id, items, &mut owned_left, 0)).max(0)),
            None => (format!("Item {id}"), 0),
        };
        out.push(NextItem { id: *id, name, price, affordable: price > 0 && gold >= price as f64, components });
        if out.len() >= limit {
            break;
        }
    }
    out
}

/// The direct components of `id` you still need, each priced after what you
/// own inside it. Owned ones are used up so a recipe with two of the same
/// component still asks for the second. Ordered for buying: what you can
/// afford now first, biggest first (the most stats for this back), then the
/// rest cheapest first (what you'll reach next).
fn components_left(id: i64, items: &HashMap<i64, ShopItem>, owned: &[i64], gold: f64) -> Vec<NextItem> {
    let Some(item) = items.get(&id) else { return Vec::new() };
    let mut owned = owned.to_vec();
    let mut out = Vec::new();
    for c in &item.from {
        if let Some(pos) = owned.iter().position(|o| o == c) {
            owned.remove(pos);
            continue;
        }
        let Some(comp) = items.get(c) else { continue };
        let price = (comp.price - owned_discount(*c, items, &mut owned, 0)).max(0);
        out.push(NextItem { id: *c, name: comp.name.clone(), price, affordable: price > 0 && gold >= price as f64, components: Vec::new() });
    }
    out.sort_by_key(|c| (!c.affordable, if c.affordable { -c.price } else { c.price }));
    out
}

/// Finished items are what's left when nothing builds out of them (plus
/// upgraded boots, which the tier-3 boots build from). The price floor keeps
/// out starters and consumables (Doran's, potions, wards), which nothing
/// builds from either.
const FINISHED_FROM: i64 = 900;

/// Six finished items: no slot left, so there's nothing to suggest buying
/// (even if you went off the recommended build, as you often do).
pub fn inventory_full(data: &Value, items: &HashMap<i64, ShopItem>) -> bool {
    let components: std::collections::HashSet<i64> = items.values().flat_map(|it| it.from.iter().copied()).collect();
    let finished = |id: &i64| {
        items.get(id).is_some_and(|it| it.price >= FINISHED_FROM) && (!components.contains(id) || is_upgraded_boots(*id, items))
    };
    my_items(data, items).iter().filter(|id| finished(id)).count() >= 6
}

/// The upgraded boots in your inventory, if any.
pub fn my_boots(data: &Value, items: &HashMap<i64, ShopItem>) -> Option<i64> {
    my_items(data, items).into_iter().find(|id| is_upgraded_boots(*id, items))
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
    // A full inventory reads as "Build complete" on the overlay.
    let next = match build {
        Some(b) if !inventory_full(data, items) => next_items(data, b, items, usize::MAX, guide.seen_boots),
        _ => Vec::new(),
    };
    let starter = starter_items(data, guide.starter, items);
    // The starting items are the shopping list until they're bought.
    let buy = if starter.is_empty() { buy_now(data, &next, items) } else { Vec::new() };
    OverlayState {
        game_time: float(data, "/gameData/gameTime"),
        game_mode: text(data, "/gameData/gameMode").to_string(),
        champion_name: me.map(|p| text(p, "championName").to_string()).unwrap_or_default(),
        gold: float(data, "/activePlayer/currentGold"),
        kills: score("kills"),
        deaths: score("deaths"),
        assists: score("assists"),
        cs: score("creepScore"),
        timers: compute_timers(data, cfg),
        starter,
        next_items: next,
        buy_now: buy,
        has_build: build.map(|b| !b.is_empty()).unwrap_or(false),
        skill_max: guide.skill_max.to_vec(),
        next_skill: next_skill(data, guide.skill_order),
        lane: lane_diff(data, items),
        team: team_diff(data, items),
        ally_champions: Vec::new(),
        enemy_champions: Vec::new(),
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
                {"riotId": "Foe#NA1", "championName": "Zed", "rawChampionName": "game_character_displayname_Zed", "team": "CHAOS", "position": "MIDDLE", "items": []}
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
        let next = next_items(&sample(600.0, json!([])), &[3020, 6655, 1058], &items, 2, None);
        assert_eq!(next.len(), 2);
        assert_eq!(next[0].id, 6655);
        assert!(!next[0].affordable);
        assert!(next[1].affordable);
        let st = overlay_state(&sample(600.0, json!([])), &TimerConfig::default(), &Guidance::default(), &items);
        assert_eq!((st.kills, st.cs, st.champion_name.as_str()), (3, 120, "Ahri"));
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
        let next = next_items(&d, &[6655, 3089], &items, 2, None);
        assert_eq!(next[0].price, 2850 - 850 - 400);
        // The Wand drops off; the Lost Chapter is left, minus the Tome inside it.
        let comps: Vec<_> = next[0].components.iter().map(|c| (c.id, c.price)).collect();
        assert_eq!(comps, [(3802, 1200 - 400)]);
        assert!(next[1].components.is_empty());
        // The Wand already went to Luden's, so Deathcap is full price.
        assert_eq!(next[1].price, 3500);
        // A finished component counts whole, not its parts.
        d["allPlayers"][0]["items"] = json!([{"itemID": 3802}]);
        // Short of the full 2850 but enough for what's left.
        d["activePlayer"]["currentGold"] = json!(1700.0);
        let next = next_items(&d, &[6655], &items, 1, None);
        assert_eq!(next[0].price, 2850 - 1200);
        assert!(next[0].affordable);
    }

    #[test]
    fn starting_items_until_bought() {
        let items = shop(&[(1056, "Doran's Ring", 400, &[]), (2003, "Health Potion", 50, &[])]);
        let mut d = sample(30.0, json!([]));
        d["allPlayers"][0]["items"] = json!([]);
        let st = starter_items(&d, &[1056, 2003, 2003], &items);
        assert_eq!(st.iter().map(|s| (s.id, s.count)).collect::<Vec<_>>(), [(1056, 1), (2003, 2)]);
        // Bought the ring and drank a potion: done.
        d["allPlayers"][0]["items"] = json!([{"itemID": 1056}, {"itemID": 2003}]);
        assert!(starter_items(&d, &[1056, 2003, 2003], &items).is_empty());
        // Nothing bought, but the early game is over.
        let mut late = sample(STARTER_UNTIL, json!([]));
        late["allPlayers"][0]["items"] = json!([]);
        assert!(starter_items(&late, &[1056, 2003, 2003], &items).is_empty());
    }

    #[test]
    fn components_in_buying_order() {
        let items = shop(&[
            (3031, "Infinity Edge", 3450, &[1038, 1037, 1018]),
            (1038, "B. F. Sword", 1300, &[]),
            (1037, "Pickaxe", 875, &[]),
            (1018, "Cloak of Agility", 600, &[]),
        ]);
        let order = |gold: f64| {
            let mut d = sample(600.0, json!([]));
            d["activePlayer"]["currentGold"] = json!(gold);
            next_items(&d, &[3031], &items, 1, None)[0].components.iter().map(|c| c.id).collect::<Vec<_>>()
        };
        // Can afford Pickaxe and Cloak: the bigger one first, then the B. F. Sword.
        assert_eq!(order(1000.0), [1037, 1018, 1038]);
        // Can't afford anything: cheapest first.
        assert_eq!(order(100.0), [1018, 1037, 1038]);
    }

    #[test]
    fn buy_now_on_an_early_back() {
        let items = shop(&[
            (6673, "Immortal Shieldbow", 3000, &[1037, 6670]),
            (1037, "Pickaxe", 875, &[]),
            (6670, "Noonquiver", 1300, &[1036, 1042]),
            (1036, "Long Sword", 350, &[]),
            (1042, "Dagger", 250, &[]),
            (3006, "Berserker's Greaves", 1100, &[1001, 1042]),
            (1001, "Boots", 300, &[]),
        ]);
        let plan = |gold: f64, owned: Value, time: f64| {
            let mut d = sample(time, json!([]));
            d["activePlayer"]["currentGold"] = json!(gold);
            d["allPlayers"][0]["items"] = owned;
            let next = next_items(&d, &[6673, 3006], &items, usize::MAX, None);
            buy_now(&d, &next, &items).iter().map(|s| (s.id, s.count)).collect::<Vec<_>>()
        };
        // 530 gold at level 3: no Pickaxe or Noonquiver, but the Noonquiver's Long Sword.
        assert_eq!(plan(530.0, json!([]), 260.0), [(1036, 1)]);
        // Pickaxe fits: the biggest piece first, then a Dagger from the Noonquiver.
        assert_eq!(plan(1200.0, json!([]), 1000.0), [(1037, 1), (1042, 1)]);
        // Enough for the whole item: buy it, then start on the boots.
        assert_eq!(plan(3400.0, json!([]), 1000.0), [(6673, 1), (1001, 1)]);
        // Too poor for any piece.
        assert!(plan(200.0, json!([]), 260.0).is_empty());
    }

    #[test]
    fn full_inventory_means_build_complete() {
        let mut list: Vec<(i64, &str, i64, &[i64])> = vec![
            (1036, "Long Sword", 350, &[]),
            (1001, "Boots", 300, &[]),
            (3006, "Berserker's Greaves", 1100, &[1001]),
            (3172, "Gunmetal Greaves", 1600, &[3006]),
            (2055, "Control Ward", 75, &[]),
            (3072, "Bloodthirster", 3400, &[1036]),
        ];
        let finished: [i64; 5] = [6672, 3031, 3036, 3046, 3026];
        for id in finished {
            list.push((id, "Finished", 3000, &[1036]));
        }
        let items = shop(&list);
        let guide = Guidance { build: Some(&[3072]), ..Default::default() };
        let state = |owned: Vec<i64>| {
            let mut d = sample(1800.0, json!([]));
            d["activePlayer"]["currentGold"] = json!(4000.0);
            d["allPlayers"][0]["items"] = json!(owned.iter().map(|id| json!({"itemID": id})).collect::<Vec<_>>());
            overlay_state(&d, &TimerConfig::default(), &guide, &items)
        };
        // Five finished items and upgraded boots, none of them Bloodthirster: nothing to buy.
        let mut owned = finished.to_vec();
        owned.extend([3006, 2055]);
        let st = state(owned);
        assert!(st.next_items.is_empty() && st.buy_now.is_empty() && st.has_build);
        // A Long Sword in the sixth slot instead of boots: still room to finish an item.
        let mut owned = finished.to_vec();
        owned.push(1036);
        assert_eq!(state(owned).next_items[0].id, 3072);
    }

    #[test]
    fn other_boots_count_as_the_builds_boots() {
        let items = shop(&[
            (1001, "Boots", 300, &[]),
            (3020, "Sorcerer's Shoes", 1100, &[1001]),
            (3158, "Ionian Boots of Lucidity", 900, &[1001]),
            (3171, "Crimson Lucidity", 1400, &[3158]),
            (6655, "Luden's Companion", 2850, &[]),
        ]);
        let mut d = sample(600.0, json!([]));
        let ids = |d: &Value| next_items(d, &[3020, 6655], &items, 5, None).iter().map(|n| n.id).collect::<Vec<_>>();
        d["allPlayers"][0]["items"] = json!([{"itemID": 3158}]);
        assert_eq!(ids(&d), vec![6655]);
        // A tier-3 upgrade of other boots counts too.
        d["allPlayers"][0]["items"] = json!([{"itemID": 3171}]);
        assert_eq!(ids(&d), vec![6655]);
        // Basic Boots don't: they only take their price off.
        d["allPlayers"][0]["items"] = json!([{"itemID": 1001}]);
        let next = next_items(&d, &[3020, 6655], &items, 5, None);
        assert_eq!((next[0].id, next[0].price), (3020, 800));
    }

    #[test]
    fn boots_in_the_quest_slot_still_count() {
        let items = shop(&[(1001, "Boots", 300, &[]), (3006, "Berserker's Greaves", 1100, &[1001]), (6672, "Kraken Slayer", 3000, &[])]);
        let mut d = sample(600.0, json!([]));
        d["allPlayers"][0]["items"] = json!([{"itemID": 3006}]);
        assert_eq!(my_boots(&d, &items), Some(3006));
        // The bot lane quest is done: the boots are gone from the live data.
        d["allPlayers"][0]["items"] = json!([{"itemID": 6672}]);
        assert_eq!(my_boots(&d, &items), None);
        let ids = |seen| next_items(&d, &[3006, 6672], &items, 5, seen).iter().map(|n| n.id).collect::<Vec<_>>();
        assert_eq!(ids(None), vec![3006]);
        assert!(ids(Some(3006)).is_empty());
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
        let next = next_items(&d, &[3190, 3050], &items, 5, None);
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
        assert_eq!(lane, LaneDiff { opponent: "Zed".into(), champion_id: 0, opponent_key: "Zed".into(), mine: 1500, theirs: 975 });
        assert_eq!(overlay_state(&d, &TimerConfig::default(), &Guidance::default(), &items).lane, Some(lane));
        // Lee Sin has nothing, so the teams are just the two of you.
        assert_eq!(team_diff(&d, &items), Some(TeamDiff { ours: 1500, theirs: 975 }));

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
    fn champions_by_team() {
        let (ours, theirs) = team_champions(&sample(600.0, json!([])));
        let names = |t: &[(String, String)]| t.iter().map(|(_, n)| n.clone()).collect::<Vec<_>>();
        assert_eq!(names(&ours), vec!["Ahri", "Lee Sin"]);
        assert_eq!(theirs, vec![("Zed".to_string(), "Zed".to_string())]);
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
