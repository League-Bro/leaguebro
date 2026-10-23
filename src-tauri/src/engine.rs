//! The background loop: watches the League client, reacts to champ select
//! and loading, and feeds the overlay while a game is running.

use crate::util::{flag, get_json, int, ints, list, msg, riot_name, strings, text, web_client, CDRAGON_GAME_DATA};
use crate::config::Config;
use crate::itemsets;
use crate::lcu::{self, Lcu};
use crate::live::{self, OverlayState};
use crate::matchup::{self, MatchupState};
use crate::opgg::{self, OpGg, RecChoice, Recommendation};
use crate::postgame::{self, PostGame};
use crate::runes;
use crate::scout::{self, Profile};
use crate::situational::{self, SituationalState};
use serde::Serialize;
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, RwLock};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition};
use tokio::sync::Mutex;

// ---------- shared state ----------

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ChampInfo {
    pub id: i64,
    pub name: String,
    pub alias: String,
    /// Client roles, e.g. ["mage", "assassin"].
    pub roles: Vec<String>,
    /// A League Classic copy of a champion (id = 60000 + the normal id, alias `Jade_…`).
    pub classic: bool,
}

pub fn is_league_classic(id: i64, alias: &str) -> bool {
    id >= 60000 || alias.starts_with("Jade_")
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ItemInfo {
    pub id: i64,
    pub name: String,
    pub price_total: i64,
    pub icon_path: String,
    /// Stat lines from the tooltip, e.g. ["100 Ability Power", "600 Mana"].
    pub stats: Vec<String>,
    /// Passive/active text from the tooltip as plain text.
    pub desc: String,
    /// The same text split into its passives and actives, for the item tooltip.
    pub effects: Vec<ItemEffect>,
    /// Client shop categories, e.g. ["SpellDamage", "Mana"].
    pub categories: Vec<String>,
    /// Items this one builds into (the client's `to`).
    pub into: Vec<i64>,
    /// Items this one is built from (the client's `from`).
    pub from: Vec<i64>,
    /// What it's good against (`situational::item_tags`), e.g. ["antiHeal"].
    pub situations: Vec<String>,
}

/// One passive or active from an item's tooltip.
#[derive(Debug, Clone, Serialize, Default, PartialEq)]
pub struct ItemEffect {
    /// "passive", "active", or "" for text that isn't under a heading.
    pub kind: String,
    pub name: String,
    pub text: String,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct PerkInfo {
    pub id: i64,
    pub name: String,
    pub icon_path: String,
    /// One-line plain-text summary (runes: shortDesc, spells: description).
    pub desc: String,
    /// The client's short label for a rune, e.g. "Combo Damage".
    pub tag: String,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct StaticData {
    pub champions: Vec<ChampInfo>,
    pub items: Vec<ItemInfo>,
    pub perks: Vec<PerkInfo>,
    pub styles: Vec<PerkInfo>,
    pub spells: Vec<PerkInfo>,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Summoner {
    pub puuid: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub connected: bool,
    pub phase: String,
    pub summoner: Option<Summoner>,
    pub message: String,
    /// League's game window mode ("fullscreen", "windowed", "borderless"), from
    /// its settings; None until read. Fullscreen hides the overlay.
    pub window_mode: Option<String>,
}

/// League's `General.WindowMode` setting (checked against game.cfg, October 2026).
pub fn window_mode_label(value: i64) -> Option<&'static str> {
    match value {
        0 => Some("fullscreen"),
        1 => Some("windowed"),
        2 => Some("borderless"),
        _ => None,
    }
}

const WINDOW_MODE_RECHECK: Duration = Duration::from_secs(15);

#[derive(Debug, Clone, Serialize, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CsPlayer {
    pub cell_id: i64,
    pub champion_id: i64,
    pub pick_intent: i64,
    pub position: String,
    pub is_me: bool,
    /// False when Riot hides the name (ranked champ select for non-party players).
    pub visible: bool,
    pub name: Option<String>,
    pub puuid: Option<String>,
}

#[derive(Debug, Clone, Serialize, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ChampSelectView {
    pub queue_id: i64,
    pub my_champion_id: i64,
    pub my_position: String,
    pub locked: bool,
    pub allies: Vec<CsPlayer>,
    pub enemies: Vec<CsPlayer>,
    pub bans: Vec<i64>,
    pub timer_phase: String,
}

#[derive(Debug, Clone, Serialize, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LoadPlayer {
    pub puuid: Option<String>,
    pub name: Option<String>,
    pub champion_id: i64,
    pub position: String,
    pub is_me: bool,
}

#[derive(Debug, Clone, Serialize, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LoadingView {
    pub game_id: i64,
    pub queue_name: String,
    pub allies: Vec<LoadPlayer>,
    pub enemies: Vec<LoadPlayer>,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ImportEvent {
    pub ok: bool,
    pub champion_id: i64,
    pub message: String,
}

/// A Swiftplay lobby slot: the champion picked for one of your two positions.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SwiftplaySlot {
    pub champion_id: i64,
    /// Lowercase client position, e.g. "utility".
    pub position: String,
}

/// The current champion's recommendation, as shown in the UI.
#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct RecState {
    pub champion_id: i64,
    pub position: String,
    pub loading: bool,
    /// OP.GG's answer as fetched (top options); see `effective` for the picked ones.
    pub rec: Option<Recommendation>,
    pub error: Option<String>,
    /// The rune page, spells and build the player picked. Starts on the top
    /// options for each new champion/role.
    pub choice: RecChoice,
    /// Your lane opponent and how you match up (lane modes, once enemies pick).
    pub matchup: Option<MatchupState>,
}

impl RecState {
    /// OP.GG's build against the lane opponent, when there are enough games.
    fn matchup_rec(&self) -> Option<&Recommendation> {
        let m = self.matchup.as_ref()?.matchup.as_ref()?;
        m.rec.as_ref().filter(|r| r.games >= opgg::MIN_GAMES)
    }

    /// The recommendation with the player's picks in place (the matchup build
    /// if they chose it); what imports, the shop build and the overlay use.
    pub fn effective(&self) -> Option<Recommendation> {
        let base = if self.choice.matchup { self.matchup_rec().or(self.rec.as_ref()) } else { self.rec.as_ref() };
        base.map(|r| opgg::with_choice(r, &self.choice))
    }

    /// As the UI gets it: `rec` already has the picks in place.
    pub fn for_ui(&self) -> RecState {
        RecState { rec: self.effective(), ..self.clone() }
    }
}

#[derive(Default)]
pub struct Shared {
    pub lcu: Option<Lcu>,
    pub status: Status,
    pub statics: Option<StaticData>,
    pub champ_select: Option<ChampSelectView>,
    pub loading: Option<LoadingView>,
    pub map_id: i64,
    pub queue_id: i64,
    pub my_champion_id: i64,
    pub rec: Option<RecState>,
    pub profiles: HashMap<String, Profile>,
    pub last_import: Option<ImportEvent>,
    pub overlay: Option<OverlayState>,
    pub overlay_preview: bool,
    pub post_game: Option<PostGame>,
    /// Slots of the Swiftplay lobby you're in (empty otherwise).
    pub swiftplay: Vec<SwiftplaySlot>,
    /// The lane opponent the player chose in champ select (0 = none); None = guess.
    pub opponent_pick: Option<i64>,
    /// Situational items for this game (champ select picks, then the live scoreboard).
    pub situational: Option<SituationalState>,
}

impl Shared {
    /// The map you're on; Summoner's Rift (11) until known.
    pub(crate) fn map(&self) -> i64 {
        if self.map_id == 0 { 11 } else { self.map_id }
    }

    pub fn champion(&self, id: i64) -> Option<&ChampInfo> {
        self.statics.as_ref()?.champions.iter().find(|c| c.id == id)
    }

    /// The champion's alias for OP.GG, which has no League Classic stats.
    pub fn opgg_alias(&self, id: i64) -> Option<String> {
        self.champion(id).filter(|c| !c.classic).map(|c| c.alias.clone())
    }

    /// "Flash + Ignite"
    fn spell_names(&self, a: i64, b: i64) -> String {
        let name = |id: i64| {
            let spell = self.statics.as_ref().and_then(|s| s.spells.iter().find(|p| p.id == id));
            spell.map_or_else(|| format!("spell {id}"), |p| p.name.clone())
        };
        format!("{} + {}", name(a), name(b))
    }
}

pub struct AppState {
    pub config: RwLock<Config>,
    pub config_path: PathBuf,
    pub shared: Mutex<Shared>,
    pub opgg: OpGg,
    pub patches: crate::patch::PatchNotesClient,
    pub tiers: crate::tierlist::TierLists,
    pub guides: crate::guide::Guides,
    pub overlay_input: std::sync::Mutex<OverlayInput>,
}

/// Mouse handling for the overlay window. While locked the window is
/// click-through except over its buttons (the padlock, "show more").
#[derive(Debug, Default)]
pub struct OverlayInput {
    pub unlocked: bool,
    /// Button bounds (x, y, width, height) in CSS pixels inside the overlay.
    pub buttons: Vec<[f64; 4]>,
    /// What `set_ignore_cursor_events` was last set to.
    pub passthrough: bool,
}

