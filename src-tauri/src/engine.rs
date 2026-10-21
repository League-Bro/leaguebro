//! The background loop: watches the League client, reacts to champ select
//! and loading, and feeds the overlay while a game is running.

use crate::config::Config;
use crate::lcu::{self, Lcu};
use crate::live::{self, OverlayState};
use crate::runes;
use crate::scout::{self, Profile};
use serde::Serialize;
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::RwLock;
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
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ItemInfo {
    pub id: i64,
    pub name: String,
    pub price_total: i64,
    pub icon_path: String,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct PerkInfo {
    pub id: i64,
    pub name: String,
    pub icon_path: String,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct StaticData {
    pub champions: Vec<ChampInfo>,
    pub items: Vec<ItemInfo>,
    pub perks: Vec<PerkInfo>,
    pub styles: Vec<PerkInfo>,
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
}

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

#[derive(Default)]
pub struct Shared {
    pub lcu: Option<Lcu>,
    pub status: Status,
    pub statics: Option<StaticData>,
    pub champ_select: Option<ChampSelectView>,
    pub loading: Option<LoadingView>,
    pub map_id: i64,
    pub my_champion_id: i64,
    pub profiles: HashMap<String, Profile>,
    pub last_import: Option<ImportEvent>,
    pub overlay: Option<OverlayState>,
    pub overlay_preview: bool,
}

pub struct AppState {
    pub config: RwLock<Config>,
    pub config_path: PathBuf,
    pub shared: Mutex<Shared>,
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
}

// ---------- parsing helpers ----------

fn i(v: &Value, k: &str) -> i64 {
    v.get(k).and_then(Value::as_i64).unwrap_or(0)
}
fn st<'a>(v: &'a Value, k: &str) -> &'a str {
    v.get(k).and_then(Value::as_str).unwrap_or("")
}

fn riot_name(v: &Value) -> Option<String> {
    let game = st(v, "gameName");
    let tag = st(v, "tagLine");
    if !game.is_empty() {
        return Some(if tag.is_empty() { game.to_string() } else { format!("{game}#{tag}") });
    }
    for k in ["riotIdGameName", "summonerName", "internalName"] {
        let n = st(v, k);
        if !n.is_empty() {
            return Some(n.to_string());
        }
    }
    None
}

pub fn parse_champ_select(session: &Value) -> ChampSelectView {
    let me_cell = i(session, "localPlayerCellId");
    let player = |p: &Value| {
        let hidden = st(p, "nameVisibilityType").eq_ignore_ascii_case("HIDDEN");
        let puuid = st(p, "puuid");
        let visible = !hidden && !puuid.is_empty();
        CsPlayer {
            cell_id: i(p, "cellId"),
            champion_id: i(p, "championId"),
            pick_intent: i(p, "championPickIntent"),
            position: st(p, "assignedPosition").to_string(),
            is_me: i(p, "cellId") == me_cell,
            visible,
            name: if visible { riot_name(p) } else { None },
            puuid: if visible { Some(puuid.to_string()) } else { None },
        }
    };
    let team = |k: &str| -> Vec<CsPlayer> {
        session.get(k).and_then(Value::as_array).map(|a| a.iter().map(player).collect()).unwrap_or_default()
    };
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
    let locked = session
        .get("actions")
        .and_then(Value::as_array)
        .map(|groups| {
            groups.iter().filter_map(Value::as_array).flatten().any(|a| {
                i(a, "actorCellId") == me_cell
                    && st(a, "type") == "pick"
                    && a.get("completed").and_then(Value::as_bool).unwrap_or(false)
            })
        })
        .unwrap_or(false)
        // Modes without pick actions (ARAM) assign the champion directly.
        || (me.champion_id != 0 && session.get("actions").and_then(Value::as_array).map_or(true, |a| a.is_empty()));

    let mut bans = Vec::new();
    if let Some(b) = session.get("bans") {
        for k in ["myTeamBans", "theirTeamBans"] {
            if let Some(a) = b.get(k).and_then(Value::as_array) {
                bans.extend(a.iter().filter_map(Value::as_i64).filter(|&x| x > 0));
            }
        }
    }
    ChampSelectView {
        queue_id: i(session, "queueId"),
        my_champion_id,
        my_position: me.position.clone(),
        locked,
        allies,
        enemies,
        bans,
        timer_phase: session.pointer("/timer/phase").and_then(Value::as_str).unwrap_or("").to_string(),
    }
}

