//! Situational items: which of OP.GG's 4th–6th item options suit this game.
//!
//! OP.GG says what players of your champion build later (`situational_pool`)
//! but not when, so this ranks those options against a "threat profile" of the
//! enemy team: healing, armor or Magic Resist stacking, shields, tanks, burst,
//! crowd control, and the split of physical vs magic damage. In champ select
//! that comes from the enemy picks (champion roles, damage type and a few short
//! lists below); in game, from the items each enemy has bought and how fed they
//! are, both on the scoreboard.
//!
//! What an item is good against is read from the client's own item data (stat
//! lines and passive text, `item_tags`), so new items and reworks are picked
//! up without changes here.

use crate::engine::ItemInfo;
use crate::opgg::ItemSet;
use serde::Serialize;
use std::collections::HashMap;

/// Situational items shown at most (Live tab, rec card); the overlay shows the first.
const MAX_ITEMS: usize = 3;
/// An item needs at least this much threat behind it to be suggested.
const MIN_SCORE: f64 = 0.8;
/// Kept items get this much extra, so the suggestion doesn't flip on every purchase.
const STICKY: f64 = 0.3;

// Each kind of threat and the item quality that answers it. The tag names are
// what the UI gets (`ItemInfo.situations`, `Threat.tag`).
pub const ANTI_HEAL: &str = "antiHeal";
pub const ARMOR_PEN: &str = "armorPen";
pub const MAGIC_PEN: &str = "magicPen";
pub const ANTI_SHIELD: &str = "antiShield";
pub const ANTI_TANK: &str = "antiTank";
pub const ARMOR: &str = "armor";
pub const MAGIC_RESIST: &str = "magicResist";
pub const SURVIVE: &str = "survive";
pub const CLEANSE: &str = "cleanse";

/// Champions whose kits heal a lot (client aliases). Item healing is read from the scoreboard.
const HEALERS: &[&str] = &[
    "Aatrox", "Briar", "DrMundo", "Fiddlesticks", "Gwen", "Illaoi", "Maokai", "MasterYi", "Milio", "Nami", "Nasus",
    "Olaf", "Senna", "Sona", "Soraka", "Swain", "Sylas", "Taric", "Trundle", "Vladimir", "Volibear", "Warwick",
    "Yuumi", "Zac",
];
/// Champions that shield themselves or allies often.
const SHIELDERS: &[&str] = &[
    "Annie", "Camille", "Diana", "Ivern", "Janna", "Karma", "Kled", "Lulu", "Lux", "Malphite", "Milio", "Mordekaiser",
    "Morgana", "Orianna", "Rakan", "Renata", "Riven", "Rumble", "Seraphine", "Sett", "Shen", "Sion", "Skarner",
    "TahmKench", "Taric", "Urgot", "Yasuo", "Yone",
];
/// Champions with a lot of hard crowd control.
const CC_HEAVY: &[&str] = &[
    "Alistar", "Amumu", "Annie", "Ashe", "Blitzcrank", "Braum", "Cassiopeia", "Galio", "Kennen", "Leona", "Lissandra",
    "Lux", "Malphite", "Maokai", "Morgana", "Nautilus", "Neeko", "Nunu", "Ornn", "Poppy", "Rakan", "Rammus", "Rell",
    "Sejuani", "Sion", "Skarner", "Taric", "Thresh", "TwistedFate", "Veigar", "Vi", "Warwick", "Zac", "Zyra",
];

/// Anti-heal for champions whose OP.GG options have none, by class (the
/// classic case of a team that out-heals you). Only used when the client knows
/// the item and it really applies Grievous Wounds.
const ANTI_HEAL_FALLBACK: &[(&str, i64)] = &[
    ("marksman", 3033), // Mortal Reminder
    ("tank", 3075),     // Thornmail
    ("mage", 3165),     // Morellonomicon
    ("fighter", 6609),  // Chempunk Chainsword
    ("assassin", 6609),
];