impl AppState {
    pub fn config(&self) -> Config {
        self.config.read().unwrap().clone()
    }
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub status: Status,
    pub champ_select: Option<ChampSelectView>,
    pub loading: Option<LoadingView>,
    pub profiles: Vec<Profile>,
    pub last_import: Option<ImportEvent>,
    pub overlay: Option<OverlayState>,
    pub rec: Option<RecState>,
    pub post_game: Option<PostGame>,
    pub swiftplay: Vec<SwiftplaySlot>,
    pub situational: Option<SituationalState>,
}

// ---------- parsing helpers ----------

pub fn parse_champ_select(session: &Value) -> ChampSelectView {
    let me_cell = int(session, "localPlayerCellId");
    let player = |p: &Value| {
        let hidden = text(p, "nameVisibilityType").eq_ignore_ascii_case("HIDDEN");
        let puuid = text(p, "puuid");
        let visible = !hidden && !puuid.is_empty();
        CsPlayer {
            cell_id: int(p, "cellId"),
            champion_id: int(p, "championId"),
            pick_intent: int(p, "championPickIntent"),
            position: text(p, "assignedPosition").to_string(),
            is_me: int(p, "cellId") == me_cell,
            visible,
            name: if visible { riot_name(p) } else { None },
            puuid: if visible { Some(puuid.to_string()) } else { None },
        }
    };
    let team = |k: &str| -> Vec<CsPlayer> { list(session, k).iter().map(player).collect() };
    let allies = team("myTeam");
    let mut enemies = team("theirTeam");
    // Never show anything about opponents beyond their visible picks.
    for e in &mut enemies {
        e.name = None;
        e.puuid = None;
        e.visible = false;
    }
    let me = allies.iter().find(|p| p.is_me).cloned().unwrap_or_default();
    let my_champion_id = if me.champion_id != 0 { me.champion_id } else { me.pick_intent };

    // Locked in = my pick action is completed.
    let actions = list(session, "actions");
    let locked = actions.iter().filter_map(Value::as_array).flatten().any(|a| {
        int(a, "actorCellId") == me_cell && text(a, "type") == "pick" && flag(a, "completed")
    })
        // Modes without pick actions (ARAM) assign the champion directly.
        || (me.champion_id != 0 && actions.is_empty());

    let bans = ["/bans/myTeamBans", "/bans/theirTeamBans"].iter().flat_map(|k| ints(session, k)).filter(|&x| x > 0).collect();
    ChampSelectView {
        queue_id: int(session, "queueId"),
        my_champion_id,
        my_position: me.position.clone(),
        locked,
        allies,
        enemies,
        bans,
        timer_phase: text(session, "/timer/phase").to_string(),
    }
}

pub fn parse_loading(session: &Value, my_puuid: &str) -> Option<LoadingView> {
    let gd = session.get("gameData")?;
    let team = |k: &str| -> Vec<LoadPlayer> {
        list(gd, k)
            .iter()
            .map(|p| {
                let puuid = text(p, "puuid");
                LoadPlayer {
                    puuid: Some(puuid.to_string()).filter(|p| !p.is_empty()),
                    name: riot_name(p),
                    champion_id: int(p, "championId"),
                    position: text(p, "selectedPosition").to_string(),
                    is_me: !my_puuid.is_empty() && puuid == my_puuid,
                }
            })
            .collect()
    };
    let one = team("teamOne");
    let two = team("teamTwo");
    if one.is_empty() && two.is_empty() {
        return None;
    }
    let (allies, enemies) = if two.iter().any(|p| p.is_me) { (two, one) } else { (one, two) };
    Some(LoadingView {
        game_id: int(gd, "gameId"),
        queue_name: text(gd, "/queue/description").to_string(),
        allies,
        enemies,
    })
}

async fn load_statics(lcu: &Lcu) -> anyhow::Result<StaticData> {
    let champs = lcu.get_req("/lol-game-data/assets/v1/champion-summary.json").await?;
    let items = lcu.get_req("/lol-game-data/assets/v1/items.json").await?;
    let perks = lcu.get("/lol-game-data/assets/v1/perks.json").await.ok().flatten().unwrap_or(Value::Null);
    let styles = lcu.get("/lol-game-data/assets/v1/perkstyles.json").await.ok().flatten().unwrap_or(Value::Null);
    let spells = lcu.get("/lol-game-data/assets/v1/summoner-spells.json").await.ok().flatten().unwrap_or(Value::Null);
    Ok(build_statics(&champs, &items, &perks, &styles, &spells))
}

/// The same files from CommunityDragon's copy of the client's game data, for
/// when the client isn't running (the Champions and Tier List tabs, champion
/// names and item icons on the Profile page). Kept until the client connects
/// and replaces them.
pub async fn load_statics_web() -> anyhow::Result<StaticData> {
    let http = web_client(20);
    let get = |file: &str| get_json(http.get(format!("{CDRAGON_GAME_DATA}/{file}")), "CommunityDragon");
    let (champs, items, perks, styles, spells) = tokio::join!(
        get("champion-summary.json"),
        get("items.json"),
        get("perks.json"),
        get("perkstyles.json"),
        get("summoner-spells.json"),
    );
    let or_null = |v: anyhow::Result<Value>| v.unwrap_or(Value::Null);
    Ok(build_statics(&champs?, &items?, &or_null(perks), &or_null(styles), &or_null(spells)))
}

fn build_statics(champs: &Value, items: &Value, perks: &Value, styles: &Value, spells: &Value) -> StaticData {
    let mut champions: Vec<ChampInfo> = champs
        .as_array()
        .into_iter()
        .flatten()
        .filter(|c| int(c, "id") > 0)
        .map(|c| ChampInfo {
            id: int(c, "id"),
            name: text(c, "name").into(),
            alias: text(c, "alias").into(),
            roles: strings(c, "roles"),
            classic: is_league_classic(int(c, "id"), text(c, "alias")),
        })
        .collect();
    champions.sort_by(|a, b| a.name.cmp(&b.name));
    // Every item, not just what the shop sells: upgrades (Muramana, Seraph's),
    // champion-only items and mode copies (ids ≥ 10000) still show up in
    // builds, match history and the scoreboard, and need names and icons.
    let mut items: Vec<ItemInfo> = items
        .as_array()
        .into_iter()
        .flatten()
        .filter(|it| int(it, "id") > 0 && !text(it, "name").is_empty())
        .map(|it| {
            let (stats, desc, effects) = item_tooltip(text(it, "description"));
            let categories = strings(it, "categories");
            ItemInfo {
                id: int(it, "id"),
                name: text(it, "name").into(),
                price_total: int(it, "priceTotal"),
                icon_path: text(it, "iconPath").into(),
                situations: situational::item_tags(&stats, &desc, &categories),
                stats,
                desc,
                effects,
                categories,
                into: ints(it, "to"),
                from: ints(it, "from"),
            }
        })
        .collect();
    items.sort_by(|a, b| a.name.cmp(&b.name));
    let perk = |p: &Value, desc_key: &str| PerkInfo {
        id: int(p, "id"),
        name: text(p, "name").into(),
        icon_path: text(p, "iconPath").into(),
        desc: plain_text(text(p, desc_key)),
        tag: text(p, "recommendationDescriptor").into(),
    };
    StaticData {
        champions,
        items,
        perks: perks.as_array().into_iter().flatten().map(|p| perk(p, "shortDesc")).collect(),
        styles: list(styles, "styles").iter().map(|p| perk(p, "tooltip")).collect(),
        spells: spells.as_array().into_iter().flatten().map(|p| perk(p, "description")).collect(),
    }
}

/// Strips the client's tooltip markup (`<br>`, `<magicDamage>`, `@vars@`…) to plain text.
pub fn plain_text(html: &str) -> String {
    let mut out = String::with_capacity(html.len());
    let mut in_tag = false;
    let mut tag = String::new();
    for c in html.chars() {
        match c {
            '<' => {
                in_tag = true;
                tag.clear();
            }
            '>' if in_tag => {
                in_tag = false;
                let name = tag.trim_start_matches('/').split_whitespace().next().unwrap_or("").to_ascii_lowercase();
                if matches!(name.as_str(), "br" | "li" | "hr") {
                    out.push('\n');
                }
            }
            _ if in_tag => tag.push(c),
            _ => out.push(c),
        }
    }
    // Unfilled numbers like @TotalDamage@ mean nothing outside the client.
    let mut cleaned = String::with_capacity(out.len());
    let mut rest = out.as_str();
    while let Some(at) = rest.find('@') {
        cleaned.push_str(&rest[..at]);
        let after = &rest[at + 1..];
        match after.find('@') {
            Some(end) if after[..end].chars().all(|c| c.is_ascii_alphanumeric() || "_.*-".contains(c)) => {
                rest = &after[end + 1..];
            }
            _ => {
                cleaned.push('@');
                rest = after;
            }
        }
    }
    cleaned.push_str(rest);
    let cleaned = cleaned.replace("&nbsp;", " ").replace("&amp;", "&");
    cleaned
        .lines()
        .map(|l| l.split_whitespace().collect::<Vec<_>>().join(" "))
        .filter(|l| !l.is_empty())
        .collect::<Vec<_>>()
        .join("\n")
}

