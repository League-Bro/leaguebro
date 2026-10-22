mod config;
mod cache;
mod engine;
mod itemsets;
mod lcu;
mod opgg;
mod live;
mod patch;
mod postgame;
mod runes;
mod scout;
mod tierlist;

use config::{Config, RunePage};
use engine::{AppState, Shared, Snapshot, StaticData};
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::sync::Mutex;

#[tauri::command]
async fn get_snapshot(app: AppHandle) -> Snapshot {
    engine::snapshot(&app).await
}

#[tauri::command]
async fn get_static(state: State<'_, AppState>) -> Result<Option<StaticData>, String> {
    Ok(state.shared.lock().await.statics.clone())
}

#[tauri::command]
fn get_config(state: State<'_, AppState>) -> Config {
    state.config()
}

#[tauri::command]
fn save_config(app: AppHandle, state: State<'_, AppState>, config: Config) -> Result<(), String> {
    config.save(&state.config_path).map_err(|e| format!("Couldn't save settings: {e:#}"))?;
    *state.config.write().unwrap() = config.clone();
    let _ = app.emit("config", config);
    Ok(())
}

#[tauri::command]
async fn import_runes_now(app: AppHandle) -> Result<String, String> {
    let (champion, position) = {
        let state = app.state::<AppState>();
        let sh = state.shared.lock().await;
        let cs = sh.champ_select.as_ref().ok_or("You're not in champ select")?;
        (cs.my_champion_id, cs.my_position.clone())
    };
    if champion == 0 {
        return Err("Hover or lock a champion first".into());
    }
    engine::import_for(&app, champion, &position).await
}

/// OP.GG's recommendation for any champion, role and mode (the Champions tab).
/// Unlike champ select's lookup this doesn't change the current recommendation.
#[tauri::command]
async fn lookup_rec(
    state: State<'_, AppState>,
    champion_id: i64,
    position: String,
    game_mode: String,
) -> Result<opgg::Recommendation, String> {
    if !matches!(game_mode.as_str(), "ranked" | "aram") {
        return Err(format!("Unknown game mode {game_mode}"));
    }
    let alias = {
        let sh = state.shared.lock().await;
        let statics = sh.statics.as_ref().ok_or("Open the League client to load champions")?;
        let champ = statics.champions.iter().find(|c| c.id == champion_id).ok_or("Unknown champion")?;
        if champ.classic {
            return Err("OP.GG has no League Classic stats".into());
        }
        champ.alias.clone()
    };
    state.opgg.recommend(champion_id, &alias, &position, &game_mode).await.map_err(|e| format!("{e:#}"))
}

/// Saves the rune page currently selected in the client as your own page for
/// this champion; it is used instead of the client recommendation from then on.
#[tauri::command]
async fn save_current_page_for(
    app: AppHandle,
    state: State<'_, AppState>,
    champion_id: i64,
) -> Result<RunePage, String> {
    let lcu = state.shared.lock().await.lcu.clone().ok_or("Not connected to the League client")?;
    let page = runes::current_page(&lcu).await.map_err(|e| format!("{e:#}"))?;
    let mut cfg = state.config();
    cfg.rune_overrides.insert(champion_id.to_string(), page.clone());
    save_config(app, state, cfg)?;
    Ok(page)
}

/// Unlocks the overlay so it accepts mouse input and can be dragged to a new
/// spot; locking it again saves the position and makes it click-through.
#[tauri::command]
async fn set_overlay_locked(app: AppHandle, state: State<'_, AppState>, locked: bool) -> Result<(), String> {
    let Some(overlay) = app.get_webview_window("overlay") else { return Ok(()) };
    if locked {
        if let Ok(pos) = overlay.outer_position() {
            let mut cfg = state.config();
            cfg.overlay_x = Some(pos.x);
            cfg.overlay_y = Some(pos.y);
            save_config(app.clone(), state, cfg)?;
        }
    }
    engine::set_overlay_locked(&app, locked);
    Ok(())
}

/// Recent patch notes articles on leagueoflegends.com, newest first.
#[tauri::command]
async fn list_patches(state: State<'_, AppState>) -> Result<Vec<patch::PatchInfo>, String> {
    state.patches.list().await.map_err(|e| format!("{e:#}"))
}

/// One patch's changes, sorted into buffs, nerfs and adjustments.
#[tauri::command]
async fn get_patch(state: State<'_, AppState>, url: String) -> Result<patch::PatchNotes, String> {
    state.patches.notes(&url).await.map_err(|e| format!("{e:#}"))
}