/// What an item is good against, from the client's stat lines and passive text.
pub fn item_tags(stats: &[String], desc: &str, categories: &[String]) -> Vec<String> {
    if categories.iter().any(|c| c == "Boots") {
        return Vec::new();
    }
    let desc = desc.to_lowercase();
    let lines: Vec<&str> = desc.lines().collect();
    let stat = |name: &str| stats.iter().any(|s| s.to_lowercase().ends_with(name));
    let any = |words: &[&str]| words.iter().any(|w| desc.contains(w));
    let line_has = |all: &[&str]| lines.iter().any(|l| all.iter().all(|w| l.contains(w)));
    let mut tags = Vec::new();
    let mut add = |on: bool, tag: &str| {
        if on {
            tags.push(tag.to_string());
        }
    };
    add(desc.contains("grievous wounds"), ANTI_HEAL);
    add(stat("armor penetration") || desc.contains("armor penetration"), ARMOR_PEN);
    add(stat("magic penetration") || desc.contains("magic penetration"), MAGIC_PEN);
    add(
        desc.contains("shield reaver") || lines.iter().any(|l| l.contains("shield") && l.contains("reduc") && (l.contains("enem") || l.contains("target"))),
        ANTI_SHIELD,
    );
    add(
        lines.iter().any(|l| {
            l.contains("damage")
                && ["max health", "maximum health", "current health"].iter().any(|h| l.contains(h))
                && (l.contains("target") || l.contains("enem"))
                && !l.contains("your max")
        }),
        ANTI_TANK,
    );
    add(stat(" armor"), ARMOR);
    add(stat("magic resist"), MAGIC_RESIST);
    add(any(&["stasis", "revive", "resurrect", "spell shield", "lifeline", "untargetable"]), SURVIVE);
    add(any(&["quicksilver", "removes all crowd control", "cleanse"]) || line_has(&["remove", "crowd control"]), CLEANSE);
    tags
}

/// An enemy as far as the threat profile is concerned.
#[derive(Debug, Clone, Default)]
pub struct Enemy {
    pub name: String,
    pub alias: String,
    pub roles: Vec<String>,
    /// "AD", "AP", "BOTH" or "" (unknown).
    pub damage_type: String,
    /// Item ids from the scoreboard (empty in champ select).
    pub items: Vec<i64>,
    pub kills: i64,
    pub deaths: i64,
    pub assists: i64,
}

impl Enemy {
    /// How much this enemy matters: fed enemies more, feeding ones less.
    fn weight(&self) -> f64 {
        (1.0 + 0.12 * (self.kills - self.deaths) as f64 + 0.04 * self.assists as f64).clamp(0.5, 2.0)
    }

    fn has_role(&self, role: &str) -> bool {
        self.roles.iter().any(|r| r == role)
    }

    fn score(&self) -> String {
        format!("{}/{}/{}", self.kills, self.deaths, self.assists)
    }
}

/// One kind of threat on the enemy team, e.g. healing.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Threat {
    /// The item tag that answers it (`ANTI_HEAL`…).
    pub tag: String,
    /// Short name for a chip, e.g. "Anti-heal".
    pub label: String,
    /// Roughly 1 = worth answering, 2+ = a lot of it.
    pub level: f64,
    /// Who it comes from, e.g. "Healing from Soraka and Draven (Bloodthirster)".
    pub detail: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SituationalItem {
    pub id: i64,
    pub name: String,
    /// The threat it answers best (`Threat.tag`).
    pub tag: String,
    pub label: String,
    /// Why, naming the enemies, e.g. "Healing from Soraka and Aatrox".
    pub reason: String,
    pub score: f64,
    /// You own a component that builds into it.
    pub started: bool,
    /// OP.GG doesn't list it for your champion (anti-heal fallback).
    pub off_pool: bool,
    /// OP.GG numbers as a 4th–6th item (0 when off the pool).
    pub games: i64,
    pub win_rate: f64,
}

#[derive(Debug, Clone, Serialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct SituationalState {
    pub champion_id: i64,
    /// From the live game's scoreboard (true) or champ select picks (false).
    pub live: bool,
    /// Strongest first; only threats worth answering.
    pub threats: Vec<Threat>,
    pub items: Vec<SituationalItem>,
}

/// One enemy's share of a threat, for the explanation.
struct Source {
    weight: f64,
    text: String,
}

#[derive(Default)]
struct Profile {
    levels: HashMap<&'static str, f64>,
    sources: HashMap<&'static str, Vec<Source>>,
}

