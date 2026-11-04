//! Champions to ban, in champ select while your ban is still to make: the
//! strongest champions in your lane by Lolalytics' win rate for your rank
//! (or the rank chosen on the card, `picks::suggestion_rank`), nudged up a little for champions you've lost to
//! in your recent games. Banned, picked and hovered champions (your team's
//! hovers too) are left out. Gone once you've banned.

use crate::engine::{AppState, ChampSelectView};
use crate::profile::{self, MatchLine};
use crate::tierlist::{Source, TierEntry};
use anyhow::Result;
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::Mutex;

/// Sent to the UI (it shows the first few).
const MAX_BANS: usize = 10;
/// Champions picked in fewer games than this (%) are rarely worth a ban.
const MIN_PICK_RATE: f64 = 1.0;
/// Win rate points added for each net loss against a champion in your
/// recent games (more losses than wins), anywhere on the enemy team; a lane
/// opponent counts again on top. Capped, so it only reorders close calls.
const PER_LOSS: f64 = 0.25;
const MAX_PERSONAL: f64 = 1.5;
/// Fewer games against a champion than this says nothing.
const MIN_GAMES_VS: i64 = 2;
/// Match history can be slow right after the client starts; bans go up without it.
const HISTORY_WAIT: Duration = Duration::from_secs(10);

#[derive(Debug, Clone, Serialize, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BanSuggestions {
    /// The client's lane name ("middle").
    pub position: String,
    pub loading: bool,
    pub error: Option<String>,
    /// False when your match history couldn't be read (win rates only).
    pub personal: bool,
    /// The rank filter the win rates are for ("gold", "emerald_plus"…).
    pub rank: String,
    /// Your own rank's filter (None = unranked or unknown).
    pub my_rank: Option<String>,
    /// Best ban first.
    pub bans: Vec<SuggestedBan>,
}

#[derive(Debug, Clone, Serialize, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SuggestedBan {
    pub champion_id: i64,
    /// In your lane (Lolalytics, for the rank filter), 0.523 = 52.3 %.
    pub win_rate: f64,
    pub pick_rate: f64,
    pub ban_rate: f64,
    /// Lolalytics' tier label ("S+" … "D-").
    pub tier: String,
    /// Your recent games against it (anywhere on the enemy team) and your wins.
    pub games_vs: i64,
    pub wins_vs: i64,
    /// The same with it as your lane opponent.
    pub lane_games_vs: i64,
    pub lane_wins_vs: i64,
    /// Win rate points added for your losses against it.
    pub personal: f64,
    /// Win rate (points) plus `personal`: what it's ranked by.
    pub score: f64,
}

/// Your record against one champion: (games, wins) anywhere, then as your lane opponent.
#[derive(Debug, Clone, Copy, Default, PartialEq)]
pub struct Record {
    pub games: i64,
    pub wins: i64,
    pub lane_games: i64,
    pub lane_wins: i64,
}

type Key = (i64, String, Vec<i64>, String);

#[derive(Default)]
pub struct Bans {
    inner: Mutex<Inner>,
}

#[derive(Default)]
struct Inner {
    key: Option<Key>,
    round: u64,
    current: Option<BanSuggestions>,
    /// Your record against each champion, once per champ select.
    records: Option<HashMap<i64, Record>>,
}

/// Your record against each enemy champion in your games (remakes left out).
pub fn records(matches: &[MatchLine]) -> HashMap<i64, Record> {
    tally(matches.iter().map(|m| (m.result.as_str(), m.lane_opponent, m.enemies.as_slice())))
}

/// `records` over (result, lane opponent, enemies).
fn tally<'a>(games: impl IntoIterator<Item = (&'a str, Option<i64>, &'a [i64])>) -> HashMap<i64, Record> {
    let mut out: HashMap<i64, Record> = HashMap::new();
    for (result, lane, enemies) in games.into_iter().filter(|g| g.0 != "remake") {
        let win = (result == "win") as i64;
        for &id in enemies {
            let r = out.entry(id).or_default();
            r.games += 1;
            r.wins += win;
        }
        if let Some(id) = lane {
            let r = out.entry(id).or_default();
            r.lane_games += 1;
            r.lane_wins += win;
            // Games whose full record didn't load still know the lane opponent.
            if !enemies.contains(&id) {
                r.games += 1;
                r.wins += win;
            }
        }
    }
    out
}

/// Win rate points for your losses against a champion.
fn personal(r: &Record) -> f64 {
    let net = |games: i64, wins: i64| if games >= MIN_GAMES_VS { (games - 2 * wins).max(0) as f64 } else { 0.0 };
    (PER_LOSS * (net(r.games, r.wins) + net(r.lane_games, r.lane_wins))).min(MAX_PERSONAL)
}

