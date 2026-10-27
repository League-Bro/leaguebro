//! Your lane opponent in champ select and how you match up (OP.GG's
//! head-to-head, matchup build and lane tip, plus your own recent games).
//!
//! The client doesn't say which lane each enemy plays, so the opponent is a
//! guess from the enemy picks: OP.GG's games per lane for each champion
//! (`TierLists::lane_games`), with every enemy put in a different lane and
//! the likeliest arrangement kept. The player can pick another enemy instead
//! (`Shared::opponent_pick`). Only enemy champions are used, which everyone
//! in champ select can see; never names.

use crate::engine::{self, AppState, RecState};
use crate::opgg::{self, Matchup};
use crate::profile::{self, ChampStat};
use crate::tierlist::LANES;
use serde::Serialize;
use std::collections::HashMap;
use tauri::{AppHandle, Emitter, Manager};

/// A guess needs the champion to play the lane in at least this share of its
/// games; below that it's more likely someone not picked yet.
const MIN_GUESS_SHARE: f64 = 0.05;

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct MatchupState {
    pub opponent_id: i64,
    /// True when League Bro guessed the opponent; false when the player chose.
    pub guessed: bool,
    pub loading: bool,
    /// OP.GG's numbers are in (`matchup`, no tip yet) and its lane tip is still loading.
    pub tip_loading: bool,
    pub matchup: Option<Matchup>,
    pub error: Option<String>,
    /// Your recent games against them in lane (None until loaded, or if it failed).
    pub my_record: Option<ChampStat>,
}

/// The enemy most likely to be in `my_position`. `enemies` are the picked
/// champion ids; `lanes` is games per lane in `LANES` order.
pub fn guess_opponent(my_position: &str, enemies: &[i64], lanes: &HashMap<i64, [i64; 5]>) -> Option<i64> {
    let mine = LANES.iter().position(|l| l.eq_ignore_ascii_case(my_position))?;
    let mut picks: Vec<i64> = Vec::new();
    for &e in enemies.iter().filter(|&&e| e > 0) {
        if !picks.contains(&e) && picks.len() < LANES.len() {
            picks.push(e);
        }
    }
    let share = |champ: i64, lane: usize| {
        let games = lanes.get(&champ).copied().unwrap_or_default();
        let total: i64 = games.iter().sum();
        if total > 0 { games[lane] as f64 / total as f64 } else { 0.0 }
    };
    // Try every way to put the picks in different lanes (at most 5! = 120).
    fn search(i: usize, picks: &[i64], used: &mut [bool; 5], lane_of: &mut Vec<usize>, score: f64,
              share: &dyn Fn(i64, usize) -> f64, best: &mut (f64, Vec<usize>)) {
        if i == picks.len() {
            if score > best.0 {
                *best = (score, lane_of.clone());
            }
            return;
        }
        for lane in 0..5 {
            if !used[lane] {
                used[lane] = true;
                lane_of.push(lane);
                search(i + 1, picks, used, lane_of, score + (share(picks[i], lane) + 0.01).ln(), share, best);
                lane_of.pop();
                used[lane] = false;
            }
        }
    }
    let mut best = (f64::NEG_INFINITY, Vec::new());
    search(0, &picks, &mut [false; 5], &mut Vec::new(), 0.0, &share, &mut best);
    let i = best.1.iter().position(|&lane| lane == mine)?;
    (share(picks[i], mine) >= MIN_GUESS_SHARE).then_some(picks[i])
}

