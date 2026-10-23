//! User settings, stored as JSON in the app's config folder
//! (on Windows: %APPDATA%\dev.dom.leaguebro\settings.json).

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct TimerConfig {
    /// Seconds into the game when the first dragon spawns.
    pub first_dragon: f64,
    /// Seconds into the game when Baron first spawns.
    pub first_baron: f64,
    pub dragon_respawn: f64,
    pub elder_respawn: f64,
    pub baron_respawn: f64,
    pub inhib_respawn: f64,
}

impl Default for TimerConfig {
    fn default() -> Self {
        // Values match recent seasons; they are editable in Settings
        // because Riot adjusts objective timings between seasons.
        Self {
            first_dragon: 300.0,
            first_baron: 1200.0,
            dragon_respawn: 300.0,
            elder_respawn: 360.0,
            baron_respawn: 360.0,
            inhib_respawn: 300.0,
        }
    }
}

/// The keys the player has bound to their abilities, shown in place of
/// Q/W/E/R in skill orders. Display only; recommendations still use Q/W/E/R.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(default)]
pub struct AbilityKeys {
    pub q: String,
    pub w: String,
    pub e: String,
    pub r: String,
}

impl Default for AbilityKeys {
    fn default() -> Self {
        Self { q: "Q".into(), w: "W".into(), e: "E".into(), r: "R".into() }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Config {
    /// Import a rune page automatically when you lock in a champion.
    pub auto_import_runes: bool,
    /// Also import while hovering (before lock-in).
    pub import_on_hover: bool,
    /// If every rune page slot is used, overwrite the currently selected
    /// editable page instead of failing. Off by default because it
    /// replaces one of your own pages.
    pub reuse_current_page_when_full: bool,
    /// Where rune/spell/item/skill recommendations come from:
    /// "opgg" (OP.GG meta stats) or "client" (League's own rune suggestions only).
    pub rec_source: String,
    /// Set summoner spells from the recommendation when you lock in.
    pub set_summoner_spells: bool,
    /// Add the recommended build to the in-game shop as an item set when you lock in.
    pub set_item_sets: bool,
    /// Show the recommended item build's next items in the overlay.
    pub use_recommended_builds: bool,
    /// Show the skill max order and "level up" hint in the overlay.
    pub show_skill_hint: bool,
    /// Show objective timers in the overlay (the Live tab always shows them).
    pub show_timers: bool,
    /// Show your item value against your lane opponent's in the overlay.
    pub show_lane_diff: bool,
    /// Show the top situational item for this game in the overlay.
    pub show_situational: bool,
    pub ability_keys: AbilityKeys,
    pub scout_in_champ_select: bool,
    pub scout_on_loading: bool,
    pub overlay_enabled: bool,
    /// Overlay position in physical pixels; None = top-right corner.
    pub overlay_x: Option<i32>,
    pub overlay_y: Option<i32>,
    pub overlay_opacity: f64,
    pub timers: TimerConfig,
    /// Champion ids starred in the Champions tab, pinned to the top of its list.
    pub favorite_champions: Vec<i64>,
    /// League install folder, only needed if auto-detection fails.
    pub install_dir: Option<String>,
    /// Your Riot ID ("Name#TAG"), for the Profile page while the League
    /// client isn't running (looked up on OP.GG). Filled in from the client
    /// the first time the Profile page loads with it running.
    pub riot_id: Option<String>,
    /// OP.GG's region code for `riot_id` ("na", "euw", "kr"…).
    pub region: String,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            auto_import_runes: true,
            import_on_hover: false,
            reuse_current_page_when_full: false,
            rec_source: "opgg".into(),
            set_summoner_spells: true,
            set_item_sets: true,
            use_recommended_builds: true,
            show_skill_hint: true,
            show_timers: true,
            show_lane_diff: true,
            show_situational: true,
            ability_keys: AbilityKeys::default(),
            scout_in_champ_select: true,
            scout_on_loading: true,
            overlay_enabled: true,
            overlay_x: None,
            overlay_y: None,
            overlay_opacity: 0.9,
            timers: TimerConfig::default(),
            favorite_champions: Vec::new(),
            install_dir: None,
            riot_id: None,
            region: "na".into(),
        }
    }
}

impl Config {
    pub fn load(path: &Path) -> Config {
        match std::fs::read_to_string(path) {
            Ok(text) => serde_json::from_str(&text).unwrap_or_else(|e| {
                eprintln!("settings.json is invalid ({e}); using defaults");
                Config::default()
            }),
            Err(_) => Config::default(),
        }
    }

    pub fn save(&self, path: &Path) -> anyhow::Result<()> {
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir)?;
        }
        // Write to a temp file first so a crash never leaves a half-written file.
        let tmp: PathBuf = path.with_extension("json.tmp");
        std::fs::write(&tmp, serde_json::to_string_pretty(self)?)?;
        std::fs::rename(&tmp, path)?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn partial_json_fills_defaults() {
        let c: Config = serde_json::from_str(r#"{"autoImportRunes": false}"#).unwrap();
        assert!(!c.auto_import_runes);
        assert!(c.overlay_enabled);
        assert_eq!(c.rec_source, "opgg");
        assert_eq!(c.timers.baron_respawn, 360.0);
        assert_eq!(c.ability_keys.q, "Q");
        assert!(c.favorite_champions.is_empty());
        // Overlay parts added later default to shown.
        assert!(c.show_timers && c.show_lane_diff);
    }

    #[test]
    fn round_trip() {
        let dir = std::env::temp_dir().join(format!("leaguebro-test-{}", std::process::id()));
        let path = dir.join("settings.json");
        let mut c = Config::default();
        c.overlay_x = Some(1200);
        c.save(&path).unwrap();
        assert_eq!(Config::load(&path), c);
        let _ = std::fs::remove_dir_all(dir);
    }
}
