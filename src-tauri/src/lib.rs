mod config;
mod util;
mod cache;
mod engine;
mod feedback;
mod guide;
mod itemsets;
mod lcu;
mod lp_history;
mod opgg;
mod opgg_profile;
mod live;
mod matchup;
mod situational;
mod patch;
mod picks;
mod postgame;
mod profile;
mod runes;
mod scout;
mod tierlist;
mod usage;

use crate::util::{msg, text};
use config::Config;
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

#[tauri::command]
async fn import_swiftplay_now(app: AppHandle) -> Result<Vec<engine::ImportEvent>, String> {
    engine::import_swiftplay_now(&app).await
}

/// Your rank, recent matches and insights (the Profile page): from the League
/// client while it's running, else from OP.GG by the Riot ID in settings.
/// OP.GG is never asked while the client is open, even before it connects.
#[tauri::command]
async fn get_my_profile(app: AppHandle, state: State<'_, AppState>) -> Result<profile::MyProfile, String> {
    let lcu = state.shared.lock().await.lcu.clone();
    if let Some(lcu) = lcu {
        let mut p = profile::load(&lcu).await.map_err(msg)?;
        remember_riot_id(&app, &state, &lcu, &p.name).await;
        state.lp.record(&mut p);
        return Ok(p);
    }
    client_closed().await?;
    let (riot_id, region) = riot_id(&state)?;
    load_web_statics(&app, &state).await;
    let mut p = opgg_profile::load(&state.opgg, &riot_id, &region).await.map_err(msg)?;
    state.lp.record(&mut p);
    Ok(p)
}

/// Has OP.GG fetch your latest games and rank (its "Update" button), then
/// loads the profile again. `updated_at` is the shown profile's `updatedAt`.
#[tauri::command]
async fn renew_profile(state: State<'_, AppState>, updated_at: Option<i64>) -> Result<profile::MyProfile, String> {
    if state.shared.lock().await.lcu.is_some() {
        return Err("The League client is open, so your profile comes from it".into());
    }
    client_closed().await?;
    let (riot_id, region) = riot_id(&state)?;
    let mut p = opgg_profile::renew(&state.opgg, &riot_id, &region, updated_at).await.map_err(msg)?;
    state.lp.record(&mut p);
    Ok(p)
}

/// Errs while the League client is open but not connected yet (starting up),
/// so the Profile page waits for it instead of asking OP.GG.
async fn client_closed() -> Result<(), String> {
    let running = tauri::async_runtime::spawn_blocking(lcu::client_running).await.unwrap_or(false);
    if running {
        return Err("Waiting for the League client to finish starting".into());
    }
    Ok(())
}

/// The Riot ID and OP.GG region from settings.
fn riot_id(state: &State<'_, AppState>) -> Result<(String, String), String> {
    let config = state.config();
    let id = config.riot_id.filter(|id| !id.trim().is_empty());
    id.map(|id| (id, config.region)).ok_or_else(|| "Open the League client, or enter your Riot ID, to see your profile".into())
}

/// Saves the client's Riot ID and region the first time the Profile page
/// loads with the client running, so it also works without the client later.
async fn remember_riot_id(app: &AppHandle, state: &State<'_, AppState>, lcu: &lcu::Lcu, name: &str) {
    if state.config().riot_id.is_some() || !name.contains('#') {
        return;
    }
    let locale = lcu.get("/riotclient/region-locale").await.ok().flatten().unwrap_or_default();
    let mut config = state.config();
    config.riot_id = Some(name.to_string());
    let region = text(&locale, "region");
    if !region.is_empty() {
        config.region = opgg_profile::region_from_client(region);
    }
    if config.save(&state.config_path).is_ok() {
        *state.config.write().unwrap() = config.clone();
        let _ = app.emit("config", config);
    }
}

