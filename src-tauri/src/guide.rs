//! Beginner guides for the Champions tab's Guide view: what a champion does,
//! how hard it is, each ability with Riot's own preview clip, and tips for
//! playing as and against it.
//!
//! - The kit comes from the League client's `lol-game-data/assets/v1/champions/{id}.json`
//!   (CommunityDragon's copy while the client is closed): `tacticalInfo`
//!   (difficulty 1–3, damage and attack type), `playstyleInfo` (0–3 ratings),
//!   `shortBio`, `passive` and `spells`. Each ability has an
//!   `abilityVideoPath` like `champion-abilities/0103/ability_0103_Q1.webm`,
//!   the clip leagueoflegends.com's champion pages play, served from
//!   `ABILITY_VIDEOS` (checked October 2026: `.webm`, `.mp4` and the `.jpg`
//!   poster all answer).
//! - The tips are Riot's `allytips` / `enemytips` from Data Dragon's
//!   champion file (`ddragon.leagueoflegends.com`, keyed by the client alias).
//!   The client's files don't have them. Missing tips aren't an error.
//!
//! Guides are kept in memory for the session; they only change with a patch.

use crate::engine::plain_text;
use crate::lcu::Lcu;
use crate::opgg::damage_label;
use crate::util::{get_json, int, list, strings, text, web_client, CDRAGON_GAME_DATA};
use anyhow::{Context, Result};
use serde::Serialize;
use serde_json::Value;
use std::collections::HashMap;
use tokio::sync::Mutex;

/// Riot's CDN for the ability preview clips on leagueoflegends.com.
const ABILITY_VIDEOS: &str = "https://d28xe8vt774jo5.cloudfront.net";
const DDRAGON: &str = "https://ddragon.leagueoflegends.com";

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Guide {
    pub champion_id: i64,
    pub name: String,
    /// "the Nine-Tailed Fox".
    pub title: String,
    pub bio: String,
    /// Riot's 1 (easy) to 3 (hard); 0 when unknown.
    pub difficulty: i64,
    /// "AD", "AP", "BOTH" or "".
    pub damage_type: String,
    /// "melee" or "ranged".
    pub attack_type: String,
    pub roles: Vec<String>,
    pub playstyle: Playstyle,
    /// Passive first, then Q, W, E, R.
    pub abilities: Vec<Ability>,
    /// Riot's tips for playing the champion.
    pub tips: Vec<String>,
    /// Riot's tips for playing against it.
    pub counter_tips: Vec<String>,
}

/// The client's 0–3 ratings (the champion page's bars).
#[derive(Debug, Clone, Serialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct Playstyle {
    pub damage: i64,
    pub durability: i64,
    pub crowd_control: i64,
    pub mobility: i64,
    pub utility: i64,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Ability {
    /// "P", "Q", "W", "E" or "R".
    pub key: String,
    pub name: String,
    pub description: String,
    /// Client asset path (the UI maps it to CommunityDragon).
    pub icon: String,
    /// Full URLs; None when Riot has no clip for it.
    pub video: Option<String>,
    pub poster: Option<String>,
}

pub struct Guides {
    http: reqwest::Client,
    cache: Mutex<HashMap<i64, Guide>>,
    ddragon_version: Mutex<Option<String>>,
}

impl Guides {
    pub fn new() -> Self {
        Self { http: web_client(10), cache: Mutex::new(HashMap::new()), ddragon_version: Mutex::new(None) }
    }

    pub async fn get(&self, champion_id: i64, alias: &str, lcu: Option<&Lcu>) -> Result<Guide> {
        if let Some(g) = self.cache.lock().await.get(&champion_id) {
            return Ok(g.clone());
        }
        let file = format!("champions/{champion_id}.json");
        let (kit, tips) = tokio::join!(
            async {
                match lcu {
                    Some(lcu) => lcu.get_req(&format!("/lol-game-data/assets/v1/{file}")).await,
                    None => get_json(self.http.get(format!("{CDRAGON_GAME_DATA}/{file}")), "CommunityDragon").await,
                }
            },
            self.tips(alias)
        );
        let mut guide = parse_kit(&kit.context("couldn't load the champion's abilities")?);
        match tips {
            Ok((tips, counter)) => (guide.tips, guide.counter_tips) = (tips, counter),
            Err(e) => eprintln!("Champion tips for {alias} failed: {e:#}"),
        }
        self.cache.lock().await.insert(champion_id, guide.clone());
        Ok(guide)
    }

    async fn tips(&self, alias: &str) -> Result<(Vec<String>, Vec<String>)> {
        let version = self.ddragon_version().await?;
        let v = get_json(self.http.get(format!("{DDRAGON}/cdn/{version}/data/en_US/champion/{alias}.json")), "Data Dragon").await?;
        Ok(parse_tips(&v, alias))
    }

