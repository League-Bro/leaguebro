//! Champion picks to consider in champ select, before you lock in: who
//! does best against your lane opponent (OP.GG's counters for that
//! champion in your lane), or, before they're picked, the strongest
//! champions in your lane right now (OP.GG's tier list). Banned and picked
//! champions and ones you can't play are left out. Gone once you lock in.
//!
//! The lane opponent is `matchup::guess_opponent`'s guess unless the player
//! chose one (`Shared::opponent_pick`, shared with the lane matchup).

use crate::cache::now_secs;
use crate::engine::{AppState, ChampSelectView};
use crate::matchup;
use crate::opgg::{self, WEB_API};
use crate::tierlist::{Source, TierEntry};
use crate::util::{get_json, int, list, web_client};
use anyhow::Result;
use serde::Serialize;
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::Mutex;

/// Sent to the UI (more than it shows, so it can still re-rank for your team's damage).
const MAX_PICKS: usize = 30;
/// Games of prior (the champion's win rate in the lane overall) mixed into
/// each head-to-head, so a 70% over 12 games doesn't top the list.
const PRIOR_GAMES: f64 = 100.0;
/// Fewer head-to-head games than this says nothing.
const MIN_VS_GAMES: i64 = 10;
/// OP.GG's counters change with the patch, not by the minute.
const COUNTERS_TTL: u64 = 6 * 3600;

#[derive(Debug, Clone, Serialize, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PickSuggestions {
    /// The client's lane name ("middle").
    pub position: String,
    /// Your lane opponent (0 = not known yet: the picks are the lane's strongest).
    pub opponent_id: i64,
    /// True when League Bro guessed the opponent; false when the player chose.
    pub guessed: bool,
    pub loading: bool,
    pub error: Option<String>,
    /// Best first.
    pub picks: Vec<SuggestedPick>,
}

#[derive(Debug, Clone, Serialize, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SuggestedPick {
    pub champion_id: i64,
    /// Against the opponent in this lane (0 games without an opponent).
    pub vs_games: i64,
    pub vs_win_rate: f64,
    /// In this lane overall (OP.GG Emerald+), 0.523 = 52.3 %.
    pub win_rate: f64,
    /// OP.GG's tier label ("OP", "1" … "5").
    pub tier: String,
    /// Your mastery points on the champion (0 = never played or unknown).
    pub mastery_points: i64,
    pub mastery_level: i64,
    /// What it's ranked by: the head-to-head mixed with the lane win rate,
    /// or the lane win rate alone.
    pub score: f64,
}

/// One row of OP.GG's `counters`: the opponent and their games against it.
#[derive(Debug, Clone, PartialEq)]
pub struct Counter {
    pub champion_id: i64,
    pub games: i64,
    /// The looked-up champion's wins (not the opponent's).
    pub wins: i64,
}

type Key = (i64, String, Vec<i64>, Vec<i64>, Vec<i64>, Option<i64>);

#[derive(Default)]
pub struct Picks {
    inner: Mutex<Inner>,
}

#[derive(Default)]
struct Inner {
    key: Option<Key>,
    /// Bumped on every new key, so a slow lookup for old picks is dropped.
    round: u64,
    current: Option<PickSuggestions>,
    /// By (champion, OP.GG position, game mode): fetched at, rows.
    counters: HashMap<(i64, String, String), (u64, Vec<Counter>)>,
    /// Your champions, once per champ select: champion -> (points, level).
    mastery: Option<HashMap<i64, (i64, i64)>>,
    pickable: Option<HashSet<i64>>,
}

/// OP.GG's head-to-heads for a champion page (`/data/counters`).
pub fn parse_counters(main: &Value) -> Vec<Counter> {
    list(main, "/data/counters")
        .iter()
        .map(|c| Counter { champion_id: int(c, "champion_id"), games: int(c, "play"), wins: int(c, "win") })
        .filter(|c| c.champion_id > 0 && c.games > 0)
        .collect()
}

