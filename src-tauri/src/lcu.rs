//! League Client (LCU) connection.
//!
//! The League client runs a local HTTPS server on 127.0.0.1 with a random
//! port and password. Both are found either on the command line of the
//! `LeagueClientUx` process or in the `lockfile` in the install folder.

use anyhow::{anyhow, Context, Result};
use base64::Engine as _;
use reqwest::{Client, Method, StatusCode};
use serde_json::Value;
use std::path::{Path, PathBuf};
use std::time::Duration;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Credentials {
    pub port: u16,
    pub password: String,
}

/// Parses `LeagueClient:<pid>:<port>:<password>:https`.
pub fn parse_lockfile(text: &str) -> Option<Credentials> {
    let parts: Vec<&str> = text.trim().split(':').collect();
    if parts.len() < 5 {
        return None;
    }
    let port = parts[2].parse().ok()?;
    let password = parts[3].to_string();
    if password.is_empty() {
        return None;
    }
    Some(Credentials { port, password })
}

/// Pulls `--app-port=` and `--remoting-auth-token=` out of a process command line.
pub fn parse_cmdline(args: &[String]) -> (Option<Credentials>, Option<String>) {
    let mut port = None;
    let mut token = None;
    let mut install = None;
    for a in args {
        let a = a.trim_matches('"');
        if let Some(v) = a.strip_prefix("--app-port=") {
            port = v.parse::<u16>().ok();
        } else if let Some(v) = a.strip_prefix("--remoting-auth-token=") {
            token = Some(v.to_string());
        } else if let Some(v) = a.strip_prefix("--install-directory=") {
            install = Some(v.to_string());
        }
    }
    let creds = match (port, token) {
        (Some(port), Some(password)) if !password.is_empty() => Some(Credentials { port, password }),
        _ => None,
    };
    (creds, install)
}

fn find_from_process() -> (Option<Credentials>, Option<String>) {
    use sysinfo::{ProcessRefreshKind, ProcessesToUpdate, System, UpdateKind};
    let mut sys = System::new();
    sys.refresh_processes_specifics(
        ProcessesToUpdate::All,
        true,
        ProcessRefreshKind::nothing().with_cmd(UpdateKind::Always),
    );
    for p in sys.processes().values() {
        let name = p.name().to_string_lossy().to_lowercase();
        if name.starts_with("leagueclientux") && !name.contains("render") {
            let args: Vec<String> = p.cmd().iter().map(|s| s.to_string_lossy().into_owned()).collect();
            let found = parse_cmdline(&args);
            if found.0.is_some() || found.1.is_some() {
                return found;
            }
        }
    }
    (None, None)
}

fn lockfile_candidates(install_hint: Option<&str>) -> Vec<PathBuf> {
    let mut v = Vec::new();
    if let Some(dir) = install_hint {
        v.push(Path::new(dir).join("lockfile"));
    }
    for drive in ["C", "D", "E", "F"] {
        v.push(PathBuf::from(format!(r"{drive}:\Riot Games\League of Legends\lockfile")));
        v.push(PathBuf::from(format!(r"{drive}:\Games\Riot Games\League of Legends\lockfile")));
    }
    v
}

/// Finds the running client's credentials, or None if League isn't open.
pub fn discover(configured_install_dir: Option<&str>) -> Option<Credentials> {
    let (creds, install_from_cmd) = find_from_process();
    if creds.is_some() {
        return creds;
    }
    // Process command line wasn't readable (e.g. the client runs as admin);
    // fall back to the lockfile.
    let hint = configured_install_dir.map(str::to_string).or(install_from_cmd);
    for path in lockfile_candidates(hint.as_deref()) {
        if let Ok(text) = std::fs::read_to_string(&path) {
            if let Some(c) = parse_lockfile(&text) {
                return Some(c);
            }
        }
    }
    None
}

/// Builds an HTTP client for the client's self-signed localhost certificates.
/// It is only ever pointed at 127.0.0.1, never at the internet.
pub fn localhost_http_client() -> Client {
    Client::builder()
        .danger_accept_invalid_certs(true)
        .no_proxy()
        .timeout(Duration::from_secs(8))
        .build()
        .expect("http client")
}

#[derive(Clone)]
pub struct Lcu {
    base: String,
    auth: String,
    http: Client,
}

impl Lcu {
    pub fn new(creds: &Credentials) -> Lcu {
        let token = base64::engine::general_purpose::STANDARD.encode(format!("riot:{}", creds.password));
        Lcu {
            base: format!("https://127.0.0.1:{}", creds.port),
            auth: format!("Basic {token}"),
            http: localhost_http_client(),
        }
    }

    async fn send(&self, method: Method, path: &str, body: Option<&Value>) -> Result<Option<Value>> {
        let mut req = self
            .http
            .request(method.clone(), format!("{}{}", self.base, path))
            .header("Authorization", &self.auth)
            .header("Accept", "application/json");
        if let Some(b) = body {
            req = req.json(b);
        }
        let resp = req.send().await.with_context(|| format!("{method} {path}"))?;
        let status = resp.status();
        if status == StatusCode::NOT_FOUND {
            return Ok(None);
        }
        let text = resp.text().await.unwrap_or_default();
        if !status.is_success() {
            let snippet: String = text.chars().take(300).collect();
            return Err(anyhow!("{method} {path} returned {status}: {snippet}"));
        }
        if text.trim().is_empty() {
            return Ok(Some(Value::Null));
        }
        Ok(Some(serde_json::from_str(&text).unwrap_or(Value::String(text))))
    }

    /// GET that returns None on 404 (e.g. "not in champ select").
    pub async fn get(&self, path: &str) -> Result<Option<Value>> {
        self.send(Method::GET, path, None).await
    }

    pub async fn get_req(&self, path: &str) -> Result<Value> {
        self.get(path).await?.ok_or_else(|| anyhow!("GET {path} returned 404"))
    }

    pub async fn post(&self, path: &str, body: &Value) -> Result<Value> {
        Ok(self.send(Method::POST, path, Some(body)).await?.unwrap_or(Value::Null))
    }

    pub async fn put(&self, path: &str, body: &Value) -> Result<Value> {
        Ok(self.send(Method::PUT, path, Some(body)).await?.unwrap_or(Value::Null))
    }

    pub async fn patch(&self, path: &str, body: &Value) -> Result<Value> {
        Ok(self.send(Method::PATCH, path, Some(body)).await?.unwrap_or(Value::Null))
    }

    pub async fn delete(&self, path: &str) -> Result<()> {
        self.send(Method::DELETE, path, None).await.map(|_| ())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lockfile() {
        let c = parse_lockfile("LeagueClient:12345:54321:AbC-dEf_123:https\n").unwrap();
        assert_eq!(c.port, 54321);
        assert_eq!(c.password, "AbC-dEf_123");
        assert!(parse_lockfile("garbage").is_none());
    }

    #[test]
    fn cmdline() {
        let args: Vec<String> = [
            r#"C:\Riot Games\League of Legends\LeagueClientUx.exe"#,
            "--riotclient-auth-token=zzz",
            "--app-port=60000",
            "\"--remoting-auth-token=tok123\"",
            r#"--install-directory=C:\Riot Games\League of Legends"#,
        ]
        .iter()
        .map(|s| s.to_string())
        .collect();
        let (c, dir) = parse_cmdline(&args);
        assert_eq!(c, Some(Credentials { port: 60000, password: "tok123".into() }));
        assert_eq!(dir.as_deref(), Some(r"C:\Riot Games\League of Legends"));
    }
}