/// Splits an item tooltip into its stat lines and the rest (passives/actives),
/// both as plain text and as separate effects.
pub fn item_tooltip(html: &str) -> (Vec<String>, String, Vec<ItemEffect>) {
    let (stats_html, rest) = match (html.find("<stats>"), html.find("</stats>")) {
        (Some(a), Some(b)) if b > a => (&html[a + 7..b], format!("{}{}", &html[..a], &html[b + 8..])),
        _ => ("", html.to_string()),
    };
    let stats = plain_text(stats_html).lines().map(str::to_string).collect();
    (stats, plain_text(&rest), item_effects(&rest))
}

/// Cuts tooltip text at each `<passive>Name</passive>` / `<active>Name</active>`
/// heading; the text up to the next heading belongs to it.
fn item_effects(html: &str) -> Vec<ItemEffect> {
    let mut out = Vec::new();
    let mut rest = html;
    let (mut kind, mut name) = ("", String::new());
    loop {
        let next = ["passive", "active"].into_iter().filter_map(|k| rest.find(&format!("<{k}>")).map(|i| (i, k))).min();
        let text = plain_text(next.map_or(rest, |(i, _)| &rest[..i]));
        if !text.is_empty() || !name.is_empty() {
            out.push(ItemEffect { kind: kind.into(), name: std::mem::take(&mut name), text });
        }
        let Some((i, k)) = next else { break };
        let after = &rest[i + k.len() + 2..];
        let close = format!("</{k}>");
        let (head, tail) = after.find(&close).map_or((after, ""), |e| (&after[..e], &after[e + close.len()..]));
        kind = k;
        name = plain_text(head);
        rest = tail;
    }
    out
}

// ---------- overlay window ----------

pub fn set_overlay_visible(app: &AppHandle, visible: bool) {
    let Some(w) = app.get_webview_window("overlay") else { return };
    if visible {
        let cfg = app.state::<AppState>().config();
        let pos = match (cfg.overlay_x, cfg.overlay_y) {
            (Some(x), Some(y)) => Some(PhysicalPosition::new(x, y)),
            _ => w.primary_monitor().ok().flatten().map(|m| {
                let scale = m.scale_factor();
                let width = w.outer_size().map(|s| s.width as i32).unwrap_or((270.0 * scale) as i32);
                PhysicalPosition::new(m.position().x + m.size().width as i32 - width - (24.0 * scale) as i32, m.position().y + (140.0 * scale) as i32)
            }),
        };
        let already_visible = w.is_visible().unwrap_or(false);
        if !already_visible {
            if let Some(p) = pos {
                let _ = w.set_position(p);
            }
            set_overlay_locked(app, true);
        }
        let _ = w.set_always_on_top(true);
        let _ = w.show();
    } else {
        let _ = w.hide();
    }
}

pub fn set_overlay_locked(app: &AppHandle, locked: bool) {
    let Some(w) = app.get_webview_window("overlay") else { return };
    let state = app.state::<AppState>();
    {
        let mut input = state.overlay_input.lock().unwrap();
        input.unlocked = !locked;
        input.passthrough = locked;
    }
    let _ = w.set_ignore_cursor_events(locked);
    let _ = app.emit("overlay-locked", locked);
}

/// Makes the locked overlay clickable only while the cursor is over one of its
/// buttons, so the rest of it never takes clicks away from the game.
pub async fn watch_overlay_cursor(app: AppHandle) {
    let mut tick = tokio::time::interval(Duration::from_millis(50));
    loop {
        tick.tick().await;
        let Some(w) = app.get_webview_window("overlay") else { continue };
        if !w.is_visible().unwrap_or(false) {
            continue;
        }
        let state = app.state::<AppState>();
        let (unlocked, buttons, passthrough) = {
            let i = state.overlay_input.lock().unwrap();
            (i.unlocked, i.buttons.clone(), i.passthrough)
        };
        if unlocked {
            continue;
        }
        let over = match (app.cursor_position(), w.inner_position(), w.scale_factor()) {
            (Ok(cursor), Ok(origin), Ok(scale)) => {
                let (cx, cy) = ((cursor.x - origin.x as f64) / scale, (cursor.y - origin.y as f64) / scale);
                buttons.iter().any(|b| over_button(*b, cx, cy))
            }
            _ => false,
        };
        if over == passthrough {
            let mut i = state.overlay_input.lock().unwrap();
            if !i.unlocked && i.passthrough == passthrough {
                let _ = w.set_ignore_cursor_events(!over);
                i.passthrough = !over;
            }
        }
    }
}

fn over_button([x, y, w, h]: [f64; 4], cx: f64, cy: f64) -> bool {
    cx >= x && cx <= x + w && cy >= y && cy <= y + h
}

// ---------- the loop ----------

struct Engine {
    app: AppHandle,
    lcu: Option<Lcu>,
    my_puuid: String,
    phase: String,
    last_connect_try: Option<Instant>,
    last_import_key: Option<(i64, String)>,
    last_rec_key: Option<(i64, String)>,
    /// Champion, position, enemy picks and opponent pick the matchup was worked out for.
    last_matchup_key: Option<MatchupKey>,
    /// Swiftplay lobby slots (champion, position) already imported.
    last_slot_keys: Vec<(i64, String)>,
    requested: HashSet<String>,
    loading_game_id: Option<i64>,
    overlay_shown: bool,
    pending_post_game: Option<PendingPostGame>,
    last_window_check: Option<Instant>,
    /// Last try at loading static data from CommunityDragon (client closed).
    last_web_statics: Option<Instant>,
    live_http: reqwest::Client,
    /// A background damage-type lookup for situational items is running.
    damage_lookup: Arc<AtomicBool>,
}

/// A finished game whose match-history record hasn't been fetched yet. The
/// client usually has it a few seconds after the game ends.
struct PendingPostGame {
    game_id: i64,
    queue_name: String,
    since: Instant,
    last_try: Option<Instant>,
}

/// An enemy for the situational items: their pick, and in game their items and score.
struct EnemySeen {
    champion_id: i64,
    items: Vec<i64>,
    kills: i64,
    deaths: i64,
    assists: i64,
}

const POST_GAME_RETRY: Duration = Duration::from_secs(3);
const POST_GAME_GIVE_UP: Duration = Duration::from_secs(180);
const WEB_STATICS_RETRY: Duration = Duration::from_secs(60);

fn in_game(phase: &str) -> bool {
    matches!(phase, "GameStart" | "InProgress" | "Reconnect")
}