/// Ranks the picks. `tiers` is your lane's tier list (best first);
/// `counters` the opponent's counters in your lane, whose wins are the
/// opponent's. `available` (None = unknown) and `taken` filter the list.
pub fn rank(
    tiers: &[TierEntry],
    counters: Option<&[Counter]>,
    taken: &HashSet<i64>,
    available: Option<&HashSet<i64>>,
    mastery: &HashMap<i64, (i64, i64)>,
) -> Vec<SuggestedPick> {
    let open = |id: i64| !taken.contains(&id) && available.is_none_or(|a| a.contains(&id));
    let pick = |t: &TierEntry| {
        let (mastery_points, mastery_level) = mastery.get(&t.champion_id).copied().unwrap_or_default();
        SuggestedPick {
            champion_id: t.champion_id,
            win_rate: t.win_rate / 100.0,
            tier: t.label.clone(),
            mastery_points,
            mastery_level,
            ..Default::default()
        }
    };
    let mut out: Vec<SuggestedPick> = match counters {
        // Only champions that really play the lane (the tier list's), so the
        // prior is that champion's own lane win rate.
        Some(rows) => rows
            .iter()
            .filter(|c| c.games >= MIN_VS_GAMES && open(c.champion_id))
            .filter_map(|c| {
                let t = tiers.iter().find(|t| t.champion_id == c.champion_id)?;
                let mut p = pick(t);
                let ours = (c.games - c.wins) as f64;
                p.vs_games = c.games;
                p.vs_win_rate = ours / c.games as f64;
                p.score = (ours + PRIOR_GAMES * p.win_rate) / (c.games as f64 + PRIOR_GAMES);
                Some(p)
            })
            .collect(),
        // OP.GG's own order (win, pick and ban rates), which keeps niche
        // picks with a lucky win rate off the top.
        None => tiers
            .iter()
            .filter(|t| open(t.champion_id))
            .map(|t| {
                let mut p = pick(t);
                p.score = p.win_rate;
                p
            })
            .collect(),
    };
    if counters.is_some() {
        out.sort_by(|a, b| b.score.total_cmp(&a.score));
    }
    out.truncate(MAX_PICKS);
    out
}

/// What the picks depend on, or None when there's nothing to suggest:
/// locked in, Swiftplay, or a mode without lanes or roles.
fn key(view: &ChampSelectView, map_id: i64, opponent_pick: Option<i64>) -> Option<Key> {
    let lanes = matches!(opgg::game_mode_for(view.queue_id, map_id), Some("ranked" | "flex"));
    let swiftplay = matches!(view.queue_id, 480 | 490);
    if view.locked || swiftplay || !lanes || map_id != 11 || view.my_position.is_empty() {
        return None;
    }
    let ids = |ps: &[crate::engine::CsPlayer]| ps.iter().filter(|p| !p.is_me).map(|p| p.champion_id).collect::<Vec<_>>();
    let mut bans = view.bans.clone();
    bans.sort_unstable();
    Some((view.queue_id, view.my_position.to_lowercase(), ids(&view.enemies), ids(&view.allies), bans, opponent_pick))
}

/// Called with every champ select update: starts a lookup when the picks
/// change, and clears the suggestions once you lock in.
pub async fn update(app: &AppHandle, view: &ChampSelectView) {
    let state = app.state::<AppState>();
    let (map_id, opponent_pick) = {
        let sh = state.shared.lock().await;
        (sh.map(), sh.opponent_pick)
    };
    let key = key(view, map_id, opponent_pick);
    let round = {
        let picks = app.state::<Picks>();
        let mut p = picks.inner.lock().await;
        if p.key == key {
            return;
        }
        p.key = key.clone();
        p.round += 1;
        match &key {
            None => {
                if p.current.take().is_some() {
                    let _ = app.emit("pick-suggestions", Option::<PickSuggestions>::None);
                }
                return;
            }
            Some(k) => {
                // The last picks stay up while the new ones load.
                let mut s = p.current.clone().filter(|s| s.position == k.1).unwrap_or_default();
                (s.position, s.loading, s.error) = (k.1.clone(), true, None);
                p.current = Some(s.clone());
                let _ = app.emit("pick-suggestions", Some(s));
                p.round
            }
        }
    };
    let app = app.clone();
    let view = view.clone();
    tauri::async_runtime::spawn(async move {
        let result = lookup(&app, &view, opponent_pick).await;
        let picks = app.state::<Picks>();
        let mut p = picks.inner.lock().await;
        if p.round != round {
            return;
        }
        let s = match result {
            Ok(s) => s,
            Err(e) => {
                let mut s = p.current.clone().unwrap_or_default();
                (s.loading, s.error) = (false, Some(format!("{e:#}")));
                s
            }
        };
        p.current = Some(s.clone());
        let _ = app.emit("pick-suggestions", Some(s));
    });
}

