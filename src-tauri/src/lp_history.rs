//! LP over time, for the graph next to each rank on the Profile page.
//!
//! The League client keeps no LP history, so League Bro saves its own: a point
//! each time the profile loads with a different rank, LP or game count than
//! the last point, in `lp-history.json` in the app data folder (per player, by
//! PUUID). OP.GG's profile also has a few Solo/Duo points (`lp_histories`, one
//! for each day OP.GG updated the player), which are merged in whenever the
//! profile comes from OP.GG, so the graph doesn't always start empty.

use crate::cache::DiskCache;
use crate::profile::MyProfile;
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

/// Oldest first.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LpHistory {
    pub solo: Vec<LpPoint>,
    pub flex: Vec<LpPoint>,
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
            p.lp_history = h;
        }
    }

    /// Saves the client's ranks right after a game, so the graph gets a point
    /// per game even when the Profile page isn't opened in between.
    pub fn record_ranks(&self, puuid: &str, solo: Option<&RankLine>, flex: Option<&RankLine>) {
        self.save(puuid, solo, flex, &[], now_ms());
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