impl Engine {
    fn state(&self) -> tauri::State<'_, AppState> {
        self.app.state::<AppState>()
    }

    async fn set_status(&self, connected: bool, phase: &str, summoner: Option<Summoner>, message: &str) {
        let state = self.state();
        let mut sh = state.shared.lock().await;
        // The window mode is refreshed on its own timer; keep it while connected.
        let window_mode = if connected { sh.status.window_mode.clone() } else { None };
        let status = Status { connected, phase: phase.into(), summoner, message: message.into(), window_mode };
        sh.status = status.clone();
        drop(sh);
        let _ = self.app.emit("status", status);
    }

    /// Re-reads League's window mode every 15 s and sends a status update when it changes.
    async fn refresh_window_mode(&mut self, lcu: &Lcu) {
        if self.last_window_check.is_some_and(|t| t.elapsed() < WINDOW_MODE_RECHECK) {
            return;
        }
        self.last_window_check = Some(Instant::now());
        let Ok(Some(settings)) = lcu.get("/lol-game-settings/v1/game-settings").await else { return };
        let mode = settings
            .pointer("/General/WindowMode")
            .and_then(Value::as_i64)
            .and_then(window_mode_label)
            .map(String::from);
        let status = {
            let state = self.state();
            let mut sh = state.shared.lock().await;
            if sh.status.window_mode == mode {
                return;
            }
            sh.status.window_mode = mode;
            sh.status.clone()
        };
        let _ = self.app.emit("status", status);
    }

    async fn connect(&mut self) {
        if let Some(t) = self.last_connect_try {
            if t.elapsed() < Duration::from_secs(3) {
                return;
            }
        }
        self.last_connect_try = Some(Instant::now());
        let install = self.state().config().install_dir;
        let Some(creds) = tokio::task::spawn_blocking(move || lcu::discover(install.as_deref())).await.ok().flatten()
        else {
            return;
        };
        let client = Lcu::new(&creds);
        let me = match client.get_req("/lol-summoner/v1/current-summoner").await {
            Ok(v) => v,
            Err(_) => return, // client still starting up
        };
        let summoner = Summoner { puuid: text(&me, "puuid").into(), name: riot_name(&me).unwrap_or_default() };
        self.my_puuid = summoner.puuid.clone();
        // Replaces any web copy: the client's is in the player's language and patch.
        let statics = load_statics(&client).await.ok();
        {
            let state = self.state();
            let mut sh = state.shared.lock().await;
            sh.lcu = Some(client.clone());
            if statics.is_some() {
                sh.statics = statics.clone();
            }
        }
        if let Some(s) = statics {
            let _ = self.app.emit("static", s);
        }
        self.lcu = Some(client);
        self.phase.clear();
        self.last_window_check = None;
        self.set_status(true, "None", Some(summoner), "Connected to the League client").await;
    }

    async fn disconnect(&mut self) {
        self.lcu = None;
        self.phase.clear();
        {
            let state = self.state();
            let mut sh = state.shared.lock().await;
            sh.lcu = None;
            sh.champ_select = None;
        }
        self.set_swiftplay(Vec::new()).await;
        self.hide_overlay().await;
        self.set_status(false, "", None, "Waiting for the League client").await;
    }

    /// While the client is closed, fetches champions, items and runes from
    /// CommunityDragon so the Champions and Tier List tabs work. In the
    /// background (five files, a few seconds), retried every minute if it fails.
    async fn load_web_statics(&mut self) {
        if self.last_web_statics.is_some_and(|t| t.elapsed() < WEB_STATICS_RETRY)
            || self.state().shared.lock().await.statics.is_some()
        {
            return;
        }
        self.last_web_statics = Some(Instant::now());
        let app = self.app.clone();
        tauri::async_runtime::spawn(async move {
            let statics = match load_statics_web().await {
                Ok(s) => s,
                Err(e) => return eprintln!("champion data from CommunityDragon failed: {e:#}"),
            };
            let state = app.state::<AppState>();
            let mut sh = state.shared.lock().await;
            // The client may have connected meanwhile; its data wins.
            if sh.statics.is_none() {
                sh.statics = Some(statics.clone());
                drop(sh);
                let _ = app.emit("static", statics);
            }
        });
    }

    async fn tick(&mut self) {
        if self.lcu.is_none() {
            self.connect().await;
            if self.lcu.is_none() {
                self.load_web_statics().await;
                return;
            }
        }
        let lcu = self.lcu.clone().unwrap();
        let phase = match lcu.get("/lol-gameflow/v1/gameflow-phase").await {
            Ok(Some(Value::String(p))) => p,
            Ok(_) => "None".to_string(),
            Err(_) => {
                self.disconnect().await;
                return;
            }
        };
        if phase != self.phase {
            self.on_phase_change(&lcu, &phase).await;
        }
        match phase.as_str() {
            "ChampSelect" => self.champ_select(&lcu).await,
            "Lobby" => self.lobby(&lcu).await,
            "GameStart" | "InProgress" | "Reconnect" => {
                self.loading(&lcu).await;
                if phase != "GameStart" {
                    self.live().await;
                }
            }
            _ => {}
        }
        self.poll_post_game(&lcu).await;
        self.refresh_window_mode(&lcu).await;
    }

    /// Clears the live game (teams, overlay, recommendation) and starts
    /// looking for the finished game's match record.
    async fn end_game(&mut self, lcu: &Lcu) {
        let session_game_id = match lcu.get("/lol-gameflow/v1/session").await {
            Ok(Some(s)) => Some(int(&s, "/gameData/gameId")).filter(|id| *id > 0),
            _ => None,
        };
        let queue_name = self.clear_game().await.map(|l| l.queue_name).unwrap_or_default();
        self.hide_overlay().await;
        self.pending_post_game = self.loading_game_id.take().or(session_game_id).map(|game_id| PendingPostGame {
            game_id,
            queue_name,
            since: Instant::now(),
            last_try: None,
        });
    }

    /// Forgets the last game's teams, recommendation and summary; returns its teams.
    async fn clear_game(&mut self) -> Option<LoadingView> {
        self.last_rec_key = None;
        self.last_matchup_key = None;
        let loading = {
            let state = self.state();
            let mut sh = state.shared.lock().await;
            (sh.my_champion_id, sh.rec, sh.post_game, sh.opponent_pick, sh.situational) = (0, None, None, None, None);
            sh.loading.take()
        };
        let _ = self.app.emit("loading", Option::<LoadingView>::None);
        let _ = self.app.emit("recommendation", Option::<RecState>::None);
        let _ = self.app.emit("post-game", Option::<PostGame>::None);
        let _ = self.app.emit("situational", Option::<SituationalState>::None);
        loading
    }

    async fn poll_post_game(&mut self, lcu: &Lcu) {
        let Some(p) = self.pending_post_game.as_mut() else { return };
        if p.last_try.is_some_and(|t| t.elapsed() < POST_GAME_RETRY) {
            return;
        }
        if p.since.elapsed() > POST_GAME_GIVE_UP {
            self.pending_post_game = None;
            return;
        }
        p.last_try = Some(Instant::now());
        let path = format!("/lol-match-history/v1/games/{}", p.game_id);
        let Ok(Some(game)) = lcu.get(&path).await else { return };
        let Some(summary) = postgame::parse(&game, &self.my_puuid, &p.queue_name) else { return };
        self.pending_post_game = None;
        self.state().shared.lock().await.post_game = Some(summary.clone());
        let _ = self.app.emit("post-game", Some(summary));
    }

    async fn on_phase_change(&mut self, lcu: &Lcu, phase: &str) {
        let prev = std::mem::replace(&mut self.phase, phase.to_string());
        let summoner = self.state().shared.lock().await.status.summoner.clone();
        self.set_status(true, phase, summoner, "").await;
        // League Bro's shop files show for every champion: clear the last build when a
        // new champ select starts, and leftovers (a crash) when first connecting outside a game.
        if phase == "ChampSelect" || (prev.is_empty() && !in_game(phase)) {
            let configured = self.state().config().install_dir;
            if let Some(dir) = itemsets::install_dir(lcu, configured.as_deref()).await {
                let _ = itemsets::remove_own_global(&dir);
            }
        }
        if in_game(&prev) && !in_game(phase) {
            self.end_game(lcu).await;
        } else if prev.is_empty() && matches!(phase, "PreEndOfGame" | "EndOfGame") {
            // Started (or reconnected) on the post-game screen.
            self.loading_game_id = None;
            self.end_game(lcu).await;
        }
        if phase == "ChampSelect" {
            self.last_import_key = None;
            self.loading_game_id = None;
            self.pending_post_game = None;
            self.clear_game().await;
            // Map (11 = Summoner's Rift, 12 = ARAM) and queue pick the rune
            // lookup and OP.GG's game mode.
            if let Ok(Some(s)) = lcu.get("/lol-gameflow/v1/session").await {
                let state = self.state();
                let mut sh = state.shared.lock().await;
                sh.map_id = int(&s, "/map/id");
                sh.queue_id = int(&s, "/gameData/queue/id");
            }
        }
        if prev == "Lobby" && phase != "Lobby" {
            self.set_swiftplay(Vec::new()).await;
        }
        if prev == "ChampSelect" && phase != "ChampSelect" {
            self.state().shared.lock().await.champ_select = None;
            let _ = self.app.emit("champ-select", Option::<ChampSelectView>::None);
        }
        if !matches!(phase, "InProgress" | "Reconnect") {
            self.hide_overlay().await;
        }
    }

    fn scout(&mut self, lcu: &Lcu, puuid: &str) {
        if puuid.is_empty() || !self.requested.insert(puuid.to_string()) {
            return;
        }
        let app = self.app.clone();
        let lcu = lcu.clone();
        let puuid = puuid.to_string();
        tauri::async_runtime::spawn(async move {
            let profile = scout::lookup(&lcu, &puuid).await;
            app.state::<AppState>().shared.lock().await.profiles.insert(puuid, profile.clone());
            let _ = app.emit("scout", profile);
        });
    }

    async fn champ_select(&mut self, lcu: &Lcu) {
        let Ok(Some(session)) = lcu.get("/lol-champ-select/v1/session").await else { return };
        let view = parse_champ_select(&session);
        let cfg = self.state().config();
        let changed = {
            let state = self.state();
            let mut sh = state.shared.lock().await;
            sh.my_champion_id = view.my_champion_id;
            let changed = sh.champ_select.as_ref() != Some(&view);
            sh.champ_select = Some(view.clone());
            changed
        };
        if changed {
            let _ = self.app.emit("champ-select", Some(view.clone()));
        }
        if cfg.scout_in_champ_select {
            for p in view.allies.iter().filter(|p| p.visible && !p.is_me) {
                if let Some(id) = &p.puuid {
                    self.scout(lcu, id);
                }
            }
        }
        // Fetch the recommendation as soon as a champion is hovered so it's
        // ready (and visible) by lock-in.
        let rec_key = (view.my_champion_id, view.my_position.clone());
        if view.my_champion_id != 0 && self.last_rec_key.as_ref() != Some(&rec_key) {
            self.last_rec_key = Some(rec_key);
            let app = self.app.clone();
            let (champ, pos) = (view.my_champion_id, view.my_position.clone());
            tauri::async_runtime::spawn(async move {
                ensure_rec(&app, champ, &pos, None).await;
            });
        }
        // The lane matchup, once you've locked in (and again when the enemy picks change).
        let opponent_pick = self.state().shared.lock().await.opponent_pick;
        let matchup_key = matchup_key(&view, opponent_pick);
        if matchup_key.is_some() && self.last_matchup_key != matchup_key {
            self.last_matchup_key = matchup_key;
            let app = self.app.clone();
            tauri::async_runtime::spawn(async move { matchup::refresh(&app).await });
        }
        // Enemy picks only: names stay hidden (ranked rules), champions are public.
        let enemies = view
            .enemies
            .iter()
            .filter(|e| e.champion_id != 0)
            .map(|e| EnemySeen { champion_id: e.champion_id, items: Vec::new(), kills: 0, deaths: 0, assists: 0 })
            .collect();
        self.update_situational(enemies, Vec::new(), false).await;
        let should_import = cfg.auto_import_runes
            && view.my_champion_id != 0
            && (view.locked || cfg.import_on_hover);
        let key = (view.my_champion_id, view.my_position.clone());
        if should_import && self.last_import_key.as_ref() != Some(&key) {
            self.last_import_key = Some(key);
            // In the background: the import waits on OP.GG (seconds), and the
            // loop should keep updating champ select meanwhile.
            let app = self.app.clone();
            let (champ, pos) = (view.my_champion_id, view.my_position.clone());
            tauri::async_runtime::spawn(async move {
                let result = import_for(&app, champ, &pos).await;
                // A slow import for a champion you've since left (swap, dodge,
                // a new champ select) shouldn't report over the current one.
                if app.state::<AppState>().shared.lock().await.my_champion_id == champ {
                    publish_import(&app, champ, result).await;
                }
            });
        }
    }

    /// Swiftplay has no champ select: champions, runes and spells are picked
    /// per position slot in the lobby, so the import goes into those slots.
    /// Other lobbies have no slots.
    async fn lobby(&mut self, lcu: &Lcu) {
        let Ok(Some(slots)) = lcu.get(PLAYER_SLOTS).await else { return };
        let keys = slot_keys(&slots);
        self.set_swiftplay(keys.iter().map(|(c, p)| SwiftplaySlot { champion_id: *c, position: p.clone() }).collect())
            .await;
        if keys == self.last_slot_keys || !self.state().config().auto_import_runes {
            return;
        }
        // Only slots that changed, so runes you edit by hand afterwards stay.
        let changed: Vec<(usize, i64, String)> = keys
            .iter()
            .enumerate()
            .filter(|(i, k)| k.0 != 0 && self.last_slot_keys.get(*i) != Some(*k))
            .map(|(i, k)| (i, k.0, k.1.clone()))
            .collect();
        self.last_slot_keys = keys;
        if changed.is_empty() {
            return;
        }
        let app = self.app.clone();
        let lcu = lcu.clone();
        tauri::async_runtime::spawn(async move {
            import_slots(&app, &lcu, changed).await;
        });
    }

    async fn set_swiftplay(&self, slots: Vec<SwiftplaySlot>) {
        let state = self.state();
        let mut sh = state.shared.lock().await;
        if sh.swiftplay != slots {
            sh.swiftplay = slots.clone();
            drop(sh);
            let _ = self.app.emit("swiftplay", slots);
        }
    }

    async fn loading(&mut self, lcu: &Lcu) {
        if self.loading_game_id.is_some() {
            return;
        }
        let Ok(Some(session)) = lcu.get("/lol-gameflow/v1/session").await else { return };
        let Some(view) = parse_loading(&session, &self.my_puuid) else { return };
        self.loading_game_id = Some(view.game_id);
        if let Some(me) = view.allies.iter().find(|p| p.is_me) {
            if me.champion_id != 0 {
                self.state().shared.lock().await.my_champion_id = me.champion_id;
            }
        }
        self.state().shared.lock().await.loading = Some(view.clone());
        let _ = self.app.emit("loading", Some(view.clone()));
        if self.state().config().scout_on_loading {
            for p in view.allies.iter().chain(view.enemies.iter()) {
                if let (Some(id), false) = (&p.puuid, p.is_me) {
                    self.scout(lcu, id);
                }
            }
        }
    }

    async fn live(&mut self) {
        let data: Value = match self.live_http.get(live::LIVE_URL).send().await {
            Ok(r) if r.status().is_success() => match r.json().await {
                Ok(v) => v,
                Err(_) => return,
            },
            _ => return, // game still loading
        };
        let cfg = self.state().config();
        let mut fetch_rec: Option<(i64, String, String)> = None;
        let state = {
            let state = self.state();
            let mut sh = state.shared.lock().await;
            let items: HashMap<i64, live::ShopItem> = sh
                .statics
                .as_ref()
                .map(|s| {
                    s.items
                        .iter()
                        .map(|it| (it.id, live::ShopItem { name: it.name.clone(), price: it.price_total, from: it.from.clone() }))
                        .collect()
                })
                .unwrap_or_default();
            // Fall back to matching the live champion name if champ select was missed.
            if sh.my_champion_id == 0 {
                let me = live::find_me(&data).and_then(|p| p.get("championName")).and_then(Value::as_str).unwrap_or("");
                // League Classic copies share the name; this fallback is for normal League.
                if let Some(c) = sh.statics.as_ref().and_then(|s| s.champions.iter().find(|c| c.name == me && !c.classic)) {
                    sh.my_champion_id = c.id;
                }
            }
            // If League Bro was started mid-game (no champ select), look the
            // recommendation up from the live game instead.
            let champ = sh.my_champion_id;
            let need_rec = champ != 0
                && cfg.rec_source == "opgg"
                && self.last_rec_key.as_ref().map(|k| k.0) != Some(champ);
            if need_rec {
                let me = live::find_me(&data);
                let pos = me.and_then(|p| p.get("position")).and_then(Value::as_str).unwrap_or("").to_lowercase();
                let mode = text(&data, "/gameData/gameMode").to_string();
                fetch_rec = Some((champ, pos, mode));
            }
            let rec = sh.rec.as_ref().filter(|r| r.champion_id == champ).and_then(RecState::effective);
            let build = rec
                .as_ref()
                .filter(|r| cfg.use_recommended_builds && r.games >= opgg::MIN_GAMES && !r.build_order.is_empty())
                .map(|r| r.build_order.as_slice());
            let empty: Vec<String> = Vec::new();
            let (skill_max, skill_order) = match rec.as_ref().filter(|_| cfg.show_skill_hint) {
                Some(r) => (r.skill_max.as_slice(), r.skill_order.as_slice()),
                None => (empty.as_slice(), empty.as_slice()),
            };
            let guide = live::Guidance { build, skill_max, skill_order };
            let st = live::overlay_state(&data, &cfg.timers, &guide, &items);
            sh.overlay = Some(st.clone());
            let enemies: Vec<EnemySeen> = live::enemies(&data)
                .into_iter()
                .filter_map(|e| {
                    let c = sh.statics.as_ref()?.champions.iter().find(|c| c.name == e.champion_name && !c.classic)?;
                    Some(EnemySeen { champion_id: c.id, items: e.items, kills: e.kills, deaths: e.deaths, assists: e.assists })
                })
                .collect();
            (st, enemies, items)
        };
        let (mut state, enemies, items) = state;
        let owned = live::my_items(&data, &items);
        if let Some(sit) = self.update_situational(enemies, owned, true).await {
            if cfg.show_situational {
                state.situational = live::price_situational(&data, sit.items, &items);
                self.state().shared.lock().await.overlay = Some(state.clone());
            }
        }
        if let Some((champ, pos, mode)) = fetch_rec {
            self.last_rec_key = Some((champ, pos.clone()));
            let app = self.app.clone();
            tauri::async_runtime::spawn(async move {
                ensure_rec(&app, champ, &pos, Some(&mode)).await;
            });
        }
        let _ = self.app.emit("overlay", Some(state));
        if cfg.overlay_enabled && !self.overlay_shown {
            self.overlay_shown = true;
            set_overlay_visible(&self.app, true);
        } else if !cfg.overlay_enabled && self.overlay_shown {
            self.hide_overlay().await;
        } else if self.overlay_shown {
            // Some games re-claim the topmost z-order while running (e.g. on
            // objective/kill banners); reassert it every tick so the overlay
            // doesn't silently drop behind the game in Borderless/Windowed.
            if let Some(w) = self.app.get_webview_window("overlay") {
                let _ = w.set_always_on_top(true);
            }
        }
    }

    /// Ranks OP.GG's 4th–6th item options against the enemy team and publishes
    /// the result when it changes. Needs a recommendation for your champion.
    async fn update_situational(&self, enemies: Vec<EnemySeen>, owned: Vec<i64>, live: bool) -> Option<SituationalState> {
        let state = self.state();
        // Damage types come from the client's champion files. Only what's already
        // known is used here; missing ones are fetched in the background, so a slow
        // or failing lookup never holds up the loop (the next tick picks them up).
        let mut damage = HashMap::new();
        let mut missing = Vec::new();
        for e in &enemies {
            match state.opgg.known_damage_type(e.champion_id).await {
                Some(d) => {
                    damage.insert(e.champion_id, d);
                }
                None if !missing.contains(&e.champion_id) => missing.push(e.champion_id),
                None => {}
            }
        }
        // One lookup at a time; failures aren't cached, so they're retried by a later one.
        if !missing.is_empty() && !self.damage_lookup.swap(true, Ordering::AcqRel) {
            let (app, running) = (self.app.clone(), self.damage_lookup.clone());
            tauri::async_runtime::spawn(async move {
                let state = app.state::<AppState>();
                let lcu = state.shared.lock().await.lcu.clone();
                for id in missing {
                    state.opgg.damage_type(id, lcu.as_ref()).await;
                }
                running.store(false, Ordering::Release);
            });
        }
        let mut sh = state.shared.lock().await;
        let champ = sh.my_champion_id;
        let rs = sh.rec.as_ref().filter(|r| r.champion_id == champ && champ != 0)?;
        // The pool from all games: the matchup build has too few for 4th–6th items.
        let base = rs.rec.as_ref()?;
        let effective = rs.effective()?;
        let core: Vec<i64> = effective.core.iter().chain(effective.boots.iter()).flat_map(|s| s.ids.clone()).collect();
        let statics = sh.statics.as_ref()?;
        let me = statics.champions.iter().find(|c| c.id == champ);
        let foes: Vec<situational::Enemy> = enemies
            .iter()
            .filter_map(|e| {
                let c = statics.champions.iter().find(|c| c.id == e.champion_id)?;
                Some(situational::Enemy {
                    name: c.name.clone(),
                    alias: c.alias.clone(),
                    roles: c.roles.clone(),
                    damage_type: damage.get(&e.champion_id).cloned().unwrap_or_default(),
                    items: e.items.clone(),
                    kills: e.kills,
                    deaths: e.deaths,
                    assists: e.assists,
                })
            })
            .collect();
        let previous: Vec<i64> = sh.situational.as_ref().map(|s| s.items.iter().map(|i| i.id).collect()).unwrap_or_default();
        let next = situational::suggest(&situational::Input {
            champion_id: champ,
            my_roles: me.map(|c| c.roles.as_slice()).unwrap_or(&[]),
            pool: &base.situational_pool,
            core: &core,
            owned: &owned,
            enemies: &foes,
            items: &statics.items,
            previous: &previous,
            live,
        });
        if sh.situational.as_ref() != Some(&next) {
            sh.situational = Some(next.clone());
            drop(sh);
            let _ = self.app.emit("situational", Some(next.clone()));
        }
        Some(next)
    }

    async fn hide_overlay(&mut self) {
        let preview = {
            let state = self.state();
            let mut sh = state.shared.lock().await;
            sh.overlay = None;
            sh.overlay_preview
        };
        let _ = self.app.emit("overlay", Option::<OverlayState>::None);
        if self.overlay_shown && !preview {
            set_overlay_visible(&self.app, false);
        }
        self.overlay_shown = false;
    }
}