impl Profile {
    fn add(&mut self, tag: &'static str, weight: f64, text: String) {
        if weight <= 0.0 {
            return;
        }
        *self.levels.entry(tag).or_default() += weight;
        self.sources.entry(tag).or_default().push(Source { weight, text });
    }

    fn level(&self, tag: &str) -> f64 {
        self.levels.get(tag).copied().unwrap_or(0.0)
    }
}

fn label(tag: &str) -> &'static str {
    match tag {
        ANTI_HEAL => "Anti-heal",
        ARMOR_PEN => "Armor pen",
        MAGIC_PEN => "Magic pen",
        ANTI_SHIELD => "Anti-shield",
        ANTI_TANK => "%HP damage",
        ARMOR => "Armor",
        MAGIC_RESIST => "Magic resist",
        SURVIVE => "Survive burst",
        CLEANSE => "Cleanse",
        _ => "",
    }
}

fn lead(tag: &str) -> &'static str {
    match tag {
        ANTI_HEAL => "Healing from",
        ARMOR_PEN => "Armor on",
        MAGIC_PEN => "Magic Resist on",
        ANTI_SHIELD => "Shields from",
        ANTI_TANK => "Tanky enemies:",
        ARMOR => "Physical damage from",
        MAGIC_RESIST => "Magic damage from",
        SURVIVE => "Burst from",
        CLEANSE => "Crowd control from",
        _ => "",
    }
}

/// "A", "A and B", "A, B and C"
fn join_names(names: &[String]) -> String {
    match names {
        [] => String::new(),
        [one] => one.clone(),
        [rest @ .., last] => format!("{} and {last}", rest.join(", ")),
    }
}

/// The leading number of a stat line ("40 Armor" → 40).
fn stat_amount(stats: &[String], name: &str) -> f64 {
    stats
        .iter()
        .filter(|s| s.to_lowercase().ends_with(name))
        .filter_map(|s| s.split_whitespace().next()?.trim_end_matches('%').parse::<f64>().ok())
        .sum()
}