/// Works out the lane opponent from the current champ select and loads the
/// matchup. Does nothing in modes without lanes or before you've locked in.
pub async fn refresh(app: &AppHandle) {
    let state = app.state::<AppState>();
    if state.config().rec_source != "opgg" {
        return;
    }
    let (champ, position, enemies, pick, lane_mode, names) = {
        let sh = state.shared.lock().await;
        let Some(cs) = sh.champ_select.as_ref().filter(|cs| cs.locked) else { return };
        let mode = opgg::game_mode_for(sh.queue_id, sh.map());
        let names: Vec<(i64, String)> = sh
            .statics
            .as_ref()
            .map(|s| s.champions.iter().filter(|c| !c.classic).map(|c| (c.id, c.name.clone())).collect())
            .unwrap_or_default();
        let enemies: Vec<i64> = cs.enemies.iter().map(|e| e.champion_id).filter(|&c| c > 0).collect();
        (cs.my_champion_id, cs.my_position.to_lowercase(), enemies, sh.opponent_pick, matches!(mode, Some("ranked" | "flex")), names)
    };
    if champ == 0 || position.is_empty() || !lane_mode {
        return;
    }
    let (opponent, guessed) = match pick {
        // The player's pick, while that champion is still on the enemy team.
        Some(p) if p == 0 || enemies.contains(&p) => (p, false),
        _ => {
            let lanes = match state.tiers.lane_games(Some(names).filter(|n| !n.is_empty())).await {
                Ok(l) => l,
                Err(e) => {
                    eprintln!("lane guess: {e:#}");
                    HashMap::new()
                }
            };
            (guess_opponent(&position, &enemies, &lanes).unwrap_or(0), true)
        }
    };
    ensure(app, champ, &position, opponent, guessed).await;
}

/// At the start of a lane-mode champ select, loads what the lane matchup needs
/// at lock-in (OP.GG's games per lane for the guess, your full game records
/// for the record against them), so the card doesn't wait on it then.
pub async fn prefetch(app: &AppHandle) {
    let state = app.state::<AppState>();
    if state.config().rec_source != "opgg" {
        return;
    }
    let (lane_mode, names, lcu) = {
        let sh = state.shared.lock().await;
        let mode = opgg::game_mode_for(sh.queue_id, sh.map());
        let names: Vec<(i64, String)> = sh
            .statics
            .as_ref()
            .map(|s| s.champions.iter().filter(|c| !c.classic).map(|c| (c.id, c.name.clone())).collect())
            .unwrap_or_default();
        (matches!(mode, Some("ranked" | "flex")), names, sh.lcu.clone())
    };
    if !lane_mode {
        return;
    }
    let records = async {
        if let Some(l) = lcu.as_ref() {
            let _ = profile::record_against(l, 0).await;
        }
    };
    let (lanes, _) = tokio::join!(state.tiers.lane_games(Some(names).filter(|n| !n.is_empty())), records);
    if let Err(e) = lanes {
        eprintln!("lane guess prefetch: {e:#}");
    }
}

/// Loads (or clears, with opponent 0) the matchup for your champion and
/// publishes it on the recommendation.
async fn ensure(app: &AppHandle, champion_id: i64, position: &str, opponent_id: i64, guessed: bool) {
    let state = app.state::<AppState>();
    let (alias, opponent_alias, game_mode, lcu) = {
        let mut sh = state.shared.lock().await;
        let current = sh.rec.as_ref().filter(|r| r.champion_id == champion_id && r.position == position);
        let same = current.and_then(|r| r.matchup.as_ref()).map(|m| (m.opponent_id, m.guessed, m.loading || m.matchup.is_some()));
        match same {
            Some((o, g, busy_or_done)) if o == opponent_id && (busy_or_done || o == 0) => {
                if g != guessed {
                    // Same champion, now chosen by the player (or guessed again): just relabel it.
                    set(app, &mut sh, champion_id, position, |m| m.guessed = guessed);
                }
                return;
            }
            _ => {}
        }
        let loading = MatchupState { opponent_id, guessed, loading: opponent_id != 0, ..Default::default() };
        set(app, &mut sh, champion_id, position, |m| *m = loading);
        if opponent_id == 0 {
            return;
        }
        let mode = opgg::game_mode_for(sh.queue_id, sh.map()).unwrap_or("ranked");
        (sh.opgg_alias(champion_id), sh.opgg_alias(opponent_id), mode, sh.lcu.clone())
    };
    let (Some(alias), Some(opponent_alias)) = (alias, opponent_alias) else { return };
    // OP.GG's answer and your own record are published as each one lands: the
    // record can take much longer (match history plus a few dozen full game
    // records right after the client starts), and the card shouldn't wait for it.
    // The website's numbers come first (~0.3 s); OP.GG's tip follows with the full answer (~3.5 s).
    let (early_tx, early_rx) = tokio::sync::oneshot::channel();
    let early = async {
        let Ok(x) = early_rx.await else { return }; // a saved answer, or the website failed
        let mut sh = state.shared.lock().await;
        if !current(&sh, opponent_id).is_some_and(|m| m.loading) {
            return; // the full answer (or a newer lookup) got there first
        }
        set(app, &mut sh, champion_id, position, |m| {
            m.loading = false;
            m.tip_loading = true;
            m.matchup = Some(x);
        });
    };
    let opgg = async {
        let send_early = move |m| {
            let _ = early_tx.send(m);
        };
        let result = state
            .opgg
            .matchup(champion_id, &alias, opponent_id, &opponent_alias, position, game_mode, lcu.as_ref(), send_early)
            .await;
        let mut sh = state.shared.lock().await;
        // The opponent changed while this was loading: the newer lookup owns it.
        if !current(&sh, opponent_id).is_some_and(|m| m.loading || m.tip_loading) {
            return;
        }
        set(app, &mut sh, champion_id, position, |m| {
            m.loading = false;
            m.tip_loading = false;
            match result {
                Ok(x) => m.matchup = Some(x),
                Err(e) => m.error = Some(format!("{e:#}")),
            }
        });
    };
    let record = async {
        let Some(l) = lcu.as_ref() else { return };
        let Ok(record) = profile::record_against(l, opponent_id).await.map_err(|e| eprintln!("lane record: {e:#}")) else {
            return;
        };
        let mut sh = state.shared.lock().await;
        if current(&sh, opponent_id).is_some() {
            // Shown with the matchup, so it's simply kept if that's still loading.
            set(app, &mut sh, champion_id, position, |m| m.my_record = Some(record));
        }
    };
    tokio::join!(opgg, early, record);
}