/// Imports the rune page for a champion (used by the loop and the
/// "Import now" button).
/// Sets the player's picks for the current recommendation. In champ select on
/// that champion it imports them straight away (runes, spells, shop build);
/// otherwise they're kept for the overlay and later imports.
pub async fn choose(app: &AppHandle, choice: RecChoice) -> Result<String, String> {
    let state = app.state::<AppState>();
    let (rs, in_champ_select) = {
        let mut sh = state.shared.lock().await;
        let in_cs = sh.champ_select.as_ref().map(|cs| cs.my_champion_id);
        let rs = sh.rec.as_mut().filter(|r| r.rec.is_some()).ok_or("There's no recommendation to pick from yet")?;
        rs.choice = choice;
        let rs = rs.clone();
        (rs.clone(), in_cs == Some(rs.champion_id))
    };
    let _ = app.emit("recommendation", Some(rs.for_ui()));
    if in_champ_select {
        // The recommendation's own position, so `ensure_rec` reuses it (and the picks).
        import_for(app, rs.champion_id, &rs.position).await
    } else {
        Ok("Saved. It's used for the overlay and the next import.".into())
    }
}

pub async fn import_for(app: &AppHandle, champion_id: i64, position: &str) -> Result<String, String> {
    // One at a time, so quick hover changes (or the button) apply in order
    // instead of racing over the same rune page and item set.
    static IMPORTING: Mutex<()> = Mutex::const_new(());
    let _importing = IMPORTING.lock().await;
    let state = app.state::<AppState>();
    let cfg = state.config();
    let (lcu, map_id, name) = {
        let sh = state.shared.lock().await;
        let name = sh.champion(champion_id).map_or_else(|| format!("Champion {champion_id}"), |c| c.name.clone());
        (sh.lcu.clone(), sh.map(), name)
    };
    let lcu = lcu.ok_or("Not connected to the League client")?;
    let rec = ensure_rec(app, champion_id, position, None).await;
    let rune_rec = rec.as_ref().and_then(|r| r.runes.as_ref());
    let result = runes::import(&lcu, &cfg, champion_id, &name, position, map_id, rune_rec)
        .await
        .map(|r| format!("Set \"{}\" ({})", r.page_name, r.source))
        .map_err(msg)?;
    let spells = match rec.as_ref().filter(|r| cfg.set_summoner_spells && r.games >= opgg::MIN_GAMES) {
        Some(r) if r.spells.len() == 2 => match set_spells(app, &lcu, &r.spells).await {
            Ok(names) => format!(" · {names}"),
            Err(e) => format!(" · couldn't set spells: {e:#}"),
        },
        _ => String::new(),
    };
    let items = match rec.as_ref().filter(|r| cfg.set_item_sets && r.games >= opgg::MIN_GAMES) {
        Some(r) => match itemsets::apply(&lcu, r, &name, runes::position_label(position), map_id).await {
            Ok(Some(_)) => " · build added to the shop".to_string(),
            Ok(None) => String::new(),
            Err(e) => format!(" · couldn't add the build to the shop: {e:#}"),
        },
        None => String::new(),
    };
    Ok(format!("{result}{spells}{items}"))
}