/// Champ select is over: forgets the picks and this champ select's mastery
/// and pickable champions.
pub async fn clear(app: &AppHandle) {
    let picks = app.state::<Picks>();
    let mut p = picks.inner.lock().await;
    p.round += 1;
    (p.key, p.mastery, p.pickable) = (None, None, None);
    if p.current.take().is_some() {
        let _ = app.emit("pick-suggestions", Option::<PickSuggestions>::None);
    }
}

pub async fn current(app: &AppHandle) -> Option<PickSuggestions> {
    app.state::<Picks>().inner.lock().await.current.clone()
}

async fn lookup(app: &AppHandle, view: &ChampSelectView, opponent_pick: Option<i64>) -> Result<PickSuggestions> {
    let state = app.state::<AppState>();
    let position = view.my_position.to_lowercase();
    let (names, lcu, mode) = {
        let sh = state.shared.lock().await;
        let names: Vec<(i64, String)> = sh
            .statics
            .as_ref()
            .map(|s| s.champions.iter().filter(|c| !c.classic).map(|c| (c.id, c.name.clone())).collect())
            .unwrap_or_default();
        (names, sh.lcu.clone(), opgg::game_mode_for(view.queue_id, sh.map()).unwrap_or("ranked"))
    };
    let names = Some(names).filter(|n| !n.is_empty());
    let enemies: Vec<i64> = view.enemies.iter().map(|e| e.champion_id).filter(|&c| c > 0).collect();
    let (opponent, guessed) = match opponent_pick {
        Some(p) if p == 0 || enemies.contains(&p) => (p, false),
        _ if enemies.is_empty() => (0, true),
        _ => {
            let lanes = state.tiers.lane_games(names.clone()).await.unwrap_or_else(|e| {
                eprintln!("pick suggestions lane guess: {e:#}");
                HashMap::new()
            });
            (matchup::guess_opponent(&position, &enemies, &lanes).unwrap_or(0), true)
        }
    };
    let tiers = state.tiers.get(Source::Opgg, &position, "emerald_plus", names).await?;
    let counters = if opponent > 0 { Some(counters(app, opponent, &position, mode).await?) } else { None };

    // Yours to pick: owned (or free) and not taken. Asked once per champ select.
    let picks = app.state::<Picks>();
    let known = {
        let p = picks.inner.lock().await;
        (p.mastery.clone(), p.pickable.clone())
    };
    let (mastery, pickable) = match (known, lcu.as_ref()) {
        ((Some(m), pickable), _) => (m, pickable),
        ((None, _), Some(l)) => {
            let (m, ids) = tokio::join!(
                l.get("/lol-champion-mastery/v1/local-player/champion-mastery"),
                l.get("/lol-champ-select/v1/pickable-champion-ids"),
            );
            let mastery: HashMap<i64, (i64, i64)> = m
                .ok()
                .flatten()
                .as_ref()
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .map(|c| (int(c, "championId"), (int(c, "championPoints"), int(c, "championLevel"))))
                .collect();
            let pickable: Option<HashSet<i64>> = ids
                .ok()
                .flatten()
                .as_ref()
                .and_then(Value::as_array)
                .map(|a| a.iter().filter_map(Value::as_i64).collect())
                .filter(|s: &HashSet<i64>| !s.is_empty());
            let mut p = picks.inner.lock().await;
            (p.mastery, p.pickable) = (Some(mastery.clone()), pickable.clone());
            (mastery, pickable)
        }
        ((None, _), None) => (HashMap::new(), None),
    };
    let taken: HashSet<i64> = view
        .bans
        .iter()
        .copied()
        .chain(view.enemies.iter().map(|e| e.champion_id))
        .chain(view.allies.iter().filter(|a| !a.is_me).map(|a| a.champion_id))
        .filter(|&c| c > 0)
        .collect();
    Ok(PickSuggestions {
        position,
        opponent_id: opponent,
        guessed,
        loading: false,
        error: None,
        picks: rank(&tiers.entries, counters.as_deref(), &taken, pickable.as_ref(), &mastery),
    })
}