/// Ranks the bans: `tiers` is your lane's Lolalytics list, `taken` what can't be banned or shouldn't be.
pub fn rank(tiers: &[TierEntry], taken: &HashSet<i64>, records: &HashMap<i64, Record>) -> Vec<SuggestedBan> {
    let mut out: Vec<SuggestedBan> = tiers
        .iter()
        .filter(|t| t.pick_rate >= MIN_PICK_RATE && !taken.contains(&t.champion_id))
        .map(|t| {
            let r = records.get(&t.champion_id).copied().unwrap_or_default();
            let personal = personal(&r);
            SuggestedBan {
                champion_id: t.champion_id,
                win_rate: t.win_rate / 100.0,
                pick_rate: t.pick_rate / 100.0,
                ban_rate: t.ban_rate / 100.0,
                tier: t.label.clone(),
                games_vs: r.games,
                wins_vs: r.wins,
                lane_games_vs: r.lane_games,
                lane_wins_vs: r.lane_wins,
                personal,
                score: t.win_rate + personal,
            }
        })
        .collect();
    out.sort_by(|a, b| b.score.total_cmp(&a.score).then(b.pick_rate.total_cmp(&a.pick_rate)));
    out.truncate(MAX_BANS);
    out
}

/// What the bans depend on, or None when there's nothing to suggest: your
/// ban is done (or you have none), or not Summoner's Rift with lanes.
fn key(view: &ChampSelectView, map_id: i64, rank: &str) -> Option<Key> {
    if !view.ban_pending || map_id != 11 || view.my_position.is_empty() {
        return None;
    }
    let mut taken: Vec<i64> = taken(view).into_iter().collect();
    taken.sort_unstable();
    Some((view.queue_id, view.my_position.to_lowercase(), taken, rank.to_string()))
}

/// Banned, picked and hovered champions, on both teams (yours included).
fn taken(view: &ChampSelectView) -> HashSet<i64> {
    view.bans
        .iter()
        .copied()
        .chain(view.allies.iter().flat_map(|a| [a.champion_id, a.pick_intent]))
        .chain(view.enemies.iter().flat_map(|e| [e.champion_id, e.pick_intent]))
        .filter(|&c| c > 0)
        .collect()
}

/// Called with every champ select update: starts a lookup when bans or
/// picks change, and clears the suggestions once you've banned.
pub async fn update(app: &AppHandle, view: &ChampSelectView) {
    let state = app.state::<AppState>();
    let map_id = state.shared.lock().await.map();
    let key = key(view, map_id, &state.config().suggest_rank);
    let round = {
        let bans = app.state::<Bans>();
        let mut b = bans.inner.lock().await;
        if b.key == key {
            return;
        }
        b.key = key.clone();
        b.round += 1;
        match &key {
            None => {
                if b.current.take().is_some() {
                    let _ = app.emit("ban-suggestions", Option::<BanSuggestions>::None);
                }
                return;
            }
            Some(k) => {
                // The last bans stay up while the new ones load.
                let mut s = b.current.clone().filter(|s| s.position == k.1).unwrap_or_default();
                (s.position, s.loading, s.error) = (k.1.clone(), true, None);
                b.current = Some(s.clone());
                let _ = app.emit("ban-suggestions", Some(s));
                b.round
            }
        }
    };
    let app = app.clone();
    let view = view.clone();
    tauri::async_runtime::spawn(async move {
        let result = lookup(&app, &view).await;
        let bans = app.state::<Bans>();
        let mut b = bans.inner.lock().await;
        if b.round != round {
            return;
        }
        let s = match result {
            Ok(s) => s,
            Err(e) => {
                let mut s = b.current.clone().unwrap_or_default();
                (s.loading, s.error) = (false, Some(format!("{e:#}")));
                s
            }
        };
        b.current = Some(s.clone());
        let _ = app.emit("ban-suggestions", Some(s));
    });
}

/// Champ select is over: forgets the bans and your records.
pub async fn clear(app: &AppHandle) {
    let bans = app.state::<Bans>();
    let mut b = bans.inner.lock().await;
    b.round += 1;
    (b.key, b.records) = (None, None);
    if b.current.take().is_some() {
        let _ = app.emit("ban-suggestions", Option::<BanSuggestions>::None);
    }
}

pub async fn current(app: &AppHandle) -> Option<BanSuggestions> {
    app.state::<Bans>().inner.lock().await.current.clone()
}