pub fn parse_loading(session: &Value, my_puuid: &str) -> Option<LoadingView> {
    let gd = session.get("gameData")?;
    let team = |k: &str| -> Vec<LoadPlayer> {
        gd.get(k)
            .and_then(Value::as_array)
            .map(|a| {
                a.iter()
                    .map(|p| {
                        let puuid = st(p, "puuid");
                        LoadPlayer {
                            puuid: if puuid.is_empty() { None } else { Some(puuid.to_string()) },
                            name: riot_name(p),
                            champion_id: i(p, "championId"),
                            position: st(p, "selectedPosition").to_string(),
                            is_me: !my_puuid.is_empty() && puuid == my_puuid,
                        }
                    })
                    .collect()
            })
            .unwrap_or_default()
    };
    let one = team("teamOne");
    let two = team("teamTwo");
    if one.is_empty() && two.is_empty() {
        return None;
    }
    let (allies, enemies) = if two.iter().any(|p| p.is_me) { (two, one) } else { (one, two) };
    Some(LoadingView {
        game_id: i(gd, "gameId"),
        queue_name: gd.pointer("/queue/description").and_then(Value::as_str).unwrap_or("").to_string(),
        allies,
        enemies,
    })
}

async fn load_statics(lcu: &Lcu) -> anyhow::Result<StaticData> {
    let champs = lcu.get_req("/lol-game-data/assets/v1/champion-summary.json").await?;
    let items = lcu.get_req("/lol-game-data/assets/v1/items.json").await?;
    let perks = lcu.get("/lol-game-data/assets/v1/perks.json").await.ok().flatten().unwrap_or(Value::Null);
    let styles = lcu.get("/lol-game-data/assets/v1/perkstyles.json").await.ok().flatten().unwrap_or(Value::Null);
    let arr = |v: &Value| v.as_array().cloned().unwrap_or_default();
    let mut champions: Vec<ChampInfo> = arr(&champs)
        .iter()
        .filter(|c| i(c, "id") > 0)
        .map(|c| ChampInfo { id: i(c, "id"), name: st(c, "name").into(), alias: st(c, "alias").into() })
        .collect();
    champions.sort_by(|a, b| a.name.cmp(&b.name));
    let mut items: Vec<ItemInfo> = arr(&items)
        .iter()
        .filter(|it| {
            let id = i(it, "id");
            id > 0
                && id < 10000 // larger ids are mode-specific (Arena etc.)
                && i(it, "priceTotal") > 0
                && it.get("inStore").and_then(Value::as_bool).unwrap_or(true)
                && st(it, "requiredChampion").is_empty()
        })
        .map(|it| ItemInfo {
            id: i(it, "id"),
            name: st(it, "name").into(),
            price_total: i(it, "priceTotal"),
            icon_path: st(it, "iconPath").into(),
        })
        .collect();
    items.sort_by(|a, b| a.name.cmp(&b.name));
    let perk = |p: &Value| PerkInfo { id: i(p, "id"), name: st(p, "name").into(), icon_path: st(p, "iconPath").into() };
    Ok(StaticData {
        champions,
        items,
        perks: arr(&perks).iter().map(perk).collect(),
        styles: styles.get("styles").map(arr).unwrap_or_default().iter().map(perk).collect(),
    })
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
        if let Some(p) = pos {
            let _ = w.set_position(p);
        }
        let _ = w.set_ignore_cursor_events(true);
        let _ = w.set_always_on_top(true);
        let _ = w.show();
    } else {
        let _ = w.hide();
    }
}

// ---------- the loop ----------

struct Engine {
    app: AppHandle,
    lcu: Option<Lcu>,
    my_puuid: String,
    phase: String,
    last_connect_try: Option<Instant>,
    last_import_key: Option<(i64, String)>,
    requested: HashSet<String>,
    loading_game_id: Option<i64>,
    overlay_shown: bool,
    live_http: reqwest::Client,
}