fn threat_profile(enemies: &[Enemy], items: &HashMap<i64, &ItemInfo>) -> Profile {
    let mut p = Profile::default();
    // Physical vs magic damage: only worth answering when it leans one way.
    let (mut ad, mut ap) = (Vec::new(), Vec::new());
    for e in enemies {
        let w = e.weight();
        let alias = e.alias.as_str();
        let owned: Vec<&ItemInfo> = e.items.iter().filter_map(|id| items.get(id).copied()).collect();
        let named = |filter: &dyn Fn(&ItemInfo) -> bool| -> Vec<String> {
            owned.iter().filter(|i| filter(i) && i.price_total >= 1000).map(|i| i.name.clone()).collect()
        };
        let with_items = |names: Vec<String>| if names.is_empty() { e.name.clone() } else { format!("{} ({})", e.name, names.join(", ")) };

        // Healing: the kit, then lifesteal / omnivamp / heal power items.
        let heals = |i: &ItemInfo| {
            i.categories.iter().any(|c| c == "LifeSteal" || c == "SpellVamp")
                || i.stats.iter().any(|s| { let s = s.to_lowercase(); s.ends_with("omnivamp") || s.ends_with("life steal") || s.ends_with("heal and shield power") })
        };
        let heal_items = named(&heals);
        let kit = if HEALERS.contains(&alias) { 1.0 } else { 0.0 };
        p.add(ANTI_HEAL, (kit + 0.6 * heal_items.len() as f64) * w, with_items(heal_items));

        // Armor / Magic Resist stacking: the amount bought (any score), plus tanks.
        let tank = if e.has_role("tank") { 0.6 } else { 0.0 };
        let armor: f64 = owned.iter().map(|i| stat_amount(&i.stats, " armor")).sum();
        let mr: f64 = owned.iter().map(|i| stat_amount(&i.stats, "magic resist")).sum();
        let health: f64 = owned.iter().map(|i| stat_amount(&i.stats, " health")).sum();
        let by = |amount: f64, what: &str| if amount > 0.0 { format!("{} ({amount:.0} {what} from items)", e.name) } else { e.name.clone() };
        p.add(ARMOR_PEN, tank + armor / 120.0, by(armor, "armor"));
        p.add(MAGIC_PEN, tank + mr / 120.0, by(mr, "Magic Resist"));
        p.add(ANTI_TANK, if e.has_role("tank") { 0.8 } else { 0.0 } + health / 1500.0, by(health, "health"));

        // Shields: the kit, then shield items.
        let shields = |i: &ItemInfo| {
            let d = i.desc.to_lowercase();
            i.stats.iter().any(|s| s.to_lowercase().ends_with("heal and shield power")) || d.contains("lifeline") || d.lines().any(|l| l.contains("shield") && (l.contains("gain") || l.contains("grant")) && !l.contains("spell shield"))
        };
        let shield_items = named(&shields);
        let kit = if SHIELDERS.contains(&alias) { 0.8 } else { 0.0 };
        p.add(ANTI_SHIELD, kit + 0.5 * shield_items.len() as f64, with_items(shield_items));

        // Burst: assassins, and anyone well ahead.
        let fed = e.kills - e.deaths >= 4;
        let burst = (if e.has_role("assassin") { 0.8 } else { 0.0 } + if fed { 0.6 } else { 0.0 }) * w;
        let why = match (e.has_role("assassin"), fed) {
            (true, true) => format!("{} (assassin, {})", e.name, e.score()),
            (false, true) => format!("{} ({})", e.name, e.score()),
            _ => e.name.clone(),
        };
        p.add(SURVIVE, burst, why);

        if CC_HEAVY.contains(&alias) {
            p.add(CLEANSE, 0.5, e.name.clone());
        }
        match e.damage_type.as_str() {
            "AD" => ad.push((w, e.name.clone())),
            "AP" => ap.push((w, e.name.clone())),
            "BOTH" => {
                ad.push((w * 0.5, e.name.clone()));
                ap.push((w * 0.5, e.name.clone()));
            }
            _ => {}
        }
    }
    // A team with 3–4 champions of one damage type makes that resist worth buying.
    for (tag, side) in [(ARMOR, ad), (MAGIC_RESIST, ap)] {
        let total: f64 = side.iter().map(|(w, _)| w).sum();
        let level = (total - 2.5).max(0.0);
        if level > 0.0 {
            for (w, name) in side {
                p.add(tag, level * w / total, name);
            }
        }
    }
    // A single CC champion is normal; cleanse is for heavy lockdown.
    let cc = p.level(CLEANSE);
    if cc > 0.0 {
        let keep = (cc - 1.0).max(0.0) / cc;
        p.levels.insert(CLEANSE, cc * keep);
    }
    p
}

fn threat(p: &Profile, tag: &str) -> Threat {
    let mut sources: Vec<&Source> = p.sources.get(tag).map(|v| v.iter().collect()).unwrap_or_default();
    sources.sort_by(|a, b| b.weight.total_cmp(&a.weight));
    let names: Vec<String> = sources.iter().take(3).map(|s| s.text.clone()).collect();
    Threat { tag: tag.into(), label: label(tag).into(), level: p.level(tag), detail: format!("{} {}", lead(tag), join_names(&names)) }
}

/// What `suggest` works from.
pub struct Input<'a> {
    pub champion_id: i64,
    /// Your champion's client roles, for the anti-heal fallback.
    pub my_roles: &'a [String],
    /// OP.GG's 4th–6th item options for your champion.
    pub pool: &'a [ItemSet],
    /// Items already in your core build and boots (not situational).
    pub core: &'a [i64],
    /// Your items (live game; empty in champ select).
    pub owned: &'a [i64],
    pub enemies: &'a [Enemy],
    pub items: &'a [ItemInfo],
    /// Last suggestion's item ids, kept ahead unless something else is clearly better.
    pub previous: &'a [i64],
    pub live: bool,
}