/// Champion and item names from CommunityDragon while the client isn't
/// running (the client's own replace them when it connects).
async fn load_web_statics(app: &AppHandle, state: &State<'_, AppState>) {
    if state.shared.lock().await.statics.is_some() {
        return;
    }
    match engine::load_statics_web().await {
        Ok(s) => {
            let mut sh = state.shared.lock().await;
            if sh.statics.is_none() {
                sh.statics = Some(s.clone());
                drop(sh);
                let _ = app.emit("static", s);
            }
        }
        Err(e) => eprintln!("couldn't load game data from CommunityDragon: {e:#}"),
    }
}

/// The full scoreboard of one of your past games.
#[tauri::command]
async fn get_match(state: State<'_, AppState>, game_id: i64, queue_name: String) -> Result<postgame::PostGame, String> {
    let lcu = state.shared.lock().await.lcu.clone().ok_or("Open the League client to see this game")?;
    let me = lcu.summoner_ids().await.map_err(msg)?;
    let puuid = text(&me, "puuid");
    let (path, timeline_path) = (format!("/lol-match-history/v1/games/{game_id}"), postgame::timeline_path(game_id));
    let (game, timeline) = tokio::join!(lcu.get(&path), lcu.get(&timeline_path));
    let game = game.map_err(msg)?.ok_or("The League client doesn't have this game anymore")?;
    let mut summary = postgame::parse(&game, puuid, &queue_name).ok_or_else(|| "Couldn't read this game".to_string())?;
    // The gold graph is a bonus: the scoreboard still shows without a timeline.
    if let (Ok(Some(t)), Some(mine)) = (timeline, summary.teams.first().map(|t| t.team_id)) {
        summary.gold_lead = postgame::gold_lead(&game, &t, mine);
    }
    summary.lp_change = state.lp.history(puuid).change(summary.queue_id, util::int(&game, "gameCreation"));
    Ok(summary)
}

/// League's install folder: from the client, else the one set in Settings.
async fn league_install_dir(state: &State<'_, AppState>) -> Result<std::path::PathBuf, String> {
    let configured = state.config().install_dir;
    let lcu = state.shared.lock().await.lcu.clone();
    let found = match lcu {
        Some(lcu) => itemsets::install_dir(&lcu, configured.as_deref()).await,
        None => configured.filter(|d| !d.trim().is_empty()).map(Into::into),
    };
    found.ok_or_else(|| "Open the League client so League Bro can find League's folder".to_string())
}

/// Other apps' item sets that show in the shop for every champion (Settings).
#[tauri::command]
async fn global_item_sets(state: State<'_, AppState>) -> Result<itemsets::GlobalSets, String> {
    Ok(itemsets::scan_global(&league_install_dir(&state).await?))
}

#[tauri::command]
async fn move_global_item_sets(state: State<'_, AppState>) -> Result<itemsets::GlobalSets, String> {
    let dir = league_install_dir(&state).await?;
    itemsets::move_global_aside(&dir).map_err(msg)?;
    Ok(itemsets::scan_global(&dir))
}

#[tauri::command]
async fn restore_global_item_sets(state: State<'_, AppState>) -> Result<itemsets::GlobalSets, String> {
    let dir = league_install_dir(&state).await?;
    itemsets::restore_global(&dir).map_err(msg)?;
    Ok(itemsets::scan_global(&dir))
}

/// Picks a different rune page, spells or build for the current champion; in
/// champ select it's imported straight away.
#[tauri::command]
async fn choose_rec_option(app: AppHandle, choice: opgg::RecChoice) -> Result<String, String> {
    engine::choose(&app, choice).await
}

/// Picks a rune page, spells or build for a Swiftplay lobby champion and
/// imports it into that slot.
#[tauri::command]
async fn choose_swiftplay_option(
    app: AppHandle,
    champion_id: i64,
    position: String,
    choice: opgg::RecChoice,
) -> Result<Vec<engine::ImportEvent>, String> {
    engine::choose_swiftplay(&app, champion_id, position, choice).await
}