/// The matchup on the current recommendation, if it's still against `opponent_id`.
fn current(sh: &crate::engine::Shared, opponent_id: i64) -> Option<&MatchupState> {
    sh.rec.as_ref().and_then(|r| r.matchup.as_ref()).filter(|m| m.opponent_id == opponent_id)
}

/// Updates the matchup on the current recommendation and sends it to the UI.
/// A new opponent puts the player back on the overall build, and re-imports
/// it if they'd imported the matchup one.
fn set(app: &AppHandle, sh: &mut crate::engine::Shared, champion_id: i64, position: &str, f: impl FnOnce(&mut MatchupState)) {
    let current = sh.champ_select.as_ref().map(|cs| cs.my_champion_id);
    let Some(reset) = update(&mut sh.rec, current, champion_id, position, f) else { return };
    if let Some(rs) = sh.rec.as_ref() {
        let _ = app.emit("recommendation", Some(rs.for_ui()));
    }
    if reset && current == Some(champion_id) {
        let (app, position) = (app.clone(), position.to_string());
        tauri::async_runtime::spawn(async move {
            let result = engine::import_for(&app, champion_id, &position).await;
            if app.state::<AppState>().shared.lock().await.my_champion_id == champion_id {
                engine::publish_import(&app, champion_id, result).await;
            }
        });
    }
}

/// `set` without the app: applies `f` to the matchup on `rec` for
/// `champion_id` + `position`. `current` is your champion in champ select.
/// A recommendation for another champion or role is replaced with an empty
/// loading one when this is your current champion (the matchup lookup can
/// get there before `ensure_rec` publishes, which keeps the matchup), and
/// left alone otherwise (a lookup for a champion you've left). Returns None
/// if nothing changed, else whether the matchup build choice was reset.
fn update(rec: &mut Option<RecState>, current: Option<i64>, champion_id: i64, position: &str,
          f: impl FnOnce(&mut MatchupState)) -> Option<bool> {
    if current.is_some_and(|c| c != champion_id) {
        return None;
    }
    if rec.as_ref().is_some_and(|r| r.champion_id != champion_id || r.position != position) {
        if current.is_none() {
            return None;
        }
        *rec = None;
    }
    let rs = rec.get_or_insert_with(|| RecState { champion_id, position: position.to_string(), loading: true, ..Default::default() });
    let mut m = rs.matchup.clone().unwrap_or_default();
    let before = m.opponent_id;
    f(&mut m);
    let reset = m.opponent_id != before && rs.choice.matchup;
    if reset {
        rs.choice = Default::default();
    }
    rs.matchup = Some(m);
    Some(reset)
}