impl Engine {
    fn state(&self) -> tauri::State<'_, AppState> {
        self.app.state::<AppState>()
    }

    async fn set_status(&self, connected: bool, phase: &str, summoner: Option<Summoner>, message: &str) {
        let status = Status { connected, phase: phase.into(), summoner, message: message.into() };
        self.state().shared.lock().await.status = status.clone();
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
        let summoner = Summoner { puuid: st(&me, "puuid").into(), name: riot_name(&me).unwrap_or_default() };
        self.my_puuid = summoner.puuid.clone();
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
        self.hide_overlay().await;
        self.set_status(false, "", None, "Waiting for the League client").await;
    }

    async fn tick(&mut self) {
        if self.lcu.is_none() {
            self.connect().await;
            if self.lcu.is_none() {
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
            "GameStart" | "InProgress" | "Reconnect" => {
                self.loading(&lcu).await;
                if phase != "GameStart" {
                    self.live().await;
                }
            }
            _ => {}
        }
    }

    async fn on_phase_change(&mut self, lcu: &Lcu, phase: &str) {
        let prev = std::mem::replace(&mut self.phase, phase.to_string());
        let summoner = self.state().shared.lock().await.status.summoner.clone();
        self.set_status(true, phase, summoner, "").await;
        if phase == "ChampSelect" {
            self.last_import_key = None;
            self.loading_game_id = None;
            {
                let state = self.state();
                let mut sh = state.shared.lock().await;
                sh.loading = None;
                sh.my_champion_id = 0;
            }
            let _ = self.app.emit("loading", Option::<LoadingView>::None);
            // Map id (11 = Summoner's Rift, 12 = ARAM) for the rune lookup.
            if let Ok(Some(s)) = lcu.get("/lol-gameflow/v1/session").await {
                let map_id = s.pointer("/map/id").and_then(Value::as_i64).unwrap_or(11);
                self.state().shared.lock().await.map_id = map_id;
            }
        }
        if prev == "ChampSelect" && phase != "ChampSelect" {
            let state = self.state();
            let mut sh = state.shared.lock().await;
            sh.champ_select = None;
            drop(sh);
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
        let should_import = cfg.auto_import_runes
            && view.my_champion_id != 0
            && (view.locked || cfg.import_on_hover);
        let key = (view.my_champion_id, view.my_position.clone());
        if should_import && self.last_import_key.as_ref() != Some(&key) {
            self.last_import_key = Some(key);
            let result = import_for(&self.app, view.my_champion_id, &view.my_position).await;
            self.publish_import(view.my_champion_id, result).await;
        }
    }

    async fn publish_import(&self, champion_id: i64, result: Result<String, String>) {
        let ev = match result {
            Ok(m) => ImportEvent { ok: true, champion_id, message: m },
            Err(m) => ImportEvent { ok: false, champion_id, message: m },
        };
        self.state().shared.lock().await.last_import = Some(ev.clone());
        let _ = self.app.emit("rune-import", ev);
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
        let state = {
            let state = self.state();
            let mut sh = state.shared.lock().await;
            let items: HashMap<i64, (String, i64)> = sh
                .statics
                .as_ref()
                .map(|s| s.items.iter().map(|it| (it.id, (it.name.clone(), it.price_total))).collect())
                .unwrap_or_default();
            // Fall back to matching the live champion name if champ select was missed.
            if sh.my_champion_id == 0 {
                let me = live::find_me(&data).and_then(|p| p.get("championName")).and_then(Value::as_str).unwrap_or("");
                if let Some(c) = sh.statics.as_ref().and_then(|s| s.champions.iter().find(|c| c.name == me)) {
                    sh.my_champion_id = c.id;
                }
            }
            let build = cfg.builds.get(&sh.my_champion_id.to_string());
            let st = live::overlay_state(&data, &cfg.timers, build, &items);
            sh.overlay = Some(st.clone());
            st
        };
        let _ = self.app.emit("overlay", Some(state));
        if cfg.overlay_enabled && !self.overlay_shown {
            self.overlay_shown = true;
            set_overlay_visible(&self.app, true);
        } else if !cfg.overlay_enabled && self.overlay_shown {
            self.hide_overlay().await;
        }
    }

    async fn hide_overlay(&mut self) {
        let preview = {
            let state = self.state();
            let mut sh = state.shared.lock().await;
            sh.overlay = None;
            sh.overlay_preview
        };
        if self.overlay_shown && !preview {
            set_overlay_visible(&self.app, false);
        }
        self.overlay_shown = false;
    }
}

/// Imports the rune page for a champion (used by the loop and the
/// "Import now" button).
pub async fn import_for(app: &AppHandle, champion_id: i64, position: &str) -> Result<String, String> {
    let state = app.state::<AppState>();
    let cfg = state.config();
    let (lcu, map_id, name) = {
        let sh = state.shared.lock().await;
        let name = sh
            .statics
            .as_ref()
            .and_then(|s| s.champions.iter().find(|c| c.id == champion_id))
            .map(|c| c.name.clone())
            .unwrap_or_else(|| format!("Champion {champion_id}"));
        (sh.lcu.clone(), if sh.map_id == 0 { 11 } else { sh.map_id }, name)
    };
    let lcu = lcu.ok_or("Not connected to the League client")?;
    runes::import(&lcu, &cfg, champion_id, &name, position, map_id)
        .await
        .map(|r| format!("Set \"{}\" ({})", r.page_name, r.source))
        .map_err(|e| format!("{e:#}"))
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
        requested: HashSet::new(),
        loading_game_id: None,
        overlay_shown: false,
        live_http: lcu::localhost_http_client(),
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
}