pub(crate) async fn publish_import(app: &AppHandle, champion_id: i64, result: Result<String, String>) -> ImportEvent {
    let ev = match result {
        Ok(m) => ImportEvent { ok: true, champion_id, message: m },
        Err(m) => ImportEvent { ok: false, champion_id, message: m },
    };
    app.state::<AppState>().shared.lock().await.last_import = Some(ev.clone());
    let _ = app.emit("rune-import", ev.clone());
    ev
}

const PLAYER_SLOTS: &str = "/lol-lobby/v1/lobby/members/localMember/player-slots";

/// (champion, position) per Swiftplay lobby slot, e.g. (267, "utility").
fn slot_keys(slots: &Value) -> Vec<(i64, String)> {
    slots
        .as_array()
        .map(|a| a.iter().map(|s| (int(s, "championId"), text(s, "positionPreference").to_ascii_lowercase())).collect())
        .unwrap_or_default()
}

/// Sets runes (and spells, if that's on) in the given Swiftplay lobby slots.
/// Swiftplay is on Summoner's Rift, so OP.GG's ranked stats apply.
pub async fn import_slots(app: &AppHandle, lcu: &Lcu, wanted: Vec<(usize, i64, String)>) -> Vec<ImportEvent> {
    static IMPORTING: Mutex<()> = Mutex::const_new(());
    let _importing = IMPORTING.lock().await;
    let state = app.state::<AppState>();
    let cfg = state.config();
    let mut events = Vec::new();
    let mut picks = Vec::new();
    for (slot, champ, pos) in wanted {
        let alias = state.shared.lock().await.opgg_alias(champ);
        let rec = match alias.filter(|_| cfg.rec_source == "opgg") {
            Some(alias) => state.opgg.recommend(champ, &alias, &pos, "ranked", Some(lcu)).await.ok(),
            None => None,
        };
        match runes::choose_page(lcu, champ, &pos, 11, rec.as_ref().and_then(|r| r.runes.as_ref())).await {
            Ok((mut page, source)) => {
                let name = state.shared.lock().await.champion(champ).map(|c| c.name.clone()).unwrap_or_default();
                page.name = runes::page_name(&name, runes::position_label(&pos));
                picks.push((slot, champ, pos, page, source, rec))
            }
            Err(e) => events.push(publish_import(app, champ, Err(format!("{e:#}"))).await),
        }
    }
    if picks.is_empty() {
        return events;
    }
    // Read again: the slots may have changed during the OP.GG lookups, and the
    // PUT replaces all of them.
    let Ok(Some(mut slots)) = lcu.get(PLAYER_SLOTS).await else { return events };
    let before = slots.clone();
    let mut done = Vec::new();
    let mut pages = HashMap::new();
    for (slot, champ, pos, page, source, rec) in picks {
        let Some(s) = slots.get_mut(slot) else { continue };
        if (int(s, "championId"), text(s, "positionPreference").to_ascii_lowercase()) != (champ, pos.clone()) {
            continue; // changed meanwhile; the next tick picks it up
        }
        let perks = runes::slot_perks(&page);
        s["perks"] = Value::String(perks.clone());
        let mut msg = format!("Swiftplay {} runes ({source})", runes::position_label(&pos));
        let spells = rec.as_ref().filter(|r| cfg.set_summoner_spells && r.games >= opgg::MIN_GAMES && r.spells.len() == 2);
        if let Some(r) = spells {
            let (s1, s2) = arrange_spells(&r.spells, (int(s, "spell1"), int(s, "spell2")));
            s["spell1"] = s1.into();
            s["spell2"] = s2.into();
            msg.push_str(&format!(" · {}", state.shared.lock().await.spell_names(s1, s2)));
        }
        pages.insert(slot, page);
        done.push((slot, champ, pos, perks, msg, rec));
    }
    if done.is_empty() {
        return events;
    }
    // The PUT sets the spells (and the slot's copy of the runes). The client
    // refuses a PUT that changes nothing ("Put slots request matches current
    // slots"), e.g. on a second "Import runes" click, so skip it then.
    if slots != before {
        if let Err(e) = lcu.put(PLAYER_SLOTS, &slots).await.map_err(|e| format!("{e:#}")) {
            if !e.contains("matches current slots") {
                for (_, champ, ..) in done {
                    let err = format!("couldn't update the Swiftplay slots: {e}");
                    events.push(publish_import(app, champ, Err(err)).await);
                }
                return events;
            }
        }
    }
    // The runes themselves live on the slot's temporary rune page, which the
    // perks plugin puts back over the slot's `perks`; so replace that page.
    let mut failed: HashMap<usize, String> = HashMap::new();
    let mut first_page = None;
    for (slot, champ, ..) in &done {
        match runes::set_quick_play_page(lcu, *champ, &pages[slot]).await {
            Ok(id) => first_page = first_page.or(Some(id)),
            Err(e) => {
                failed.insert(*slot, format!("{e:#}"));
            }
        }
    }
    // Switch to the imported page, so the rune menu opens on it. Only one page
    // can be current, so the first slot's (your primary position) wins.
    if let Some(id) = first_page {
        let _ = lcu.put("/lol-perks/v1/currentpage", &Value::from(id)).await;
    }
    let items = if cfg.set_item_sets { slot_item_sets(app, lcu, &done).await } else { String::new() };
    // Check that the client kept them.
    tokio::time::sleep(Duration::from_millis(500)).await;
    let mut wrote_page = false;
    for (slot, champ, pos, perks, msg, _) in done {
        let path = format!("/lol-perks/v1/quick-play-selections/champion/{champ}/position/{pos}");
        let kept = lcu.get(&path).await.ok().flatten().is_some_and(|v| same_perks(v.as_str().unwrap_or(""), &perks));
        let r = if kept {
            Ok(format!("{msg}{items}"))
        } else if !wrote_page {
            // Fall back to the League Bro page, which the lobby's rune menu lists.
            wrote_page = true;
            let page = &pages[&slot];
            match runes::write_page(lcu, &cfg, page).await {
                Ok(()) => Ok(format!("{msg} · saved as \"{}\", pick it in the slot's rune menu{items}", page.name)),
                Err(e) => Err(format!("couldn't set Swiftplay runes: {e:#}")),
            }
        } else {
            let e = failed.remove(&slot).unwrap_or_else(|| "the League client kept its own runes".to_string());
            Err(format!("couldn't set Swiftplay runes: {e}"))
        };
        events.push(publish_import(app, champ, r).await);
    }
    events
}