    async fn ddragon_version(&self) -> Result<String> {
        let mut known = self.ddragon_version.lock().await;
        if let Some(v) = known.as_ref() {
            return Ok(v.clone());
        }
        let versions = get_json(self.http.get(format!("{DDRAGON}/api/versions.json")), "Data Dragon").await?;
        let v = versions.get(0).and_then(Value::as_str).context("Data Dragon listed no versions")?.to_string();
        *known = Some(v.clone());
        Ok(v)
    }
}

fn parse_kit(v: &Value) -> Guide {
    let ability = |key: &str, a: &Value| {
        let clip = |k: &str| Some(text(a, k)).filter(|p| !p.is_empty()).map(|p| format!("{ABILITY_VIDEOS}/{p}"));
        Ability {
            key: key.to_string(),
            name: text(a, "name").to_string(),
            description: plain_text(text(a, "description")).trim().to_string(),
            icon: text(a, "abilityIconPath").to_string(),
            video: clip("abilityVideoPath"),
            poster: clip("abilityVideoImagePath"),
        }
    };
    let mut abilities = vec![ability("P", &v["passive"])];
    abilities.extend(list(v, "spells").iter().map(|s| ability(&text(s, "spellKey").to_uppercase(), s)));
    Guide {
        champion_id: int(v, "id"),
        name: text(v, "name").to_string(),
        title: text(v, "title").to_string(),
        bio: plain_text(text(v, "shortBio")).trim().to_string(),
        difficulty: int(v, "/tacticalInfo/difficulty"),
        damage_type: damage_label(text(v, "/tacticalInfo/damageType")).to_string(),
        attack_type: text(v, "/tacticalInfo/attackType").to_string(),
        roles: strings(v, "roles"),
        playstyle: Playstyle {
            damage: int(v, "/playstyleInfo/damage"),
            durability: int(v, "/playstyleInfo/durability"),
            crowd_control: int(v, "/playstyleInfo/crowdControl"),
            mobility: int(v, "/playstyleInfo/mobility"),
            utility: int(v, "/playstyleInfo/utility"),
        },
        abilities,
        tips: Vec::new(),
        counter_tips: Vec::new(),
    }
}

/// Data Dragon's `data.<alias>.allytips` / `enemytips`.
fn parse_tips(v: &Value, alias: &str) -> (Vec<String>, Vec<String>) {
    let c = &v["data"][alias];
    let clean = |k: &str| strings(c, k).iter().map(|t| plain_text(t).trim().to_string()).filter(|t| !t.is_empty()).collect();
    (clean("allytips"), clean("enemytips"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn reads_the_client_champion_file() {
        let raw = std::fs::read_to_string(format!("{}/tests/fixtures/champion_ahri.json", env!("CARGO_MANIFEST_DIR"))).unwrap();
        let g = parse_kit(&serde_json::from_str(&raw).unwrap());
        assert_eq!(g.name, "Ahri");
        assert_eq!(g.title, "the Nine-Tailed Fox");
        assert_eq!(g.difficulty, 2);
        assert_eq!(g.damage_type, "AP");
        assert_eq!(g.attack_type, "ranged");
        assert_eq!(g.roles, ["mage", "assassin"]);
        assert_eq!(g.playstyle.mobility, 3);
        let keys: Vec<_> = g.abilities.iter().map(|a| a.key.as_str()).collect();
        assert_eq!(keys, ["P", "Q", "W", "E", "R"]);
        let p = &g.abilities[0];
        assert_eq!(p.name, "Essence Theft");
        assert_eq!(p.description, "After killing 9 minions or monsters, Ahri heals.\nAfter taking down an enemy champion, Ahri heals for a greater amount.");
        assert_eq!(p.video.as_deref(), Some("https://d28xe8vt774jo5.cloudfront.net/champion-abilities/0103/ability_0103_P1.webm"));
        assert_eq!(p.poster.as_deref(), Some("https://d28xe8vt774jo5.cloudfront.net/champion-abilities/0103/ability_0103_P1.jpg"));
    }

    #[test]
    fn missing_clip_is_none() {
        let g = parse_kit(&json!({ "passive": { "name": "X", "abilityVideoPath": "" }, "spells": [] }));
        assert_eq!(g.abilities[0].video, None);
    }

    #[test]
    fn reads_data_dragon_tips() {
        let v = json!({ "data": { "Ahri": {
            "allytips": ["Use Charm to set up your combos.", ""],
            "enemytips": ["Stay behind minions."]
        }}});
        let (tips, counter) = parse_tips(&v, "Ahri");
        assert_eq!(tips, ["Use Charm to set up your combos."]);
        assert_eq!(counter, ["Stay behind minions."]);
    }
}