/// Sets your lane opponent in champ select (an enemy champion id; 0 = none)
/// instead of League Bro's guess.
#[tauri::command]
async fn choose_lane_opponent(app: AppHandle, champion_id: i64) {
    matchup::choose_opponent(&app, champion_id).await
}

/// Champions to consider before you lock in (None outside champ select or once locked).
#[tauri::command]
async fn get_pick_suggestions(app: AppHandle) -> Option<picks::PickSuggestions> {
    picks::current(&app).await
}

/// A looked-up recommendation with picks in place (the Champions tab, which doesn't import).
#[tauri::command]
fn rec_with_choice(rec: opgg::Recommendation, choice: opgg::RecChoice) -> opgg::Recommendation {
    opgg::with_choice(&rec, &choice)
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
    let (alias, lcu) = {
        let sh = state.shared.lock().await;
        let statics = sh.statics.as_ref().ok_or("Open the League client to load champions")?;
        let champ = statics.champions.iter().find(|c| c.id == champion_id).ok_or("Unknown champion")?;
        if champ.classic {
            return Err("OP.GG has no League Classic stats".into());
        }
        (champ.alias.clone(), sh.lcu.clone())
    };
    state.opgg.recommend(champion_id, &alias, &position, &game_mode, lcu.as_ref()).await.map_err(msg)
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
            cfg.overlay_bottom = overlay.outer_size().ok().map(|s| pos.y + s.height as i32);
            save_config(app.clone(), state, cfg)?;
        }
    }
    engine::set_overlay_locked(&app, locked);
    Ok(())
}

/// Recent patch notes articles on leagueoflegends.com, newest first.
#[tauri::command]
async fn list_patches(state: State<'_, AppState>) -> Result<Vec<patch::PatchInfo>, String> {
    state.patches.list().await.map_err(msg)
}

/// One patch's changes, sorted into buffs, nerfs and adjustments.
#[tauri::command]
async fn get_patch(state: State<'_, AppState>, url: String) -> Result<patch::PatchNotes, String> {
    state.patches.notes(&url).await.map_err(msg)
}

/// One lane's tier list from Lolalytics or OP.GG (the Tier List tab).
/// `rank` is a filter like "emerald_plus" (`tierlist::RANKS`).
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
    state.tiers.get(source, &position, &rank, champions).await.map_err(msg)
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
    .map_err(msg)?;
    Ok(cache_usage(&state).await)
}

/// The overlay reports where its buttons are so they stay clickable while
/// the rest of the overlay is click-through.
#[tauri::command]
fn set_overlay_buttons(state: State<'_, AppState>, rects: Vec<[f64; 4]>) {
    state.overlay_input.lock().unwrap().buttons = rects;
}