/// Writes the shop builds for the imported Swiftplay slots (one set per
/// champion) and returns the note for the import message.
async fn slot_item_sets(
    app: &AppHandle,
    lcu: &Lcu,
    done: &[(usize, i64, String, String, String, Option<Recommendation>)],
) -> String {
    let names: Vec<String> = {
        let state = app.state::<AppState>();
        let sh = state.shared.lock().await;
        done.iter().map(|(_, champ, ..)| sh.champion(*champ).map(|c| c.name.clone()).unwrap_or_default()).collect()
    };
    let recs: Vec<(&Recommendation, &str, &str)> = done
        .iter()
        .zip(&names)
        .filter_map(|((_, _, pos, _, _, rec), name)| {
            Some((rec.as_ref().filter(|r| r.games >= opgg::MIN_GAMES)?, name.as_str(), runes::position_label(pos)))
        })
        .collect();
    if recs.is_empty() {
        return String::new();
    }
    match itemsets::apply_many(lcu, &recs, 11).await {
        Ok(t) if !t.is_empty() => " · build added to the shop".to_string(),
        Ok(_) => String::new(),
        Err(e) => format!(" · couldn't add the build to the shop: {e:#}"),
    }
}

/// Whether two slot `perks` strings are the same runes (key order and spacing aside).
fn same_perks(a: &str, b: &str) -> bool {
    match (serde_json::from_str::<Value>(a), serde_json::from_str::<Value>(b)) {
        (Ok(a), Ok(b)) => !["perkIds", "perkStyle", "perkSubStyle"].iter().any(|k| a.get(k) != b.get(k)),
        _ => false,
    }
}

/// The Swiftplay "Import runes" button: imports every slot with a champion.
pub async fn import_swiftplay_now(app: &AppHandle) -> Result<Vec<ImportEvent>, String> {
    let lcu = app.state::<AppState>().shared.lock().await.lcu.clone().ok_or("Not connected to the League client")?;
    let slots = lcu.get(PLAYER_SLOTS).await.map_err(msg)?.unwrap_or(Value::Null);
    let wanted: Vec<_> = slot_keys(&slots)
        .into_iter()
        .enumerate()
        .filter(|(_, k)| k.0 != 0)
        .map(|(i, (c, p))| (i, c, p))
        .collect();
    if wanted.is_empty() {
        return Err("Pick a champion for your Swiftplay positions first".into());
    }
    Ok(import_slots(app, &lcu, wanted).await)
}

/// Puts each recommended spell where you already have it (so Flash stays on
/// your usual key), filling the remaining slot with the other one.
pub fn arrange_spells(rec: &[i64], current: (i64, i64)) -> (i64, i64) {
    let (a, b) = (rec[0], rec[1]);
    if current.0 == b || current.1 == a {
        (b, a)
    } else {
        (a, b)
    }
}

async fn set_spells(app: &AppHandle, lcu: &Lcu, rec: &[i64]) -> anyhow::Result<String> {
    let session = lcu.get_req("/lol-champ-select/v1/session").await?;
    let me_cell = int(&session, "localPlayerCellId");
    let me = list(&session, "myTeam").iter().find(|p| int(p, "cellId") == me_cell).unwrap_or(&Value::Null);
    let current = (int(me, "spell1Id"), int(me, "spell2Id"));
    let (s1, s2) = arrange_spells(rec, current);
    if (s1, s2) != current {
        lcu.patch("/lol-champ-select/v1/session/my-selection", &serde_json::json!({"spell1Id": s1, "spell2Id": s2}))
            .await?;
    }
    Ok(app.state::<AppState>().shared.lock().await.spell_names(s1, s2))
}

/// Fetches (or reuses) the OP.GG recommendation for a champion and publishes
/// it to the UI. `live_mode` is the in-game gameMode when called mid-game.
pub async fn ensure_rec(app: &AppHandle, champion_id: i64, position: &str, live_mode: Option<&str>) -> Option<Recommendation> {
    let state = app.state::<AppState>();
    if state.config().rec_source != "opgg" || champion_id == 0 {
        return None;
    }
    let (alias, game_mode, lcu) = {
        let sh = state.shared.lock().await;
        if let Some(r) = sh.rec.as_ref() {
            if r.champion_id == champion_id && r.position == position && r.rec.is_some() {
                return r.effective();
            }
        }
        let mode = match live_mode {
            Some(m) => mode_from_live(m),
            None => opgg::game_mode_for(sh.queue_id, sh.map()),
        };
        (sh.opgg_alias(champion_id), mode, sh.lcu.clone())
    };
    let (Some(alias), Some(game_mode)) = (alias, game_mode) else { return None };
    let publish = |mut rs: RecState| async move {
        let state = app.state::<AppState>();
        let mut sh = state.shared.lock().await;
        // A slower lookup for a champion you've since swapped off of
        // shouldn't replace the current one.
        if sh.my_champion_id != 0 && sh.my_champion_id != rs.champion_id {
            return;
        }
        // The matchup is loaded on its own (matchup.rs); keep it.
        if let Some(old) = sh.rec.as_ref().filter(|r| r.champion_id == rs.champion_id && r.position == rs.position) {
            rs.matchup = old.matchup.clone();
        }
        sh.rec = Some(rs.clone());
        drop(sh);
        let _ = app.emit("recommendation", Some(rs.for_ui()));
    };
    let base = RecState { champion_id, position: position.to_string(), ..Default::default() };
    publish(RecState { loading: true, ..base.clone() }).await;
    match state.opgg.recommend(champion_id, &alias, position, game_mode, lcu.as_ref()).await {
        Ok(rec) => {
            publish(RecState { rec: Some(rec.clone()), ..base }).await;
            Some(rec)
        }
        Err(e) => {
            publish(RecState { error: Some(format!("{e:#}")), ..base }).await;
            None
        }
    }
}

type MatchupKey = (i64, String, Vec<i64>, Option<i64>);

/// What the lane matchup depends on, or None before you've locked in: each
/// lookup costs OP.GG's slow guide call and a match history read, so hovering
/// through champions doesn't start one.
fn matchup_key(view: &ChampSelectView, opponent_pick: Option<i64>) -> Option<MatchupKey> {
    let enemies = view.enemies.iter().map(|e| e.champion_id).collect();
    (view.locked && view.my_champion_id != 0).then(|| (view.my_champion_id, view.my_position.clone(), enemies, opponent_pick))
}