pub fn suggest(input: &Input) -> SituationalState {
    let items: HashMap<i64, &ItemInfo> = input.items.iter().map(|i| (i.id, i)).collect();
    let profile = threat_profile(input.enemies, &items);
    let tags = |id: i64| items.get(&id).map(|i| i.situations.clone()).unwrap_or_default();

    // Threats you've already answered with a finished item. Grievous Wounds,
    // penetration, shield cutting and cleanses don't stack, so one item answers
    // them fully; Armor, Magic Resist, survival and %HP damage do, so each item
    // you own takes off about one unit of threat.
    let covered: Vec<String> = input
        .owned
        .iter()
        .filter(|id| items.get(id).is_some_and(|i| i.price_total >= 2000))
        .flat_map(|id| tags(*id))
        .collect();
    let level = |tag: &str| {
        let owned = covered.iter().filter(|c| *c == tag).count() as f64;
        let unique = [ANTI_HEAL, ARMOR_PEN, MAGIC_PEN, ANTI_SHIELD, CLEANSE].contains(&tag);
        match owned {
            0.0 => profile.level(tag),
            _ if unique => 0.0,
            n => (profile.level(tag) - n).max(0.0),
        }
    };

    let mut threats: Vec<Threat> = [ANTI_HEAL, ARMOR_PEN, MAGIC_PEN, ANTI_SHIELD, ANTI_TANK, ARMOR, MAGIC_RESIST, SURVIVE, CLEANSE]
        .into_iter()
        .filter(|t| level(t) >= MIN_SCORE)
        .map(|t| threat(&profile, t))
        .collect();
    threats.sort_by(|a, b| b.level.total_cmp(&a.level));

    let max_games = input.pool.iter().map(|s| s.games).max().unwrap_or(0).max(1);
    let started = |id: i64| input.owned.iter().any(|o| items.get(o).is_some_and(|i| i.into.contains(&id)));
    let mut seen: Vec<i64> = Vec::new();
    let mut out: Vec<SituationalItem> = Vec::new();
    let mut consider = |id: i64, games: i64, win_rate: f64, off_pool: bool, out: &mut Vec<SituationalItem>| {
        if seen.contains(&id) || input.core.contains(&id) || input.owned.contains(&id) {
            return;
        }
        seen.push(id);
        let Some(info) = items.get(&id) else { return };
        let mut answered: Vec<(&String, f64)> = info.situations.iter().map(|t| (t, level(t))).filter(|(_, l)| *l > 0.0).collect();
        answered.sort_by(|a, b| b.1.total_cmp(&a.1));
        let threat_score: f64 = answered.iter().map(|(_, l)| l).sum();
        if threat_score < MIN_SCORE {
            return;
        }
        let Some((top, _)) = answered.first() else { return };
        let started = started(id);
        let score = threat_score
            + 0.3 * games as f64 / max_games as f64
            + if started { 0.5 } else { 0.0 }
            + if input.previous.contains(&id) { STICKY } else { 0.0 };
        let top = threats.iter().find(|t| &t.tag == *top).cloned().unwrap_or_else(|| threat(&profile, top));
        out.push(SituationalItem {
            id,
            name: info.name.clone(),
            tag: top.tag,
            label: top.label,
            reason: top.detail,
            score,
            started,
            off_pool,
            games,
            win_rate,
        });
    };
    for set in input.pool {
        for id in &set.ids {
            consider(*id, set.games, set.win_rate, false, &mut out);
        }
    }
    // Heavy healing and nothing in OP.GG's options to answer it.
    if level(ANTI_HEAL) >= 1.5 && !out.iter().any(|i| i.tag == ANTI_HEAL) {
        let fallback = input.my_roles.iter().find_map(|r| ANTI_HEAL_FALLBACK.iter().find(|(role, _)| role == r)).map(|(_, id)| *id);
        if let Some(id) = fallback.filter(|id| items.get(id).is_some_and(|i| i.situations.iter().any(|t| t == ANTI_HEAL))) {
            consider(id, 0, 0.0, true, &mut out);
        }
    }
    out.sort_by(|a, b| b.score.total_cmp(&a.score));
    out.truncate(MAX_ITEMS);
    SituationalState { champion_id: input.champion_id, live: input.live, threats, items: out }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn item(id: i64, name: &str, price: i64, stats: &[&str], desc: &str, cats: &[&str]) -> ItemInfo {
        let stats: Vec<String> = stats.iter().map(|s| s.to_string()).collect();
        let categories: Vec<String> = cats.iter().map(|s| s.to_string()).collect();
        let situations = item_tags(&stats, desc, &categories);
        ItemInfo { id, name: name.into(), price_total: price, stats, desc: desc.into(), categories, situations, ..Default::default() }
    }

    fn items() -> Vec<ItemInfo> {
        vec![
            item(3033, "Mortal Reminder", 3000, &["35 Attack Damage", "35% Armor Penetration"], "Sepsis\nPhysical damage applies 40% Grievous Wounds to enemy champions.", &["Damage", "ArmorPenetration"]),
            item(3036, "Lord Dominik's Regards", 3000, &["35 Attack Damage", "35% Armor Penetration"], "Giant Slayer\nDeal bonus physical damage against champions with more max Health than you.", &["Damage", "ArmorPenetration"]),
            item(3026, "Guardian Angel", 3200, &["55 Attack Damage", "45 Armor"], "Rebirth\nUpon taking lethal damage, revive with 50% base Health.", &["Damage", "Armor"]),
            item(3031, "Infinity Edge", 3500, &["70 Attack Damage", "25% Critical Strike Chance"], "Critical strikes deal bonus damage.", &["Damage", "CriticalStrike"]),
            item(3123, "Executioner's Calling", 800, &["15 Attack Damage"], "Rend\nDealing physical damage applies 40% Grievous Wounds.", &["Damage"]),
            item(3072, "Bloodthirster", 3400, &["80 Attack Damage", "15% Life Steal"], "Ichorshield", &["Damage", "LifeSteal"]),
            item(3075, "Thornmail", 2450, &["150 Health", "75 Armor"], "Thorns\nWhen struck by an attack, apply 40% Grievous Wounds.", &["Armor", "Health"]),
            item(3143, "Randuin's Omen", 2700, &["350 Health", "75 Armor"], "Reduces damage from critical strikes.", &["Armor", "Health"]),
            item(3047, "Plated Steelcaps", 1200, &["25 Armor", "45 Move Speed"], "", &["Armor", "Boots"]),
        ]
    }

    fn enemy(name: &str, roles: &[&str], damage: &str) -> Enemy {
        Enemy { name: name.into(), alias: name.into(), roles: roles.iter().map(|s| s.to_string()).collect(), damage_type: damage.into(), ..Default::default() }
    }

    fn set(id: i64, games: i64) -> ItemSet {
        ItemSet { ids: vec![id], games, win_rate: 0.5, ..Default::default() }
    }

    #[test]
    fn tags_from_item_text() {
        let all = items();
        let tags = |id: i64| all.iter().find(|i| i.id == id).unwrap().situations.clone();
        assert_eq!(tags(3033), vec![ANTI_HEAL, ARMOR_PEN]);
        assert_eq!(tags(3036), vec![ARMOR_PEN]);
        assert_eq!(tags(3026), vec![ARMOR, SURVIVE]);
        assert!(tags(3031).is_empty());
        assert!(tags(3047).is_empty(), "boots are picked separately");
        let shieldbreaker = item_tags(&[], "Shield Reaver\nDamage reduces shields on enemy champions by 50%.", &[]);
        assert_eq!(shieldbreaker, vec![ANTI_SHIELD]);
        let botrk = item_tags(&[], "Mist's Edge\nAttacks deal 9% of the target's current Health as physical damage.", &[]);
        assert_eq!(botrk, vec![ANTI_TANK]);
        let heartsteel = item_tags(&["900 Health".into()], "Colossal Consumption\nDeal bonus damage equal to 70 + 6% of your max Health to the target.", &[]);
        assert!(!heartsteel.contains(&ANTI_TANK.to_string()));
        assert_eq!(item_tags(&[], "Quicksilver\nRemoves all crowd control debuffs.", &[]), vec![CLEANSE]);
    }

    #[test]
    fn champ_select_picks_answer_the_comp() {
        let all = items();
        let enemies = vec![
            enemy("Soraka", &["support", "mage"], "AP"),
            enemy("Aatrox", &["fighter"], "AD"),
            enemy("Zed", &["assassin"], "AD"),
            enemy("Malphite", &["tank"], "AP"),
            enemy("Jinx", &["marksman"], "AD"),
        ];
        let pool = [set(3031, 900), set(3036, 500), set(3026, 300), set(3033, 200)];
        let roles = vec!["marksman".to_string()];
        let st = suggest(&Input {
            champion_id: 21,
            my_roles: &roles,
            pool: &pool,
            core: &[],
            owned: &[],
            enemies: &enemies,
            items: &all,
            previous: &[],
            live: false,
        });
        let ids: Vec<i64> = st.items.iter().map(|i| i.id).collect();
        assert_eq!(ids[0], 3033, "two healers: anti-heal first ({:?})", st.items);
        assert_eq!(st.items[0].reason, "Healing from Soraka and Aatrox");
        assert!(ids.contains(&3026), "Zed: Guardian Angel");
        assert!(!ids.contains(&3031), "Infinity Edge answers nothing");
        assert!(st.threats.iter().any(|t| t.tag == ANTI_HEAL));
    }

    #[test]
    fn live_items_change_the_picks() {
        let all = items();
        let mut malphite = enemy("Malphite", &["tank"], "AP");
        malphite.items = vec![3075, 3143];
        let mut draven = enemy("Draven", &["marksman"], "AD");
        draven.items = vec![3072];
        (draven.kills, draven.deaths) = (8, 1);
        let enemies = vec![malphite, draven];
        let pool = [set(3036, 500), set(3026, 300)];
        let roles = vec!["marksman".to_string()];
        let input = Input {
            champion_id: 21,
            my_roles: &roles,
            pool: &pool,
            core: &[],
            owned: &[3123],
            enemies: &enemies,
            items: &all,
            previous: &[],
            live: true,
        };
        let st = suggest(&input);
        let ids: Vec<i64> = st.items.iter().map(|i| i.id).collect();
        // 150 armor on Malphite → Lord Dominik's; Draven's Bloodthirster alone
        // isn't heavy healing, so no fallback anti-heal.
        assert_eq!(ids.first(), Some(&3036), "{:?}", st.items);
        assert!(st.items[0].reason.contains("Malphite (150 armor from items)"));
        // Executioner's builds into Mortal Reminder: started, and pulled in as the
        // anti-heal fallback once healing is heavy.
        let mut soraka = enemy("Soraka", &["support"], "AP");
        soraka.kills = 0;
        let enemies = vec![enemies[0].clone(), enemies[1].clone(), soraka];
        let mut with_tree = all.clone();
        with_tree.iter_mut().find(|i| i.id == 3123).unwrap().into = vec![3033];
        let st = suggest(&Input { enemies: &enemies, items: &with_tree, ..input });
        let mr = st.items.iter().find(|i| i.id == 3033).expect("anti-heal fallback");
        assert!(mr.off_pool && mr.started);
    }

    #[test]
    fn owned_items_cover_their_threat() {
        let all = items();
        let enemies = vec![enemy("Soraka", &["support"], "AP"), enemy("Aatrox", &["fighter"], "AD")];
        let pool = [set(3033, 200)];
        let roles = vec!["marksman".to_string()];
        let st = suggest(&Input {
            champion_id: 21,
            my_roles: &roles,
            pool: &pool,
            core: &[],
            owned: &[3075],
            enemies: &enemies,
            items: &all,
            previous: &[],
            live: true,
        });
        assert!(st.items.is_empty(), "Thornmail already applies Grievous Wounds: {:?}", st.items);
    }

    #[test]
    fn one_defensive_item_doesnt_end_a_big_threat() {
        let mut all = items();
        all.push(item(3814, "Edge of Night", 3000, &["50 Attack Damage", "250 Health"], "Annul\nGrants a Spell Shield that blocks the next enemy ability.", &["Damage", "Health"]));
        let mut zed = enemy("Zed", &["assassin"], "AD");
        (zed.kills, zed.deaths) = (10, 1);
        let mut talon = enemy("Talon", &["assassin"], "AD");
        (talon.kills, talon.deaths) = (6, 2);
        let enemies = vec![zed, talon];
        let pool = [set(3026, 300), set(3814, 200)];
        let roles = vec!["marksman".to_string()];
        let st = suggest(&Input {
            champion_id: 21,
            my_roles: &roles,
            pool: &pool,
            core: &[],
            owned: &[3026],
            enemies: &enemies,
            items: &all,
            previous: &[],
            live: true,
        });
        // Guardian Angel takes the edge off two fed assassins but doesn't answer them.
        assert_eq!(st.items.first().map(|i| i.id), Some(3814), "{:?}", st.items);
    }
}
