//! LP over time, for the graph next to each rank on the Profile page.
//!
//! The League client keeps no LP history, so League Bro saves its own: a point
//! each time the profile loads with a different rank, LP or game count than
//! the last point, in `lp-history.json` in the app data folder (per player, by
//! PUUID). OP.GG's profile also has a few Solo/Duo points (`lp_histories`, one
//! for each day OP.GG updated the player), which are merged in whenever the
//! profile comes from OP.GG, so the graph doesn't always start empty.
//!
//! The same points give each ranked game's LP gain or loss (`LpChange`): two
//! points in a row whose game counts are one apart bracket exactly one game,
//! and the ranked game that started between them gets the difference. So a
//! game only gets one when League Bro saw the rank before and after it (a
//! point is also saved when champ select starts and right after each game).

use crate::cache::DiskCache;
use crate::profile::{MatchLine, MyProfile};
use crate::scout::RankLine;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;

const FILE: &str = "lp-history.json";
/// Points kept per queue; the oldest go first.
const MAX_POINTS: usize = 300;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LpPoint {
    /// Unix ms.
    pub at: i64,
    pub tier: String,
    /// "I"–"IV", empty for Master and up.
    pub division: String,
    pub lp: i64,
    /// Wins + losses then; unknown for OP.GG's points.
    #[serde(default)]
    pub games: Option<i64>,
}

impl LpPoint {
    pub fn from_rank(r: &RankLine, at: i64) -> LpPoint {
        LpPoint { at, tier: r.tier.clone(), division: r.division.clone(), lp: r.lp, games: Some(r.wins + r.losses) }
    }

    /// Another rank, LP, or (when both are known) number of games.
    fn differs(&self, new: &LpPoint) -> bool {
        (&self.tier, &self.division, self.lp) != (&new.tier, &new.division, new.lp)
            || matches!((self.games, new.games), (Some(a), Some(b)) if a != b)
    }
}

const TIERS: [&str; 7] = ["IRON", "BRONZE", "SILVER", "GOLD", "PLATINUM", "EMERALD", "DIAMOND"];
const DIVISIONS: [&str; 4] = ["IV", "III", "II", "I"];

/// One number per rank: 100 per division, Master and up stacked on top of
/// Diamond I (they share one LP count). Same as the UI's LP graph.
fn score(p: &LpPoint) -> i64 {
    match TIERS.iter().position(|t| p.tier.eq_ignore_ascii_case(t)) {
        Some(t) => t as i64 * 400 + DIVISIONS.iter().position(|d| *d == p.division).unwrap_or(0) as i64 * 100 + p.lp,
        None => TIERS.len() as i64 * 400 + p.lp,
    }
}

/// The LP one ranked game gained or lost, and the rank it left you at.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LpChange {
    /// Across a promotion or demotion each division counts as 100 LP, so this
    /// is the real gain or loss except where demotion puts you back at 75 LP.
    pub delta: i64,
    pub tier: String,
    pub division: String,
    pub lp: i64,
    /// "up" or "down" when the game changed your division or tier, else "".
    pub moved: &'static str,
}

/// The game that started at `created` (unix ms) between two points a game
/// apart, as an `LpChange`.
fn change_for(points: &[LpPoint], created: i64) -> Option<LpChange> {
    points.windows(2).find_map(|w| {
        let (a, b) = (&w[0], &w[1]);
        let one_game = matches!((a.games, b.games), (Some(x), Some(y)) if y == x + 1);
        (one_game && a.at < created && created < b.at).then(|| {
            let same = a.tier.eq_ignore_ascii_case(&b.tier) && a.division == b.division;
            let delta = score(b) - score(a);
            let moved = if same { "" } else if delta > 0 { "up" } else { "down" };
            LpChange { delta, tier: b.tier.clone(), division: b.division.clone(), lp: b.lp, moved }
        })
    })
}

/// Oldest first.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LpHistory {
    pub solo: Vec<LpPoint>,
    pub flex: Vec<LpPoint>,
}

impl LpHistory {
    /// The points for a ranked queue id (420 Solo/Duo, 440 Flex).
    fn queue(&self, queue_id: i64) -> Option<&[LpPoint]> {
        match queue_id {
            420 => Some(&self.solo),
            440 => Some(&self.flex),
            _ => None,
        }
    }

    /// The LP change of a ranked game that started at `created` (unix ms).
    pub fn change(&self, queue_id: i64, created: i64) -> Option<LpChange> {
        change_for(self.queue(queue_id)?, created)
    }