/// Moves the unlocked overlay with the mouse: `start` at the press, then once
/// per mouse move. Not Windows' own window dragging (`data-tauri-drag-region`):
/// that move loop calls `ClipCursor(NULL)` when it ends, which frees the cursor
/// from League's window, so with two monitors it could slide onto the other one
/// until you alt-tabbed and League clipped it again.
#[tauri::command]
fn drag_overlay(app: AppHandle, state: State<'_, AppState>, start: bool) {
    let Some(w) = app.get_webview_window("overlay") else { return };
    let (Ok(cursor), Ok(pos)) = (app.cursor_position(), w.outer_position()) else { return };
    let mut input = state.overlay_input.lock().unwrap();
    if start {
        input.drag = Some(([cursor.x, cursor.y], [pos.x, pos.y]));
        return;
    }
    let Some(([cx, cy], [x, y])) = input.drag else { return };
    let to = tauri::PhysicalPosition::new(x + (cursor.x - cx).round() as i32, y + (cursor.y - cy).round() as i32);
    if to != pos {
        let _ = w.set_position(to);
    }
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

/// Sends a bug report or idea from the Feedback page to the devs' inbox.
#[tauri::command]
async fn send_feedback(report: feedback::Report) -> Result<(), String> {
    feedback::send(report).await
}

/// A beginner's guide to any champion (the Champions tab's Guide view).
#[tauri::command]
async fn champion_guide(state: State<'_, AppState>, champion_id: i64) -> Result<guide::Guide, String> {
    let (alias, lcu) = {
        let sh = state.shared.lock().await;
        let statics = sh.statics.as_ref().ok_or("Open the League client to load champions")?;
        let champ = statics.champions.iter().find(|c| c.id == champion_id).ok_or("Unknown champion")?;
        (champ.alias.clone(), sh.lcu.clone())
    };
    state.guides.get(champion_id, &alias, lcu.as_ref()).await.map_err(msg)
}

/// Opens a YouTube search for the champion's beginner guides in the default
/// browser. The URL is built here, so the UI can't open anything else.
#[tauri::command]
fn open_guide_videos(champion: String) -> Result<(), String> {
    let query = format!("{} beginner guide league of legends", champion.trim());
    let url = reqwest::Url::parse_with_params("https://www.youtube.com/results", [("search_query", query)])
        .map_err(|e| e.to_string())?;
    open_in_browser(url.as_str())
}

/// Hands a URL to the default browser. Passed as one argument (no shell),
/// so `&` in the query string is safe. Callers check the URL first.
fn open_in_browser(url: &str) -> Result<(), String> {
    let mut cmd = if cfg!(windows) {
        let mut c = std::process::Command::new("rundll32");
        c.arg("url.dll,FileProtocolHandler");
        c
    } else if cfg!(target_os = "macos") {
        std::process::Command::new("open")
    } else {
        std::process::Command::new("xdg-open")
    };
    cmd.arg(url)
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("Couldn't open the browser: {e}"))
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
                    app.path().app_cache_dir().ok().map(|d| d.join("opgg")),
                ),
                patches: patch::PatchNotesClient::new(
                    app.path().app_cache_dir().ok().map(|d| d.join("patch-notes")),
                ),
                tiers: tierlist::TierLists::new(),
                guides: guide::Guides::new(),
                lp: lp_history::LpStore::new(app.path().app_data_dir().ok()),
                overlay_input: std::sync::Mutex::new(engine::OverlayInput { passthrough: true, ..Default::default() }),
            });
            app.manage(picks::Picks::default());
            if let Some(overlay) = app.get_webview_window("overlay") {
                let _ = overlay.set_ignore_cursor_events(true);
                // macOS puts a full-screen game in its own Space; this lets the
                // overlay follow it there instead of staying on the desktop.
                #[cfg(target_os = "macos")]
                let _ = overlay.set_visible_on_all_workspaces(true);
            }
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(engine::run(handle.clone()));
            tauri::async_runtime::spawn(engine::watch_overlay_cursor(handle.clone()));
            tauri::async_runtime::spawn(usage::run(handle));
            Ok(())
        })
        .on_window_event(|window, event| {
            // Closing the main window quits the app (the overlay is hidden, not a real window to close).
            if window.label() == "main" {
                if let tauri::WindowEvent::CloseRequested { .. } = event {
                    // Its shop files show for every champion, so they don't outlive the app.
                    itemsets::remove_written_global();
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
            import_swiftplay_now,
            choose_swiftplay_option,
            lookup_rec,
            choose_rec_option,
            choose_lane_opponent,
            get_pick_suggestions,
            rec_with_choice,
            global_item_sets,
            move_global_item_sets,
            restore_global_item_sets,
            get_my_profile,
            renew_profile,
            get_match,
            preview_overlay,
            set_overlay_locked,
            list_patches,
            get_patch,
            get_tier_list,
            cache_info,
            clear_cache,
            set_overlay_buttons,
            drag_overlay,
            send_feedback,
            champion_guide,
            open_guide_videos
        ])
        .run(tauri::generate_context!())
        .expect("error while running League Bro");
}