/// OP.GG game mode from the live game's gameMode.
fn mode_from_live(mode: &str) -> Option<&'static str> {
    match mode {
        "CLASSIC" | "SWIFTPLAY" => Some("ranked"),
        "ARAM" => Some("aram"),
        "URF" | "ARURF" => Some("urf"),
        "NEXUSBLITZ" => Some("nexus_blitz"),
        _ => None, // Arena (CHERRY), Tutorial, etc.
    }
}

pub async fn snapshot(app: &AppHandle) -> Snapshot {
    let state = app.state::<AppState>();
    let sh = state.shared.lock().await;
    Snapshot {
        status: sh.status.clone(),
        champ_select: sh.champ_select.clone(),
        loading: sh.loading.clone(),
        profiles: sh.profiles.values().cloned().collect(),
        last_import: sh.last_import.clone(),
        overlay: sh.overlay.clone(),
        rec: sh.rec.as_ref().map(RecState::for_ui),
        post_game: sh.post_game.clone(),
        swiftplay: sh.swiftplay.clone(),
        situational: sh.situational.clone(),
    }
}

pub async fn run(app: AppHandle) {
    let mut engine = Engine {
        app: app.clone(),
        lcu: None,
        my_puuid: String::new(),
        phase: String::new(),
        last_connect_try: None,
        last_import_key: None,
        last_rec_key: None,
        last_matchup_key: None,
        last_slot_keys: Vec::new(),
        requested: HashSet::new(),
        loading_game_id: None,
        overlay_shown: false,
        pending_post_game: None,
        last_window_check: None,
        last_web_statics: None,
        live_http: lcu::localhost_http_client(),
        damage_lookup: Arc::new(AtomicBool::new(false)),
    };
    engine.set_status(false, "", None, "Waiting for the League client").await;
    loop {
        engine.tick().await;
        // Profiles are only cached for the current session of the app; clear
        // the request list between games so ranks refresh.
        if engine.phase == "EndOfGame" || engine.phase == "Lobby" {
            engine.requested.clear();
            app.state::<AppState>().shared.lock().await.profiles.clear();
        }
        tokio::time::sleep(Duration::from_millis(1000)).await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn matchup_waits_for_lock_in() {
        let enemy = |id| CsPlayer { champion_id: id, ..Default::default() };
        let mut view = ChampSelectView { my_champion_id: 103, my_position: "middle".into(), enemies: vec![enemy(238), enemy(0)], ..Default::default() };
        // Hovering Ahri: no lookup.
        assert_eq!(matchup_key(&view, None), None);
        view.locked = true;
        let key = matchup_key(&view, None);
        assert_eq!(key, Some((103, "middle".to_string(), vec![238, 0], None)));
        // After lock-in it follows the enemy picks and the player's opponent pick.
        view.enemies[1].champion_id = 64;
        assert_ne!(matchup_key(&view, None), key);
        assert_ne!(matchup_key(&view, Some(64)), matchup_key(&view, None));
        assert_eq!(matchup_key(&ChampSelectView { locked: true, ..Default::default() }, None), None);
    }

    #[test]
    fn swiftplay_perks_helpers() {
        let a = r#"{"perkIds":[8214,8226],"perkStyle":8200,"perkSubStyle":8400}"#;
        assert!(same_perks(a, r#"{"perkSubStyle":8400, "perkStyle":8200, "perkIds":[8214,8226]}"#));
        assert!(!same_perks(a, r#"{"perkIds":[8112,8226],"perkStyle":8200,"perkSubStyle":8400}"#));
        assert!(!same_perks(a, ""));
    }

    #[test]
    fn swiftplay_slot_keys() {
        let slots = json!([
            {"championId": 267, "positionPreference": "UTILITY", "perks": "{}", "spell1": 4, "spell2": 14},
            {"championId": 0, "positionPreference": "JUNGLE", "perks": "", "spell1": 4, "spell2": 11}
        ]);
        assert_eq!(slot_keys(&slots), vec![(267, "utility".to_string()), (0, "jungle".to_string())]);
        assert!(slot_keys(&json!([])).is_empty());
    }

    #[test]
    fn champ_select_hides_names_and_detects_lock() {
        let s = json!({
            "localPlayerCellId": 1,
            "queueId": 420,
            "myTeam": [
                {"cellId": 0, "championId": 0, "championPickIntent": 64, "assignedPosition": "jungle",
                 "puuid": "", "nameVisibilityType": "HIDDEN", "gameName": "", "tagLine": ""},
                {"cellId": 1, "championId": 103, "assignedPosition": "middle",
                 "puuid": "me-puuid", "nameVisibilityType": "VISIBLE", "gameName": "Dom", "tagLine": "NA1"},
                {"cellId": 2, "championId": 0, "assignedPosition": "bottom",
                 "puuid": "duo-puuid", "nameVisibilityType": "VISIBLE", "gameName": "Duo", "tagLine": "NA1"}
            ],
            "theirTeam": [{"cellId": 5, "championId": 238, "puuid": "x", "gameName": "Enemy"}],
            "actions": [[{"actorCellId": 1, "type": "pick", "completed": true, "championId": 103}]],
            "bans": {"myTeamBans": [0, 157], "theirTeamBans": [555]},
            "timer": {"phase": "BAN_PICK"}
        });
        let v = parse_champ_select(&s);
        assert_eq!(v.my_champion_id, 103);
        assert_eq!(v.my_position, "middle");
        assert!(v.locked);
        assert!(!v.allies[0].visible && v.allies[0].name.is_none());
        assert_eq!(v.allies[2].name.as_deref(), Some("Duo#NA1"));
        assert_eq!(v.enemies[0].champion_id, 238);
        assert!(v.enemies[0].name.is_none() && v.enemies[0].puuid.is_none());
        assert_eq!(v.bans, vec![157, 555]);
    }

    #[test]
    fn window_modes() {
        // game.cfg's [General] WindowMode, same numbers as the client's game settings.
        assert_eq!(window_mode_label(0), Some("fullscreen"));
        assert_eq!(window_mode_label(1), Some("windowed"));
        assert_eq!(window_mode_label(2), Some("borderless"));
        assert_eq!(window_mode_label(7), None);
    }

    #[test]
    fn league_classic_champions() {
        // Real entries from champion-summary.json (October 2026).
        assert!(is_league_classic(60103, "Jade_Ahri"));
        assert!(is_league_classic(60001, "Jade_Annie"));
        assert!(!is_league_classic(103, "Ahri"));
        assert!(!is_league_classic(950, "Naafiri"));
    }

    #[test]
    fn spells_keep_flash_on_your_key() {
        // OP.GG says Flash + Ignite; you keep Flash on F (slot 2).
        assert_eq!(arrange_spells(&[4, 14], (12, 4)), (14, 4));
        // You keep Flash on D.
        assert_eq!(arrange_spells(&[4, 14], (4, 7)), (4, 14));
        // Neither spell set yet: OP.GG's order.
        assert_eq!(arrange_spells(&[4, 14], (6, 7)), (4, 14));
        // Smite already on D.
        assert_eq!(arrange_spells(&[4, 11], (11, 4)), (11, 4));
    }

    #[test]
    fn loading_splits_teams() {
        let s = json!({"gameData": {"gameId": 99, "queue": {"description": "Ranked Solo/Duo"},
            "teamOne": [{"puuid": "a", "championId": 1, "gameName": "A", "tagLine": "1"}],
            "teamTwo": [{"puuid": "me", "championId": 103, "summonerName": "Dom", "selectedPosition": "MIDDLE"},
                        {"puuid": "", "championId": 64}]}});
        let v = parse_loading(&s, "me").unwrap();
        assert_eq!(v.game_id, 99);
        assert_eq!(v.allies.len(), 2);
        assert!(v.allies[0].is_me);
        assert!(v.allies[1].puuid.is_none());
        assert_eq!(v.enemies[0].name.as_deref(), Some("A#1"));
    }

    #[test]
    fn tooltips_become_plain_text() {
        let (stats, desc, effects) = item_tooltip(
            "<mainText><stats><attention> 100</attention> Ability Power<br><attention> 600</attention> Mana</stats><br><br>\
             <passive>Echo</passive><br>Damaging Abilities deal <magicDamage>bonus magic damage</magicDamage>.<br>\
             <active>Burst</active><br>Deal damage.</mainText>",
        );
        assert_eq!(stats, vec!["100 Ability Power", "600 Mana"]);
        assert_eq!(desc, "Echo\nDamaging Abilities deal bonus magic damage.\nBurst\nDeal damage.");
        let effect = |kind: &str, name: &str, text: &str| ItemEffect { kind: kind.into(), name: name.into(), text: text.into() };
        assert_eq!(
            effects,
            vec![effect("passive", "Echo", "Damaging Abilities deal bonus magic damage."), effect("active", "Burst", "Deal damage.")]
        );
        let (_, _, plain) = item_tooltip("<mainText><stats>10 Armor</stats><br>Just some text.</mainText>");
        assert_eq!(plain, vec![effect("", "", "Just some text.")]);
        assert_eq!(
            plain_text("Deals <font color='#48C4B7'>@TotalDamage@</font> bonus <b>adaptive</b> damage @ 3s."),
            "Deals bonus adaptive damage @ 3s."
        );
    }
}