/// The player picked their lane opponent (0 = none). Kept until champ select ends.
pub async fn choose_opponent(app: &AppHandle, opponent_id: i64) {
    app.state::<AppState>().shared.lock().await.opponent_pick = Some(opponent_id);
    refresh(app).await;
}

#[cfg(test)]
mod tests {
    use super::*;

    fn lanes() -> HashMap<i64, [i64; 5]> {
        // top, jungle, middle, bottom, utility
        HashMap::from([
            (238, [500, 0, 9000, 0, 0]),       // Zed: mid
            (64, [0, 12000, 0, 0, 0]),         // Lee Sin: jungle
            (222, [0, 0, 0, 15000, 0]),        // Jinx: bot
            (412, [0, 0, 0, 0, 14000]),        // Thresh: support
            (157, [3000, 0, 6000, 0, 0]),      // Yasuo: mid, sometimes top
            (86, [9000, 0, 300, 0, 0]),        // Garen: top
        ])
    }

    #[test]
    fn guesses_the_mid_laner() {
        assert_eq!(guess_opponent("middle", &[64, 238, 222], &lanes()), Some(238));
        assert_eq!(guess_opponent("MIDDLE", &[238], &lanes()), Some(238));
    }

    #[test]
    fn flex_picks_go_where_the_rest_fit() {
        // Zed takes mid, so Yasuo is the top laner.
        assert_eq!(guess_opponent("top", &[157, 238, 64], &lanes()), Some(157));
        assert_eq!(guess_opponent("middle", &[157, 238, 64], &lanes()), Some(238));
        // With Garen top, Yasuo is mid.
        assert_eq!(guess_opponent("middle", &[157, 86], &lanes()), Some(157));
    }

    #[test]
    fn no_guess_without_a_likely_pick() {
        // Nobody picked plays mid.
        assert_eq!(guess_opponent("middle", &[64, 222, 412], &lanes()), None);
        assert_eq!(guess_opponent("middle", &[], &lanes()), None);
        assert_eq!(guess_opponent("", &[238], &lanes()), None);
        // Unknown champions (no OP.GG data) aren't guessed.
        assert_eq!(guess_opponent("middle", &[999], &lanes()), None);
    }

    fn opponent(id: i64) -> impl FnOnce(&mut MatchupState) {
        move |m| *m = MatchupState { opponent_id: id, loading: true, ..Default::default() }
    }

    #[test]
    fn matchup_replaces_the_last_champions_rec() {
        // Ahri's rec is still up when Syndra's matchup lookup gets there first.
        let mut rec = Some(RecState { champion_id: 103, position: "middle".into(), ..Default::default() });
        assert_eq!(update(&mut rec, Some(134), 134, "middle", opponent(238)), Some(false));
        let rs = rec.as_ref().unwrap();
        assert_eq!((rs.champion_id, rs.loading, rs.matchup.as_ref().unwrap().opponent_id), (134, true, 238));

        // A slow lookup for a champion you've left changes nothing.
        assert_eq!(update(&mut rec, Some(134), 103, "middle", opponent(7)), None);
        assert_eq!(rec.as_ref().unwrap().matchup.as_ref().unwrap().opponent_id, 238);
        // Nor does one for another champion outside champ select.
        assert_eq!(update(&mut rec, None, 103, "middle", opponent(7)), None);
    }

    #[test]
    fn new_opponent_resets_the_matchup_build() {
        let mut rec = Some(RecState { champion_id: 103, position: "middle".into(), ..Default::default() });
        update(&mut rec, Some(103), 103, "middle", opponent(238));
        rec.as_mut().unwrap().choice = opgg::RecChoice { runes: 1, matchup: true, ..Default::default() };
        // Same opponent (e.g. the result coming in): the choice stays.
        assert_eq!(update(&mut rec, Some(103), 103, "middle", |m| m.loading = false), Some(false));
        assert!(rec.as_ref().unwrap().choice.matchup);
        // Another opponent: back to the top options for all games, and `set` re-imports.
        assert_eq!(update(&mut rec, Some(103), 103, "middle", opponent(7)), Some(true));
        assert_eq!(rec.as_ref().unwrap().choice, opgg::RecChoice::default());
        // Without the vs build picked, nothing to reset.
        assert_eq!(update(&mut rec, Some(103), 103, "middle", opponent(238)), Some(false));
    }
}