async fn lookup(app: &AppHandle, view: &ChampSelectView) -> Result<BanSuggestions> {
    let state = app.state::<AppState>();
    let position = view.my_position.to_lowercase();
    let (names, lcu) = {
        let sh = state.shared.lock().await;
        (sh.champ_names(), sh.lcu.clone())
    };
    let known = app.state::<Bans>().inner.lock().await.records.clone();
    let history = async {
        match (known, lcu.as_ref()) {
            (Some(r), _) => Some(r),
            (None, Some(l)) => match tokio::time::timeout(HISTORY_WAIT, profile::my_recent_games(l)).await {
                Ok(Ok(games)) => {
                    let r = records(&games);
                    app.state::<Bans>().inner.lock().await.records = Some(r.clone());
                    Some(r)
                }
                Ok(Err(e)) => {
                    eprintln!("ban suggestions without match history: {e:#}");
                    None
                }
                Err(_) => None,
            },
            (None, None) => None,
        }
    };
    let (rank, my_rank) = crate::picks::suggestion_rank(app, view.queue_id).await;
    let (tiers, records) = tokio::join!(state.tiers.get(Source::Lolalytics, &position, &rank, names), history);
    let tiers = tiers?;
    Ok(BanSuggestions {
        position,
        loading: false,
        error: None,
        personal: records.is_some(),
        rank,
        my_rank,
        bans: self::rank(&tiers.entries, &taken(view), &records.unwrap_or_default()),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::engine::CsPlayer;

    fn tier(id: i64, win_rate: f64, pick_rate: f64) -> TierEntry {
        TierEntry {
            champion_id: id,
            name: String::new(),
            tier: "A".into(),
            label: "A".into(),
            rank: 0,
            rank_change: None,
            win_rate,
            pick_rate,
            ban_rate: 3.0,
            games: 5000,
        }
    }

    #[test]
    fn records_count_lane_opponents_and_enemies() {
        let games: [(&str, Option<i64>, &[i64]); 4] = [
            ("loss", Some(238), &[238, 64]),
            ("loss", Some(238), &[]),
            ("win", None, &[64]),
            ("remake", Some(238), &[238]),
        ];
        let r = tally(games);
        assert_eq!(r[&238], Record { games: 2, wins: 0, lane_games: 2, lane_wins: 0 });
        assert_eq!(r[&64], Record { games: 2, wins: 1, lane_games: 0, lane_wins: 0 });
    }

    #[test]
    fn win_rate_first_with_a_small_nudge_for_your_losses() {
        let tiers = [tier(1, 53.0, 5.0), tier(2, 52.5, 6.0), tier(3, 51.0, 4.0), tier(4, 56.0, 0.6), tier(5, 54.0, 3.0)];
        // Lost 3 of 3 to champion 2 in lane: +1.5 (capped) lifts it over 1.
        let records = HashMap::from([
            (2, Record { games: 3, wins: 0, lane_games: 3, lane_wins: 0 }),
            // 1-1: no nudge.
            (3, Record { games: 2, wins: 1, lane_games: 0, lane_wins: 0 }),
        ]);
        let bans = rank(&tiers, &HashSet::from([5]), &records);
        let ids: Vec<i64> = bans.iter().map(|b| b.champion_id).collect();
        // 4 is too rarely picked, 5 is taken.
        assert_eq!(ids, [2, 1, 3]);
        assert!((bans[0].personal - MAX_PERSONAL).abs() < 1e-9);
        assert_eq!(bans[2].personal, 0.0);
        assert!((bans[1].win_rate - 0.53).abs() < 1e-9);
    }

    #[test]
    fn one_loss_is_a_tiny_nudge() {
        let r = Record { games: 2, wins: 0, lane_games: 1, lane_wins: 0 };
        // Two net losses anywhere; one lane game is too few to count.
        assert!((personal(&r) - 0.5).abs() < 1e-9);
    }

    #[test]
    fn only_while_your_ban_is_to_make() {
        let view = ChampSelectView {
            queue_id: 420,
            my_position: "MIDDLE".into(),
            ban_pending: true,
            allies: vec![CsPlayer { is_me: true, pick_intent: 103, ..Default::default() }, CsPlayer { pick_intent: 64, ..Default::default() }],
            enemies: vec![CsPlayer { champion_id: 238, ..Default::default() }],
            bans: vec![99],
            ..Default::default()
        };
        assert_eq!(key(&view, 11, ""), Some((420, "middle".into(), vec![64, 99, 103, 238], String::new())));
        assert_eq!(key(&ChampSelectView { ban_pending: false, ..view.clone() }, 11, ""), None);
        assert_eq!(key(&view, 12, ""), None);
        assert_eq!(key(&ChampSelectView { my_position: String::new(), ..view }, 11, ""), None);
    }
}