/// One lane's tier list from Lolalytics or OP.GG (the Tier List tab).
/// `rank` is a Lolalytics filter like "emerald_plus"; OP.GG ignores it.
#[tauri::command]
async fn get_tier_list(
    state: State<'_, AppState>,
    source: tierlist::Source,
    position: String,
    rank: String,
) -> Result<tierlist::TierList, String> {
    let champions = state.shared.lock().await.statics.as_ref().map(|s| {
        s.champions.iter().filter(|c| !c.classic).map(|c| (c.id, c.name.clone())).collect()
    });
    state.tiers.get(&state.opgg, source, &position, &rank, champions).await.map_err(|e| format!("{e:#}"))
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct CacheInfo {
    patch_notes: cache::CacheUsage,
    runes: cache::CacheUsage,
}

/// The caches Settings can clear; matches `CacheName` in models.ts.
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
enum CacheName {
    PatchNotes,
    /// OP.GG recommendations.
    Runes,
}

async fn cache_usage(state: &AppState) -> CacheInfo {
    CacheInfo { patch_notes: state.patches.usage().await, runes: state.opgg.usage().await }
}

/// What's saved in each cache, for the Settings page. Async so the folder
/// scan runs off the main thread (Tauri runs plain commands on it).
#[tauri::command]
async fn cache_info(state: State<'_, AppState>) -> Result<CacheInfo, String> {
    Ok(cache_usage(&state).await)
}

/// Deletes one cache and returns what's left in both.
#[tauri::command]
async fn clear_cache(state: State<'_, AppState>, which: CacheName) -> Result<CacheInfo, String> {
    match which {
        CacheName::PatchNotes => state.patches.clear().await,
        CacheName::Runes => state.opgg.clear().await,
    }
    .map_err(|e| format!("{e:#}"))?;
    Ok(cache_usage(&state).await)
}

/// The overlay reports where its lock button is so it stays clickable while
/// the rest of the overlay is click-through.
#[tauri::command]
fn set_overlay_button(state: State<'_, AppState>, rect: Option<[f64; 4]>) {
    state.overlay_input.lock().unwrap().button = rect;
}

/// Shows the overlay outside a game so you can check its position.
#[tauri::command]
async fn preview_overlay(app: AppHandle, show: bool) -> Result<(), String> {
    let state = app.state::<AppState>();
    let in_game = {
        let mut sh = state.shared.lock().await;
        sh.overlay_preview = show;
        sh.overlay.is_some()
    };
    if show {
        engine::set_overlay_visible(&app, true);
        let _ = app.emit("overlay-preview", true);
    } else {
        let _ = app.emit("overlay-preview", false);
        if !in_game {
            engine::set_overlay_visible(&app, false);
        }
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            let config_path = app.path().app_config_dir()?.join("settings.json");
            let config = Config::load(&config_path);
            app.manage(AppState {
                config: std::sync::RwLock::new(config),
                config_path,
                shared: Mutex::new(Shared::default()),
                opgg: opgg::OpGg::new(
                    env!("CARGO_PKG_VERSION"),
                    app.path().app_cache_dir().ok().map(|d| d.join("opgg")),
                ),
                patches: patch::PatchNotesClient::new(
                    env!("CARGO_PKG_VERSION"),
                    app.path().app_cache_dir().ok().map(|d| d.join("patch-notes")),
                ),
                tiers: tierlist::TierLists::new(env!("CARGO_PKG_VERSION")),
                overlay_input: std::sync::Mutex::new(engine::OverlayInput { passthrough: true, ..Default::default() }),
            });
            if let Some(overlay) = app.get_webview_window("overlay") {
                let _ = overlay.set_ignore_cursor_events(true);
            }
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(engine::run(handle.clone()));
            tauri::async_runtime::spawn(engine::watch_overlay_cursor(handle));
            Ok(())
        })
        .on_window_event(|window, event| {
            // Closing the main window quits the app (the overlay is hidden, not a real window to close).
            if window.label() == "main" {
                if let tauri::WindowEvent::CloseRequested { .. } = event {
                    window.app_handle().exit(0);
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            get_snapshot,
            get_static,
            get_config,
            save_config,
            import_runes_now,
            save_current_page_for,
            lookup_rec,
            preview_overlay,
            set_overlay_locked,
            list_patches,
            get_patch,
            get_tier_list,
            cache_info,
            clear_cache,
            set_overlay_button
        ])
        .run(tauri::generate_context!())
        .expect("error while running League Bro");
}
