//! Bug reports and ideas from the Feedback page, sent to League Bro's
//! feedback Worker (`feedback-worker/`, on Cloudflare), which posts each one as
//! a GitHub issue with its own token (contact info stays in its private inbox),
//! so players need no GitHub account and the app holds no GitHub token.

use crate::util::{msg, web_client};
use anyhow::{anyhow, Context};
use serde::Deserialize;
use serde_json::json;

/// The Worker's report endpoint. `LEAGUEBRO_FEEDBACK_URL` at build time
/// overrides it (e.g. a local `npm run dev` of the Worker).
const URL: &str = match option_env!("LEAGUEBRO_FEEDBACK_URL") {
    Some(url) => url,
    None => "https://leaguebro-feedback.eggomygriego.workers.dev/api/report",
};

/// What the Feedback page sends.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Report {
    /// "bug" or "idea".
    kind: String,
    /// Where it happened ("Champ select", "In game"…); empty for ideas.
    #[serde(default)]
    area: String,
    summary: String,
    #[serde(default)]
    details: String,
    /// How to reach the player, if they want a reply.
    #[serde(default)]
    contact: String,
    /// What the League client was doing; empty when the player unticked app details.
    #[serde(default)]
    client: String,
    include_details: bool,
}

pub async fn send(report: Report) -> Result<(), String> {
    let (version, os) = if report.include_details {
        let os = format!("{} {}", sysinfo::System::name().unwrap_or_default(), sysinfo::System::os_version().unwrap_or_default());
        (env!("CARGO_PKG_VERSION").to_string(), os.trim().to_string())
    } else {
        Default::default()
    };
    let body = json!({
        "kind": report.kind,
        "area": report.area,
        "summary": report.summary,
        "details": report.details,
        "contact": report.contact,
        "appVersion": version,
        "os": os,
        "client": if report.include_details { report.client } else { String::new() },
    });
    let resp = web_client(20)
        .post(URL)
        .json(&body)
        .send()
        .await
        .context("couldn't reach the League Bro server. Check your internet connection")
        .map_err(msg)?;
    if resp.status().is_success() {
        return Ok(());
    }
    // The Worker answers {"error": "..."} in words a player can read (e.g. too many reports).
    let status = resp.status();
    let text = resp.json::<serde_json::Value>().await.ok().and_then(|v| v["error"].as_str().map(str::to_string));
    Err(msg(anyhow!(text.unwrap_or_else(|| format!("the League Bro server answered {status}")))))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Sends a real report. Point it at a local Worker (`npm run dev` in
    /// feedback-worker/) so it doesn't land in the real inbox:
    /// `LEAGUEBRO_FEEDBACK_URL=http://localhost:8799/api/report cargo test live_feedback -- --ignored`
    #[tokio::test]
    #[ignore]
    async fn live_feedback() {
        let report: Report = serde_json::from_value(json!({
            "kind": "bug", "area": "In game / overlay", "summary": "Test report from cargo test",
            "details": "", "contact": "", "client": "League client not found", "includeDetails": true,
        }))
        .unwrap();
        send(report).await.unwrap();
    }
}