    /// Puts the LP change on each ranked match. Remakes get none and don't
    /// count (they aren't in the game count either), and two games of that
    /// queue between the same points get none, since it isn't clear which one
    /// the LP belongs to.
    pub fn fill(&self, matches: &mut [MatchLine]) {
        let starts: Vec<(i64, i64)> = matches.iter().filter(|m| m.result != "remake").map(|m| (m.queue_id, m.created)).collect();
        for m in matches.iter_mut() {
            if m.result == "remake" {
                m.lp_change = None;
                continue;
            }
            m.lp_change = self.queue(m.queue_id).and_then(|points| {
                let c = change_for(points, m.created)?;
                let i = points.iter().rposition(|p| p.at < m.created)?;
                let (from, to) = (points[i].at, points[i + 1].at);
                let shared = starts.iter().filter(|(q, t)| *q == m.queue_id && from < *t && *t < to).count();
                (shared == 1).then_some(c)
            });
        }
    }
}

/// Adds the current rank to a queue's points unless it's the same as the
/// newest point at or before `now`, then merges in `known` (OP.GG's points),
/// skipping any with a time already there.
fn merge(points: &mut Vec<LpPoint>, current: Option<LpPoint>, known: &[LpPoint]) {
    for k in known {
        if !points.iter().any(|p| p.at == k.at) {
            points.push(k.clone());
        }
    }
    points.sort_by_key(|p| p.at);
    if let Some(cur) = current {
        let before = points.iter().rev().find(|p| p.at <= cur.at);
        match before {
            Some(p) if p.at == cur.at => {}
            Some(p) if !p.differs(&cur) => {}
            _ => {
                points.push(cur);
                points.sort_by_key(|p| p.at);
            }
        }
    }
    if points.len() > MAX_POINTS {
        points.drain(..points.len() - MAX_POINTS);
    }
}

/// Saved histories, one per player.
pub struct LpStore {
    disk: DiskCache,
    lock: std::sync::Mutex<()>,
}

impl LpStore {
    pub fn new(dir: Option<PathBuf>) -> LpStore {
        LpStore { disk: DiskCache { dir }, lock: std::sync::Mutex::new(()) }
    }

    /// Saves the profile's ranks, plus the Solo/Duo points already on it
    /// (OP.GG's), then puts the player's whole history on the profile. A
    /// profile from OP.GG is dated when OP.GG last updated it, not now.
    pub fn record(&self, p: &mut MyProfile) {
        let known = std::mem::take(&mut p.lp_history.solo);
        let at = p.updated_at.unwrap_or_else(now_ms);
        if let Some(h) = self.save(&p.puuid, p.solo.as_ref(), p.flex.as_ref(), &known, at) {
            h.fill(&mut p.matches);
            p.lp_history = h;
        }
    }

    /// The player's saved history.
    pub fn history(&self, puuid: &str) -> LpHistory {
        let _guard = self.lock.lock().unwrap();
        let mut all: HashMap<String, LpHistory> = self.disk.read(FILE).unwrap_or_default();
        all.remove(puuid).unwrap_or_default()
    }

    /// Saves the client's ranks right after a game, so the graph gets a point
    /// per game even when the Profile page isn't opened in between, and when
    /// champ select starts, so the next game has a point before it.
    pub fn record_ranks(&self, puuid: &str, solo: Option<&RankLine>, flex: Option<&RankLine>) -> Option<LpHistory> {
        self.save(puuid, solo, flex, &[], now_ms())
    }

    /// The player's history after adding these ranks.
    fn save(&self, puuid: &str, solo: Option<&RankLine>, flex: Option<&RankLine>, known: &[LpPoint], at: i64) -> Option<LpHistory> {
        if puuid.is_empty() {
            return None;
        }
        let _guard = self.lock.lock().unwrap();
        let mut all: HashMap<String, LpHistory> = self.disk.read(FILE).unwrap_or_default();
        let h = all.entry(puuid.to_string()).or_default();
        let before = h.clone();
        merge(&mut h.solo, solo.map(|r| LpPoint::from_rank(r, at)), known);
        merge(&mut h.flex, flex.map(|r| LpPoint::from_rank(r, at)), &[]);
        let out = h.clone();
        if out != before {
            self.disk.write(FILE, &all);
        }
        Some(out)
    }
}