/// The opponent's counters in your lane, from OP.GG's champion page (~0.2 s,
/// kept for a few hours).
async fn counters(app: &AppHandle, champion_id: i64, position: &str, game_mode: &str) -> Result<Vec<Counter>> {
    let pos = opgg::position_param(position, game_mode).to_string();
    let key = (champion_id, pos.clone(), game_mode.to_string());
    let picks = app.state::<Picks>();
    if let Some((at, rows)) = picks.inner.lock().await.counters.get(&key) {
        if now_secs().saturating_sub(*at) < COUNTERS_TTL {
            return Ok(rows.clone());
        }
    }
    let url = format!("{WEB_API}/{game_mode}/{champion_id}/{pos}");
    let main = get_json(web_client(10).get(url), "OP.GG").await?;
    let rows = parse_counters(&main);
    picks.inner.lock().await.counters.insert(key, (now_secs(), rows.clone()));
    Ok(rows)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::engine::CsPlayer;

    fn tier(id: i64, win_rate: f64) -> TierEntry {
        TierEntry {
            champion_id: id,
            name: String::new(),
            tier: "A".into(),
            label: "2".into(),
            rank: 0,
            rank_change: None,
            win_rate,
            pick_rate: 5.0,
            ban_rate: 1.0,
            games: 5000,
        }
    }

    #[test]
    fn reads_opgg_counters() {
        // Real answer for Ahri mid (October 2026): Ahri's wins against each opponent.
        let text = std::fs::read_to_string(format!("{}/tests/fixtures/opgg_web_ahri_mid.json", env!("CARGO_MANIFEST_DIR"))).unwrap();
        let rows = parse_counters(&serde_json::from_str(&text).unwrap());
        assert!(rows.len() > 30, "{} rows", rows.len());
        assert_eq!(rows[0], Counter { champion_id: 517, games: 602, wins: 327 });
        assert!(rows.iter().all(|c| c.wins <= c.games));
    }

    #[test]
    fn counters_rank_by_head_to_head_with_the_lane_rate_mixed_in() {
        let tiers = [tier(1, 50.0), tier(2, 50.0), tier(3, 50.0), tier(4, 55.0)];
        let rows = [
            // The opponent's wins: 1 wins 60% of 1000 games against it.
            Counter { champion_id: 1, games: 1000, wins: 400 },
            // 75% but over 12 games: mostly the prior.
            Counter { champion_id: 2, games: 12, wins: 3 },
            Counter { champion_id: 3, games: 1000, wins: 600 },
            // Too few games to count.
            Counter { champion_id: 4, games: 5, wins: 0 },
            // Not in the tier list: doesn't play the lane.
            Counter { champion_id: 9, games: 900, wins: 100 },
        ];
        let picks = rank(&tiers, Some(&rows), &HashSet::new(), None, &HashMap::new());
        let ids: Vec<i64> = picks.iter().map(|p| p.champion_id).collect();
        assert_eq!(ids, [1, 2, 3]);
        assert!((picks[0].vs_win_rate - 0.6).abs() < 1e-9);
        assert_eq!(picks[0].vs_games, 1000);
        assert!(picks[1].score < 0.6 && picks[1].score > 0.5);
    }

    #[test]
    fn leaves_out_taken_and_unowned_champions() {
        let tiers = [tier(1, 52.0), tier(2, 51.0), tier(3, 50.0)];
        let taken = HashSet::from([1]);
        let owned = HashSet::from([2]);
        let mastery = HashMap::from([(2, (120_000, 7))]);
        let picks = rank(&tiers, None, &taken, Some(&owned), &mastery);
        assert_eq!(picks.len(), 1);
        assert_eq!((picks[0].champion_id, picks[0].mastery_points, picks[0].mastery_level), (2, 120_000, 7));
        assert!((picks[0].win_rate - 0.51).abs() < 1e-9);
        assert_eq!(picks[0].vs_games, 0);
    }

    #[test]
    fn only_before_lock_in_in_lane_modes() {
        let me = CsPlayer { is_me: true, champion_id: 103, ..Default::default() };
        let view = ChampSelectView {
            queue_id: 420,
            my_position: "MIDDLE".into(),
            allies: vec![me, CsPlayer { champion_id: 64, ..Default::default() }],
            enemies: vec![CsPlayer { champion_id: 238, ..Default::default() }],
            bans: vec![99, 84],
            ..Default::default()
        };
        let k = key(&view, 11, None).unwrap();
        assert_eq!(k, (420, "middle".into(), vec![238], vec![64], vec![84, 99], None));
        // Your own hover doesn't start a new lookup.
        let mut hover = view.clone();
        hover.allies[0].champion_id = 1;
        assert_eq!(key(&hover, 11, None), Some(k));
        assert_eq!(key(&ChampSelectView { locked: true, ..view.clone() }, 11, None), None);
        assert_eq!(key(&ChampSelectView { queue_id: 480, ..view.clone() }, 11, None), None);
        assert_eq!(key(&ChampSelectView { queue_id: 450, ..view.clone() }, 12, None), None);
        assert_eq!(key(&ChampSelectView { my_position: String::new(), ..view }, 11, None), None);
    }
}
