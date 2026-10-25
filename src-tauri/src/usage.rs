//! Anonymous usage stats: at most one "app_open" event per day, sent to
//! Aptabase, so we can see roughly how many people use League Bro.
//!
//! The event carries a random install ID (made up on this computer, not linked to
//! the Riot account), the app version and the Windows or macOS version. Nothing else:
//! no Riot ID, no games, no settings. Settings → Privacy turns it off.
//!
//! The Aptabase app key is baked in at build time from the `APTABASE_APP_KEY`
//! environment variable (the release workflow passes it from a repo secret).
//! Without it, nothing is ever sent.

use crate::engine::AppState;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};

const APP_KEY: Option<&str> = option_env!("APTABASE_APP_KEY");
/// How often a long-running app checks whether today's ping is still due.
const CHECK_EVERY: Duration = Duration::from_secs(6 * 3600);

/// Kept next to settings.json, apart from the settings the UI edits.
#[derive(Debug, Default, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
struct UsageState {
    install_id: String,
    /// Days since 1970-01-01 (UTC) of the last ping Aptabase accepted.
    last_sent_day: Option<u64>,
}

impl UsageState {
    fn load(path: &Path) -> UsageState {
        std::fs::read_to_string(path).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default()
    }

    fn save(&self, path: &Path) {
        if let Some(dir) = path.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        let _ = std::fs::write(path, serde_json::to_string_pretty(self).unwrap_or_default());
    }
}

/// Aptabase's server for a key like "A-EU-1234567890"; None for keys it can't route.
fn host_for(key: &str) -> Option<&'static str> {
    let parts: Vec<&str> = key.split('-').collect();
    match parts.as_slice() {
        ["A", "EU", _] => Some("https://eu.aptabase.com"),
        ["A", "US", _] => Some("https://us.aptabase.com"),
        _ => None,
    }
}

/// 32 random hex characters, from the std hasher's per-process random keys.
fn random_id() -> String {
    use std::hash::{BuildHasher, Hasher};
    let mut out = String::new();
    for i in 0..2u8 {
        let mut h = std::collections::hash_map::RandomState::new().build_hasher();
        h.write_u8(i);
        h.write_u128(SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_nanos());
        out.push_str(&format!("{:016x}", h.finish()));
    }
    out
}

/// "2026-10-24T21:45:04Z" for a Unix time in seconds.
fn rfc3339(secs: u64) -> String {
    let (days, rem) = (secs / 86400, secs % 86400);
    // Howard Hinnant's days-to-civil-date algorithm.
    let z = days as i64 + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + i64::from(m <= 2);
    format!("{y:04}-{m:02}-{d:02}T{:02}:{:02}:{:02}Z", rem / 3600, rem % 3600 / 60, rem % 60)
}

fn event(install_id: &str, now_secs: u64) -> serde_json::Value {
    json!([{
        "timestamp": rfc3339(now_secs),
        // The install ID doubles as the session, so Aptabase's session count
        // over a date range is the number of different installs.
        "sessionId": install_id,
        "eventName": "app_open",
        "systemProps": {
            "isDebug": cfg!(debug_assertions),
            "osName": if cfg!(target_os = "macos") { "macOS" } else { "Windows" },
            "osVersion": sysinfo::System::os_version().unwrap_or_default(),
            "locale": "",
            "appVersion": env!("CARGO_PKG_VERSION"),
            "sdkVersion": concat!("leaguebro@", env!("CARGO_PKG_VERSION")),
        },
        "props": {},
    }])
}

fn enabled(app: &AppHandle) -> bool {
    app.state::<AppState>().config().share_usage_stats
}

/// Sends today's ping if it's due, stats are on and the build has a key.
async fn ping_if_due(app: &AppHandle, path: &Path, client: &reqwest::Client, key: &str, host: &str) {
    if !enabled(app) {
        return;
    }
    let now = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs();
    let today = now / 86400;
    let mut state = UsageState::load(path);
    if state.last_sent_day == Some(today) {
        return;
    }
    if state.install_id.is_empty() {
        state.install_id = random_id();
        state.save(path);
    }
    let sent = client
        .post(format!("{host}/api/v0/events"))
        .header("App-Key", key)
        .json(&event(&state.install_id, now))
        .send()
        .await
        .is_ok_and(|r| r.status().is_success());
    if sent {
        state.last_sent_day = Some(today);
        state.save(path);
    }
}

/// Runs for the app's lifetime: pings at startup, then checks every few hours
/// so an app left open for days still counts once a day.
pub async fn run(app: AppHandle) {
    let Some((key, host)) = APP_KEY.filter(|k| !k.trim().is_empty()).and_then(|k| Some((k, host_for(k)?))) else {
        return;
    };
    let Ok(dir) = app.path().app_config_dir() else { return };
    let path: PathBuf = dir.join("usage.json");
    let client = crate::util::web_client(10);
    loop {
        ping_if_due(&app, &path, &client, key, host).await;
        tokio::time::sleep(CHECK_EVERY).await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn routes_keys_by_region() {
        assert_eq!(host_for("A-EU-1234567890"), Some("https://eu.aptabase.com"));
        assert_eq!(host_for("A-US-1234567890"), Some("https://us.aptabase.com"));
        assert_eq!(host_for("A-SH-1234567890"), None);
        assert_eq!(host_for("nonsense"), None);
    }

    #[test]
    fn formats_utc_timestamps() {
        assert_eq!(rfc3339(0), "1970-01-01T00:00:00Z");
        assert_eq!(rfc3339(1_792_878_304), "2026-10-24T21:45:04Z");
        assert_eq!(rfc3339(951_782_400), "2000-02-29T00:00:00Z");
    }

    #[test]
    fn install_ids_are_random_hex() {
        let (a, b) = (random_id(), random_id());
        assert_eq!(a.len(), 32);
        assert!(a.chars().all(|c| c.is_ascii_hexdigit()));
        assert_ne!(a, b);
    }

    #[test]
    fn event_has_nothing_personal() {
        let ev = event("abc", 0);
        let e = &ev[0];
        assert_eq!(e["eventName"], "app_open");
        assert_eq!(e["sessionId"], "abc");
        assert_eq!(e["props"], json!({}));
        let keys: Vec<&String> = e["systemProps"].as_object().unwrap().keys().collect();
        assert_eq!(keys.len(), 6);
    }
}