fn now_ms() -> i64 {
    crate::cache::now_secs() as i64 * 1000
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pt(at: i64, tier: &str, division: &str, lp: i64, games: Option<i64>) -> LpPoint {
        LpPoint { at, tier: tier.into(), division: division.into(), lp, games }
    }

    #[test]
    fn adds_a_point_only_when_something_changed() {
        let mut v = Vec::new();
        merge(&mut v, Some(pt(10, "GOLD", "III", 30, Some(35))), &[]);
        merge(&mut v, Some(pt(20, "GOLD", "III", 30, Some(35))), &[]);
        assert_eq!(v.len(), 1);
        merge(&mut v, Some(pt(30, "GOLD", "III", 52, Some(36))), &[]);
        // Same LP after a remake-like game: the game count still moved.
        merge(&mut v, Some(pt(40, "GOLD", "III", 52, Some(37))), &[]);
        assert_eq!(v.iter().map(|p| p.at).collect::<Vec<_>>(), [10, 30, 40]);
    }

    #[test]
    fn merges_opgg_points_in_time_order_without_repeats() {
        let mut v = vec![pt(50, "GOLD", "III", 30, Some(35))];
        let known = [pt(20, "SILVER", "II", 90, None), pt(50, "GOLD", "III", 30, None)];
        merge(&mut v, Some(pt(50, "GOLD", "III", 30, Some(35))), &known);
        merge(&mut v, None, &known);
        assert_eq!(v.iter().map(|p| (p.at, p.tier.as_str())).collect::<Vec<_>>(), [(20, "SILVER"), (50, "GOLD")]);
    }

    #[test]
    fn keeps_the_newest_points() {
        let mut v: Vec<LpPoint> = (0..MAX_POINTS as i64).map(|i| pt(i, "GOLD", "IV", i % 100, None)).collect();
        merge(&mut v, Some(pt(1_000, "GOLD", "I", 0, Some(1))), &[]);
        assert_eq!(v.len(), MAX_POINTS);
        assert_eq!((v[0].at, v.last().unwrap().at), (1, 1_000));
    }

    #[test]
    fn lp_change_needs_points_one_game_apart_around_the_game() {
        let h = LpHistory {
            solo: vec![
                pt(10, "GOLD", "II", 80, Some(20)),
                pt(30, "GOLD", "I", 2, Some(21)),
                pt(50, "GOLD", "I", 2, Some(21)),
                pt(70, "GOLD", "I", 0, Some(23)),
                pt(90, "GOLD", "II", 75, Some(24)),
            ],
            flex: Vec::new(),
        };
        let c = h.change(420, 20).unwrap();
        assert_eq!((c.delta, c.tier.as_str(), c.division.as_str(), c.lp, c.moved), (22, "GOLD", "I", 2, "up"));
        // Two games between the points: unknown.
        assert_eq!(h.change(420, 60), None);
        let c = h.change(420, 80).unwrap();
        assert_eq!((c.delta, c.moved), (-25, "down"));
        assert_eq!(h.change(440, 20), None);
        assert_eq!(h.change(420, 5), None);
    }

    #[test]
    fn master_and_up_share_one_lp_count() {
        assert_eq!(score(&pt(0, "MASTER", "", 15, None)) - score(&pt(0, "DIAMOND", "I", 90, None)), 25);
    }

    #[test]
    fn fill_skips_points_with_two_games_between() {
        let h = LpHistory { solo: vec![pt(10, "GOLD", "II", 50, Some(5)), pt(40, "GOLD", "II", 70, Some(6))], flex: Vec::new() };
        let m = |created| MatchLine {
            game_id: created,
            queue_id: 420,
            game_mode: "CLASSIC".into(),
            created,
            duration: 1800,
            result: "win".into(),
            line: Default::default(),
            lane_opponent: None,
            enemies: Vec::new(),
            teams: Vec::new(),
            lp_change: None,
        };
        let mut one = vec![m(20)];
        h.fill(&mut one);
        assert_eq!(one[0].lp_change.as_ref().map(|c| c.delta), Some(20));
        let mut two = vec![m(30), m(20)];
        h.fill(&mut two);
        assert!(two.iter().all(|m| m.lp_change.is_none()));
        // A remake between the same points doesn't hide the real game's LP.
        let mut remake = vec![m(30), m(20)];
        remake[1].result = "remake".into();
        h.fill(&mut remake);
        assert_eq!(remake.iter().map(|m| m.lp_change.as_ref().map(|c| c.delta)).collect::<Vec<_>>(), [Some(20), None]);
    }

    #[test]
    fn saves_and_puts_history_on_the_profile() {
        let dir = std::env::temp_dir().join(format!("leaguebro-lp-test-{}", std::process::id()));
        let store = LpStore::new(Some(dir.clone()));
        let rank = |lp| RankLine { tier: "GOLD".into(), division: "II".into(), lp, wins: 10, losses: 9 };
        let opgg = LpHistory { solo: vec![pt(50, "GOLD", "III", 80, None)], flex: Vec::new() };
        let mut p = MyProfile { puuid: "me".into(), solo: Some(rank(40)), updated_at: Some(100), lp_history: opgg, ..Default::default() };
        store.record(&mut p);
        assert_eq!(p.lp_history.solo.len(), 2);
        let mut again = MyProfile { puuid: "me".into(), solo: Some(rank(40)), updated_at: Some(200), ..Default::default() };
        LpStore::new(Some(dir.clone())).record(&mut again);
        assert_eq!(again.lp_history, p.lp_history);
        assert!(again.lp_history.flex.is_empty());
        let _ = std::fs::remove_dir_all(dir);
    }
}
