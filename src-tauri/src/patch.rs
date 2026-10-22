//! Patch notes from Riot's website (leagueoflegends.com), turned into a list
//! of buffs, nerfs and adjustments per champion, item and rune.
//!
//! The site is a Next.js app: every page embeds its content as JSON in
//! `<script id="__NEXT_DATA__">`. The article body is HTML in a stable shape:
//!
//! ```text
//! <header class="header-primary"><h2>Champions</h2></header>
//! <div class="patch-change-block">
//!   <h3 class="change-title">Azir</h3>
//!   <blockquote class="context">Why Riot changed it…</blockquote>
//!   <h4 class="change-detail-title">Base Stats</h4>
//!   <ul><li><strong>Mana Growth</strong>: 40/Level ⇒ <strong>50/Level</strong></li></ul>
//! </div>
//! ```
//!
//! One block can hold several entries (the Items section separates them
//! with `<hr>` and a new `<h3>`), so entries start at each `<h3>`.
//!
//! Caching (on disk, `%LOCALAPPDATA%\dev.dom.leaguebuddy\patch-notes`):
//! - Each patch's parsed notes are saved the first time they're opened and
//!   never downloaded again.
//! - The list of patches is saved too, and only re-checked once the next
//!   patch's notes are due: the day before that patch in Riot's published
//!   schedule (`PATCH_SCHEDULE`), or the newest notes' date + 14 days once the
//!   schedule runs out. After that, at most every 6 hours until the new
//!   patch shows up (patches can slip).
//!
//! Nothing is fetched until the Patch Notes tab asks for it.

use anyhow::{anyhow, bail, Context, Result};
use scraper::{CaseSensitivity, ElementRef, Html, Selector};
use crate::cache::{now_secs, CacheUsage, DiskCache, Generation};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::sync::LazyLock;
use std::path::PathBuf;
use std::time::Duration;
use tokio::sync::Mutex;

const SITE: &str = "https://www.leagueoflegends.com";
const LIST_URL: &str = "https://www.leagueoflegends.com/en-us/news/tags/patch-notes/";
pub(crate) const DAY_SECS: u64 = 24 * 60 * 60;
/// Riot's usual cadence, used after the schedule below runs out.
const PATCH_EVERY_SECS: u64 = 14 * DAY_SECS;

/// Riot's published patch dates (Pacific Time), from
/// https://support.riotgames.com/league-of-legends/gameplay/patch-schedule-league-of-legends
/// Add next year's dates when Riot posts them; until then the 14-day
/// fallback is used. Riot can move dates; the 6-hour recheck covers delays.
const PATCH_SCHEDULE: &[(u32, u32, &str)] = &[
    (26, 1, "2026-01-08"),
    (26, 2, "2026-01-22"),
    (26, 3, "2026-02-04"),
    (26, 4, "2026-02-19"),
    (26, 5, "2026-03-04"),
    (26, 6, "2026-03-18"),
    (26, 7, "2026-04-01"),
    (26, 8, "2026-04-15"),
    (26, 9, "2026-04-29"),
    (26, 10, "2026-05-13"),
    (26, 11, "2026-05-28"),
    (26, 12, "2026-06-10"),
    (26, 13, "2026-06-24"),
    (26, 14, "2026-07-15"),
    (26, 15, "2026-07-29"),
    (26, 16, "2026-08-12"),
    (26, 17, "2026-08-26"),
    (26, 18, "2026-09-10"),
    (26, 19, "2026-09-23"),
    (26, 20, "2026-10-07"),
    (26, 21, "2026-10-21"),
    (26, 22, "2026-11-04"),
    (26, 23, "2026-11-18"),
    (26, 24, "2026-12-09"),
];

/// Notes go up the day before the patch (26.21's on Oct 20, 18:00 UTC).
/// Due from 12:00 UTC that day (early morning PT), so the 6-hour rechecks
/// catch them the same day.
const NOTES_BEFORE_PATCH_SECS: u64 = DAY_SECS - 12 * 60 * 60;

/// "26.21" -> (26, 21)
fn parse_version(v: &str) -> Option<(u32, u32)> {
    let (major, minor) = v.split_once('.')?;
    Some((major.parse().ok()?, minor.parse().ok()?))
}

/// When the notes for the first scheduled patch after `newest` should be out.
fn scheduled_notes_due(newest: (u32, u32)) -> Option<u64> {
    let &(_, _, date) = PATCH_SCHEDULE.iter().find(|(maj, min, _)| (*maj, *min) > newest)?;
    Some(iso_to_secs(date)? - NOTES_BEFORE_PATCH_SECS)
}

/// When the latest patch notes at or before `t` came out (`None` before the
/// schedule starts) and when the next ones are due. Past the end of the
/// schedule, patches are assumed every two weeks after the last listed one.
pub(crate) fn notes_releases_around(t: u64) -> (Option<u64>, u64) {
    let mut prev = None;
    for &(_, _, date) in PATCH_SCHEDULE {
        let Some(due) = iso_to_secs(date).map(|d| d - NOTES_BEFORE_PATCH_SECS) else { continue };
        if due > t {
            return (prev, due);
        }
        prev = Some(due);
    }
    // Schedule ran out: step two weeks at a time from the last listed patch.
    let last = prev.unwrap_or(t);
    let latest = last + (t - last) / PATCH_EVERY_SECS * PATCH_EVERY_SECS;
    (Some(latest), latest + PATCH_EVERY_SECS)
}
/// Once a new patch is due but not out yet, how often to look again.
const RECHECK_SECS: u64 = 6 * 60 * 60;
/// Bump when the parser or the saved shapes change, so old saved notes are
/// re-read from the site instead of shown in a stale format.
const CACHE_FORMAT: u32 = 1;
/// Sections that are store or system notices rather than gameplay changes.
const SKIP_SECTIONS: &[&str] = &["skins", "chromas", "system requirements", "mythic shop", "prestige"];

// CSS selectors are compiled once, not for every element.
static SEL_ARTICLE: LazyLock<Selector> = LazyLock::new(|| Selector::parse("h2, h3, h4, blockquote, li, p").unwrap());
static SEL_P: LazyLock<Selector> = LazyLock::new(|| Selector::parse("p").unwrap());
static SEL_STRONG: LazyLock<Selector> = LazyLock::new(|| Selector::parse("strong").unwrap());

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PatchInfo {
    /// e.g. "26.21"
    pub version: String,
    pub title: String,
    pub url: String,
    /// ISO date, e.g. "2026-10-20T18:00:00.000Z"
    pub published: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct ChangeLine {
    pub label: String,
    /// Empty when the line isn't a "before ⇒ after" change.
    pub before: String,
    pub after: String,
    /// The whole line, for lines without an arrow.
    pub text: String,
    /// "buff", "nerf" or "" when it can't be told from the numbers.
    pub effect: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct ChangeGroup {
    /// e.g. "Q - Piltover Peacemaker", "Base Stats"; empty for an item's own stats.
    pub title: String,
    pub lines: Vec<ChangeLine>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct PatchEntry {
    pub name: String,
    /// Riot's explanation of the change.
    pub context: String,
    /// "buff", "nerf", "adjusted", "new" (a new augment or returning kit),
    /// "removed", or "" for lists with no stat changes such as bug fixes.
    pub verdict: String,
    pub groups: Vec<ChangeGroup>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct PatchSection {
    pub title: String,
    /// "champion", "item", "rune" or "other": tells the UI which icons to use.
    pub kind: String,
    /// Intro text and plain bullet points that aren't tied to an entry.
    pub notes: Vec<String>,
    pub entries: Vec<PatchEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PatchNotes {
    pub info: PatchInfo,
    pub sections: Vec<PatchSection>,
}

// ---------- page data ----------

/// The JSON Riot embeds in every page.
fn next_data(html: &str) -> Result<Value> {
    let start_tag = html.find("<script id=\"__NEXT_DATA__\"").ok_or_else(|| anyhow!("page has no __NEXT_DATA__"))?;
    let start = start_tag + html[start_tag..].find('>').ok_or_else(|| anyhow!("bad script tag"))? + 1;
    let end = start + html[start..].find("</script>").ok_or_else(|| anyhow!("unterminated script tag"))?;
    serde_json::from_str(&html[start..end]).context("couldn't read the page data")
}

fn walk<'a>(v: &'a Value, f: &mut impl FnMut(&'a Value)) {
    f(v);
    match v {
        Value::Array(a) => a.iter().for_each(|x| walk(x, f)),
        Value::Object(o) => o.values().for_each(|x| walk(x, f)),
        _ => {}
    }
}

/// "League of Legends Patch 26.21 Notes" -> "26.21"
fn version_from(title: &str, url: &str) -> String {
    let find = |s: &str, sep: char| {
        let b = s.as_bytes();
        // char_indices, not 0..len: slicing a String in the middle of a
        // multi-byte character (é, –, ’) panics.
        s.char_indices().find_map(|(i, _)| {
            let rest = &s[i..];
            let major: String = rest.chars().take_while(char::is_ascii_digit).collect();
            if major.is_empty() || (i > 0 && b[i - 1].is_ascii_digit()) {
                return None;
            }
            let after = &rest[major.len()..];
            let after = after.strip_prefix(sep)?;
            let minor: String = after.chars().take_while(char::is_ascii_digit).collect();
            (!minor.is_empty()).then(|| format!("{major}.{minor}"))
        })
    };
    find(title, '.')
        .or_else(|| url.rsplit('/').find(|s| !s.is_empty()).and_then(|slug| find(slug, '-')))
        .unwrap_or_default()
}

/// Patch notes articles listed on the patch-notes tag page, newest first.
pub fn parse_list(html: &str) -> Result<Vec<PatchInfo>> {
    let data = next_data(html)?;
    let mut out: Vec<PatchInfo> = Vec::new();
    walk(&data, &mut |v| {
        let (Some(title), Some(url)) = (
            v.get("title").and_then(Value::as_str),
            v.pointer("/action/payload/url").and_then(Value::as_str),
        ) else {
            return;
        };
        if !url.contains("/game-updates/") || !url.contains("patch") || !url.contains("notes") {
            return;
        }
        let url = if url.starts_with("http") { url.to_string() } else { format!("{SITE}{url}") };
        if out.iter().any(|p| p.url == url) {
            return;
        }
        let published = v.get("publishedAt").and_then(Value::as_str).unwrap_or("").to_string();
        out.push(PatchInfo { version: version_from(title, &url), title: title.to_string(), url, published });
    });
    // TFT notes share the tag page on some locales.
    out.retain(|p| !p.title.to_ascii_lowercase().contains("teamfight"));
    out.sort_by(|a, b| b.published.cmp(&a.published));
    if out.is_empty() {
        bail!("no patch notes found on the page");
    }
    Ok(out)
}

/// The article's HTML body.
fn article_body(html: &str) -> Result<String> {
    let data = next_data(html)?;
    let mut bodies: Vec<&str> = Vec::new();
    walk(&data, &mut |v| {
        if let Some(b) = v.pointer("/richText/body").and_then(Value::as_str) {
            if b.contains("header-primary") || b.contains("patch-change-block") {
                bodies.push(b);
            }
        }
    });
    if bodies.is_empty() {
        bail!("couldn't find the patch notes in the page");
    }
    Ok(bodies.join("\n"))
}

// ---------- article parsing ----------

fn has_class(e: &ElementRef, class: &str) -> bool {
    e.value().has_class(class, CaseSensitivity::AsciiCaseInsensitive)
}

/// True when `e` sits inside an element named one of `names`.
fn inside(e: &ElementRef, names: &[&str]) -> bool {
    e.ancestors().filter_map(ElementRef::wrap).any(|a| names.contains(&a.value().name()))
}

fn text_of(e: &ElementRef) -> String {
    let raw: String = e.text().collect();
    raw.replace('\u{a0}', " ").split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Blockquotes keep their paragraph breaks.
fn paragraphs_of(e: &ElementRef) -> String {
    let paras: Vec<String> = e.select(&SEL_P).map(|x| text_of(&x)).filter(|t| !t.is_empty()).collect();
    if paras.is_empty() {
        text_of(e)
    } else {
        paras.join("\n\n")
    }
}

fn section_kind(title: &str) -> &'static str {
    let t = title.to_ascii_lowercase();
    if t.contains("champion") {
        "champion"
    } else if t.contains("item") {
        "item"
    } else if t.contains("rune") {
        "rune"
    } else {
        "other"
    }
}

fn numbers(s: &str) -> Vec<f64> {
    let mut out = Vec::new();
    let mut cur = String::new();
    for c in s.chars().chain(std::iter::once(' ')) {
        if c.is_ascii_digit() || (c == '.' && !cur.is_empty() && !cur.contains('.')) {
            cur.push(c);
        } else if !cur.is_empty() {
            if let Ok(n) = cur.trim_end_matches('.').parse() {
                out.push(n);
            }
            cur.clear();
        }
    }
    out
}

/// Whether a lower number is better for this stat (cooldowns, costs…).
fn lower_is_better(label: &str) -> bool {
    let l = label.to_ascii_lowercase();
    ["cooldown", "cost", "cast time", "recharge", "delay", "windup", "price", "damage taken", "lockout"]
        .iter()
        .any(|k| l.contains(k))
}

/// Buff or nerf from the numbers either side of the arrow. Only answers when
/// every number moved the same way, so "Damage: 50 / 90 ⇒ 40 / 95" stays blank.
fn line_effect(label: &str, before: &str, after: &str) -> String {
    let (a, b) = (numbers(before), numbers(after));
    if a.is_empty() || a.len() != b.len() {
        return String::new();
    }
    let up = a.iter().zip(&b).any(|(x, y)| y > x);
    let down = a.iter().zip(&b).any(|(x, y)| y < x);
    let better = match (up, down) {
        (true, false) => !lower_is_better(label),
        (false, true) => lower_is_better(label),
        _ => return String::new(),
    };
    if better { "buff" } else { "nerf" }.to_string()
}

fn parse_line(text: &str) -> ChangeLine {
    let Some((left, after)) = text.split_once('⇒') else {
        return ChangeLine { text: text.to_string(), ..Default::default() };
    };
    let (label, before) = match left.split_once(':') {
        Some((l, b)) => (l.trim(), b.trim()),
        None => ("", left.trim()),
    };
    let after = after.trim();
    ChangeLine {
        label: label.to_string(),
        before: before.to_string(),
        after: after.to_string(),
        text: text.to_string(),
        effect: line_effect(label, before, after),
    }
}

/// A paragraph that is all bold and short, used as an entry title in the
/// Classic and Arena sections (`<p><strong>Bel'Veth</strong></p>`).
/// Returns the title and whether it was marked NEW.
fn paragraph_title(p: &ElementRef) -> Option<(String, bool)> {
    let text = text_of(p);
    if text.is_empty() || text.len() > 48 {
        return None;
    }
    let bold: String = p.select(&SEL_STRONG).flat_map(|s| s.text()).collect();
    let bold = bold.replace('\u{a0}', " ").split_whitespace().collect::<Vec<_>>().join(" ");
    if bold != text {
        return None;
    }
    match text.strip_prefix("NEW") {
        Some(rest) => Some((rest.trim_start_matches([' ', '-', '–']).trim().to_string(), true)),
        None => Some((text, false)),
    }
}

/// An `<h4>` that heads a list of entries ("New Augments", "Bugfixes") rather
/// than one part of an entry ("Base Stats", "Q - Piltover Peacemaker").
fn is_category_heading(el: &ElementRef, text: &str) -> bool {
    if has_class(el, "ability-title") {
        return false;
    }
    let t = text.to_ascii_lowercase();
    ["champions", "items", "runes", "augments", "bugfix", "qol", "quality of life", "removed", "systems"]
        .iter()
        .any(|k| t.contains(k))
}

/// Overall verdict: the direction of the numbers when they all agree, then
/// Riot's own wording in the context ("we're buffing…") for mixed changes.
/// `titled` entries (a champion, an item) with only wording changes count as
/// adjusted; untitled lists like bug fixes don't.
fn verdict(context: &str, groups: &[ChangeGroup], titled: bool) -> String {
    let c = context.to_ascii_lowercase();
    let says_buff = c.contains("buff");
    let says_nerf = c.contains("nerf");
    let lines = groups.iter().flat_map(|g| &g.lines);
    let (mut buffs, mut nerfs, mut changes) = (0, 0, 0);
    for l in lines {
        if !l.after.is_empty() || titled {
            changes += 1;
        }
        match l.effect.as_str() {
            "buff" => buffs += 1,
            "nerf" => nerfs += 1,
            _ => {}
        }
    }
    match (buffs > 0, nerfs > 0) {
        (true, false) => "buff",
        (false, true) => "nerf",
        _ if says_buff != says_nerf => {
            if says_buff {
                "buff"
            } else {
                "nerf"
            }
        }
        _ if changes > 0 => "adjusted",
        _ => "",
    }
    .to_string()
}

pub fn parse_article(body: &str) -> Vec<PatchSection> {
    let doc = Html::parse_fragment(body);
    let mut sections: Vec<PatchSection> = Vec::new();
    // Entry being filled, and whether it came from an <h4> (no real title).
    let mut entry: Option<(PatchEntry, bool)> = None;
    // Latest list heading in this section, e.g. "New Augments".
    let mut category = String::new();

    fn finish(sections: &mut [PatchSection], entry: &mut Option<(PatchEntry, bool)>) {
        if let (Some((mut e, from_h4)), Some(s)) = (entry.take(), sections.last_mut()) {
            e.groups.retain(|g| !g.lines.is_empty());
            if !e.groups.is_empty() || !e.context.is_empty() {
                if e.verdict.is_empty() {
                    e.verdict = verdict(&e.context, &e.groups, !from_h4);
                }
                s.entries.push(e);
            }
        }
    }

    for el in doc.select(&SEL_ARTICLE) {
        let name = el.value().name();
        match name {
            "h2" => {
                finish(&mut sections, &mut entry);
                category.clear();
                let title = text_of(&el);
                sections.push(PatchSection { kind: section_kind(&title).into(), title, ..Default::default() });
            }
            "h3" if has_class(&el, "change-title") => {
                finish(&mut sections, &mut entry);
                entry = Some((PatchEntry { name: text_of(&el), ..Default::default() }, false));
            }
            "h4" => {
                let title = text_of(&el);
                let heading = is_category_heading(&el, &title);
                match entry.as_mut() {
                    Some((e, false)) if !heading => e.groups.push(ChangeGroup { title, lines: vec![] }),
                    _ => {
                        finish(&mut sections, &mut entry);
                        if heading {
                            category = title.to_ascii_lowercase();
                        }
                        entry = Some((
                            PatchEntry { name: title, groups: vec![ChangeGroup::default()], ..Default::default() },
                            true,
                        ));
                    }
                }
            }
            "blockquote" => {
                let text = paragraphs_of(&el);
                if text.is_empty() {
                    continue;
                }
                match entry.as_mut() {
                    Some((e, _)) if e.context.is_empty() && e.groups.iter().all(|g| g.lines.is_empty()) => {
                        e.context = text
                    }
                    _ => {
                        if let Some(s) = sections.last_mut() {
                            s.notes.push(text);
                        }
                    }
                }
            }
            "li" if !inside(&el, &["blockquote"]) => {
                let text = text_of(&el);
                if text.is_empty() {
                    continue;
                }
                match entry.as_mut() {
                    Some((e, _)) => {
                        if e.groups.is_empty() {
                            e.groups.push(ChangeGroup::default());
                        }
                        e.groups.last_mut().unwrap().lines.push(parse_line(&text));
                    }
                    None => {
                        if let Some(s) = sections.last_mut() {
                            s.notes.push(text);
                        }
                    }
                }
            }
            "p" if !inside(&el, &["blockquote", "li"]) => {
                // Parse the possible title once rather than in the guard and again here.
                if let Some((name, is_new)) = paragraph_title(&el) {
                    finish(&mut sections, &mut entry);
                    let verdict = if is_new || category.contains("new") {
                        "new"
                    } else if category.contains("removed") {
                        "removed"
                    } else {
                        ""
                    };
                    entry = Some((PatchEntry { name, verdict: verdict.to_string(), ..Default::default() }, false));
                } else if entry.is_none() {
                    let text = text_of(&el);
                    if !text.is_empty() {
                        if let Some(s) = sections.last_mut() {
                            s.notes.push(text);
                        }
                    }
                }
            }
            _ => {}
        }
    }
    finish(&mut sections, &mut entry);
    sections.retain(|s| {
        let t = s.title.to_ascii_lowercase();
        !SKIP_SECTIONS.iter().any(|k| t.contains(k)) && (!s.entries.is_empty() || !s.notes.is_empty())
    });
    sections
}

// ---------- freshness ----------

/// "2026-10-20T18:00:00.000Z" -> seconds since 1970 (UTC). Only the date and
/// time of day are read; that's all the site sends.
pub(crate) fn iso_to_secs(s: &str) -> Option<u64> {
    let num = |r: std::ops::Range<usize>| s.get(r)?.parse::<i64>().ok();
    let (y, m, d) = (num(0..4)?, num(5..7)?, num(8..10)?);
    let (hh, mm, ss) = (num(11..13).unwrap_or(0), num(14..16).unwrap_or(0), num(17..19).unwrap_or(0));
    if !(1..=12).contains(&m) || !(1..=31).contains(&d) {
        return None;
    }
    // Days from civil date (Howard Hinnant's algorithm).
    let y = if m <= 2 { y - 1 } else { y };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let mp = (m + 9) % 12;
    let doy = (153 * mp + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let days = era * 146_097 + doe - 719_468;
    u64::try_from(days * 86_400 + hh * 3600 + mm * 60 + ss).ok()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct SavedList {
    format: u32,
    /// When the list was downloaded (seconds since 1970).
    fetched_at: u64,
    patches: Vec<PatchInfo>,
}

impl SavedList {
    /// When the notes for the patch after the newest one should be out:
    /// Riot's schedule when it lists that patch, otherwise two weeks after
    /// the newest notes.
    fn next_due(&self) -> u64 {
        let newest_version = self.patches.iter().filter_map(|p| parse_version(&p.version)).max();
        if let Some(due) = newest_version.and_then(scheduled_notes_due) {
            return due;
        }
        let newest = self.patches.iter().filter_map(|p| iso_to_secs(&p.published)).max();
        newest.unwrap_or(self.fetched_at) + PATCH_EVERY_SECS
    }

    /// True while there's no reason to expect a newer patch on the site.
    fn is_fresh(&self, now: u64) -> bool {
        self.format == CACHE_FORMAT && (now < self.next_due() || now < self.fetched_at + RECHECK_SECS)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct SavedNotes {
    format: u32,
    notes: PatchNotes,
}

/// File name for one patch's notes, from the URL's last segment
/// ("league-of-legends-patch-26-21-notes"), limited to safe characters.
fn notes_file(url: &str) -> String {
    let slug: String = url
        .trim_end_matches('/')
        .rsplit('/')
        .next()
        .unwrap_or("")
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '-')
        .take(100)
        .collect();
    if slug.is_empty() {
        // Not expected for a real article; still give it a stable name.
        let hash = url.bytes().fold(0xcbf2_9ce4_8422_2325_u64, |h, b| (h ^ b as u64).wrapping_mul(0x100_0000_01b3));
        format!("notes-{hash:016x}.json")
    } else {
        format!("notes-{slug}.json")
    }
}

// ---------- client ----------

pub struct PatchNotesClient {
    http: reqwest::Client,
    disk: DiskCache,
    /// The saved list, read from disk on first use.
    list: Mutex<Option<SavedList>>,
    /// Notes already read this session (from disk or the site).
    notes: Mutex<HashMap<String, PatchNotes>>,
    /// Bumped by `clear`, under the `notes` lock.
    generation: Generation,
}

impl PatchNotesClient {
    /// `cache_dir` is where patch notes are saved; `None` keeps them in memory only.
    pub fn new(version: &str, cache_dir: Option<PathBuf>) -> PatchNotesClient {
        PatchNotesClient {
            http: reqwest::Client::builder()
                .user_agent(format!("LeagueBuddy/{version} (+https://github.com/doliaro/leaguebuddy)"))
                .timeout(Duration::from_secs(15))
                .build()
                .expect("http client"),
            disk: DiskCache { dir: cache_dir },
            list: Mutex::new(None),
            notes: Mutex::new(HashMap::new()),
            generation: Generation::default(),
        }
    }

    pub async fn usage(&self) -> CacheUsage {
        // The list lock is held during a download; don't wait on the network.
        let list = self.list.try_lock().map_or(0, |l| usize::from(l.is_some()));
        let notes = self.notes.lock().await.len();
        self.disk.usage(list + notes)
    }

    /// Forgets the list and every patch's notes, on disk and in memory, so the
    /// next look at the Patch Notes tab downloads them again.
    pub async fn clear(&self) -> Result<()> {
        // Waits for a list download in progress, so it can't save over the clear.
        let mut list = self.list.lock().await;
        *list = None;
        // Articles download without a lock; the generation stops one that
        // started before the clear from saving after it.
        let mut notes = self.notes.lock().await;
        self.generation.bump();
        notes.clear();
        self.disk.clear()
    }

    async fn fetch(&self, url: &str) -> Result<String> {
        let resp = self.http.get(url).send().await.context("couldn't reach leagueoflegends.com")?;
        let status = resp.status();
        if !status.is_success() {
            bail!("leagueoflegends.com returned {status}");
        }
        Ok(resp.text().await?)
    }

    pub async fn list(&self) -> Result<Vec<PatchInfo>> {
        // Held across the fetch, so calls that arrive together share one download.
        let mut saved = self.list.lock().await;
        if saved.is_none() {
            *saved = self.disk.read::<SavedList>("list.json").filter(|l| l.format == CACHE_FORMAT);
        }
        let now = now_secs();
        if let Some(l) = saved.as_ref().filter(|l| l.is_fresh(now)) {
            return Ok(l.patches.clone());
        }
        let patches = match self.fetch(LIST_URL).await.and_then(|html| parse_list(&html)) {
            Ok(p) => p,
            // Offline or the site changed: an older list still beats an error.
            Err(e) => return saved.as_ref().map(|l| l.patches.clone()).ok_or(e),
        };
        let fresh = SavedList { format: CACHE_FORMAT, fetched_at: now, patches };
        self.disk.write("list.json", &fresh);
        let out = fresh.patches.clone();
        *saved = Some(fresh);
        Ok(out)
    }

    pub async fn notes(&self, url: &str) -> Result<PatchNotes> {
        if !url.starts_with(&format!("{SITE}/")) {
            bail!("not a leagueoflegends.com link");
        }
        let generation = self.generation.current();
        if let Some(n) = self.notes.lock().await.get(url) {
            return Ok(n.clone());
        }
        let file = notes_file(url);
        if let Some(saved) = self.disk.read::<SavedNotes>(&file) {
            if saved.format == CACHE_FORMAT && saved.notes.info.url == url {
                let mut cache = self.notes.lock().await;
                if self.generation.current() == generation {
                    cache.insert(url.to_string(), saved.notes.clone());
                }
                return Ok(saved.notes);
            }
        }
        let info = self
            .list()
            .await
            .ok()
            .and_then(|l| l.into_iter().find(|p| p.url == url))
            .unwrap_or_else(|| PatchInfo { version: version_from("", url), title: String::new(), url: url.into(), published: String::new() });
        let html = self.fetch(url).await?;
        let sections = parse_article(&article_body(&html)?);
        if sections.is_empty() {
            bail!("the patch notes page had no changes League Buddy could read");
        }
        let notes = PatchNotes { info, sections };
        let mut cache = self.notes.lock().await;
        // Cleared while downloading: still show the notes, just don't save them.
        if self.generation.current() == generation {
            self.disk.write(&file, &SavedNotes { format: CACHE_FORMAT, notes: notes.clone() });
            cache.insert(url.to_string(), notes.clone());
        }
        Ok(notes)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture(name: &str) -> String {
        std::fs::read_to_string(format!("{}/tests/fixtures/{name}", env!("CARGO_MANIFEST_DIR"))).unwrap()
    }

    #[test]
    fn line_effects() {
        assert_eq!(parse_line("Mana Growth: 40/Level ⇒ 50/Level").effect, "buff");
        assert_eq!(parse_line("Cooldown: 12/11/10 seconds ⇒ 14/13/12 seconds").effect, "nerf");
        assert_eq!(parse_line("Total Cost: 3000 ⇒ 2900").effect, "buff");
        assert_eq!(parse_line("Damage: 60 - 100% AD ⇒ 60 - 80% AD").effect, "nerf");
        // Some numbers up, some down: left for the reader.
        assert_eq!(parse_line("Base Damage: 50 / 90 / 130 ⇒ 40 / 95 / 140").effect, "");
        assert_eq!(parse_line("Sabotage Duration: 90s ⇒ Infinite").effect, "");
        let plain = parse_line("Fixed a bug where Sivir's E didn't block Ezreal's Q.");
        assert!(plain.after.is_empty() && plain.effect.is_empty());
        let l = parse_line("Lethality: 22 ⇒ 18");
        assert_eq!((l.label.as_str(), l.before.as_str(), l.after.as_str()), ("Lethality", "22", "18"));
    }

    #[test]
    fn versions() {
        assert_eq!(version_from("League of Legends Patch 26.21 Notes", ""), "26.21");
        assert_eq!(version_from("", "https://x/en-us/news/game-updates/league-of-legends-patch-26-9-notes"), "26.9");
        // Non-ASCII before the version (or no version at all) used to panic.
        assert_eq!(version_from("Mise à jour 26.21 – Notes", ""), "26.21");
        assert_eq!(version_from("Notas del parche – ñ", ""), "");
    }

    #[test]
    fn list_page() {
        let list = parse_list(&fixture("patch_list.html")).unwrap();
        assert_eq!(list.len(), 2);
        assert_eq!(list[0].version, "26.21");
        assert_eq!(list[0].url, "https://www.leagueoflegends.com/en-us/news/game-updates/league-of-legends-patch-26-21-notes");
        assert_eq!(list[1].version, "26.20");
    }

    #[test]
    fn article_sections_and_verdicts() {
        let body = article_body(&fixture("patch_article.html")).unwrap();
        let sections = parse_article(&body);
        let titles: Vec<&str> = sections.iter().map(|s| s.title.as_str()).collect();
        // Skins are dropped.
        assert_eq!(titles, vec!["Patch Highlights", "Champions", "Items", "Arena", "Bugfixes & QoL Changes"]);
        assert_eq!(sections[0].notes, vec!["A short highlight paragraph."]);

        let champs = &sections[1];
        assert_eq!(champs.kind, "champion");
        let names: Vec<&str> = champs.entries.iter().map(|e| e.name.as_str()).collect();
        assert_eq!(names, vec!["Azir", "Caitlyn", "Zed"]);
        assert_eq!(champs.entries[0].verdict, "buff"); // context says "buffing"
        assert_eq!(champs.entries[0].groups[0].title, "Base Stats");
        assert_eq!(champs.entries[1].verdict, "nerf"); // context says "nerf", despite a Q buff
        assert_eq!(champs.entries[1].groups.len(), 2);
        assert_eq!(champs.entries[1].groups[1].lines[0].effect, "buff");
        assert_eq!(champs.entries[2].verdict, "nerf"); // no wording: numbers say cooldown went up
        assert!(champs.entries[0].context.starts_with("Azir's mana"));

        // Two items share one block, split at each <h3>.
        let items = &sections[2];
        assert_eq!(items.kind, "item");
        assert_eq!(items.entries.len(), 2);
        assert_eq!(items.entries[0].name, "Bastion Breaker");
        assert_eq!(items.entries[0].verdict, "nerf");
        assert_eq!(items.entries[0].groups[0].lines.len(), 3);
        assert_eq!(items.entries[1].name, "Dawncore");
        assert_eq!(items.entries[1].verdict, "buff");

        // Arena titles champions with bold paragraphs instead of <h3>, and
        // list headings ("Removed Augments") start their own entries.
        let arena = &sections[3];
        assert_eq!(arena.notes.len(), 1);
        let names: Vec<(&str, &str)> = arena.entries.iter().map(|e| (e.name.as_str(), e.verdict.as_str())).collect();
        assert_eq!(names, vec![("Bel'Veth", "nerf"), ("Mordekaiser", "new"), ("Old Augment", "removed")]);
        assert_eq!(arena.entries[0].groups[0].title, "Q - Void Surge");
        assert_eq!(arena.entries[1].context, "An old kit returns.");

        // Plain bug fix lists come through as an entry with no verdict.
        let fixes = &sections[4];
        assert_eq!(fixes.entries[0].name, "Bugfixes");
        assert_eq!(fixes.entries[0].verdict, "");
        assert_eq!(fixes.entries[0].groups[0].lines.len(), 2);
    }

    #[test]
    fn iso_dates() {
        assert_eq!(iso_to_secs("1970-01-01T00:00:00.000Z"), Some(0));
        assert_eq!(iso_to_secs("2026-10-20T18:00:00.000Z"), Some(1_792_519_200));
        assert_eq!(iso_to_secs("2024-02-29"), Some(1_709_164_800));
        assert_eq!(iso_to_secs(""), None);
        assert_eq!(iso_to_secs("not a date"), None);
    }

    #[test]
    fn list_refreshes_on_patch_cadence() {
        let published = iso_to_secs("2026-10-20T18:00:00.000Z").unwrap();
        let day = 24 * 60 * 60;
        let info = PatchInfo { version: "26.21".into(), title: String::new(), url: String::new(), published: "2026-10-20T18:00:00.000Z".into() };
        let list = SavedList { format: CACHE_FORMAT, fetched_at: published + day, patches: vec![info] };
        // Kept until the next patch is due, two weeks after the newest notes.
        assert!(list.is_fresh(published + 13 * day));
        assert!(!list.is_fresh(published + 14 * day));
        // A late patch: checked again at most every 6 hours.
        let late = SavedList { fetched_at: published + 15 * day, ..list.clone() };
        assert!(late.is_fresh(published + 15 * day + 5 * 3600));
        assert!(!late.is_fresh(published + 15 * day + 6 * 3600));
        // Saved by an older version of the parser: fetch again.
        assert!(!SavedList { format: CACHE_FORMAT + 1, ..list }.is_fresh(published));
    }

    #[test]
    fn list_expires_when_scheduled_notes_are_due() {
        let at = |s: &str| iso_to_secs(s).unwrap();
        let list = |version: &str, published: &str| SavedList {
            format: CACHE_FORMAT,
            fetched_at: at(published),
            patches: vec![PatchInfo { version: version.into(), title: String::new(), url: String::new(), published: published.into() }],
        };
        // 26.22 ships Nov 4, so its notes are due Nov 3.
        let l = list("26.21", "2026-10-20T18:00:00.000Z");
        assert_eq!(l.next_due(), at("2026-11-03T12:00:00Z"));
        assert!(l.is_fresh(at("2026-11-03T11:59:59Z")));
        assert!(!l.is_fresh(at("2026-11-03T12:00:00Z")));
        // Three-week gap: 26.24 ships Dec 9, so no checks during the extra week.
        let l = list("26.23", "2026-11-17T18:00:00.000Z");
        assert_eq!(l.next_due(), at("2026-12-08T12:00:00Z"));
        assert!(l.is_fresh(at("2026-12-02T12:00:00Z")));
        // Off-cycle Thursday patch: 26.18 shipped Sep 10.
        assert_eq!(list("26.17", "2026-08-25T18:00:00.000Z").next_due(), at("2026-09-09T12:00:00Z"));
        // Past the end of the schedule: two weeks after the newest notes.
        let l = list("26.24", "2026-12-08T18:00:00.000Z");
        assert_eq!(l.next_due(), at("2026-12-22T18:00:00Z"));
        // The schedule is in order and every date reads.
        assert!(PATCH_SCHEDULE.windows(2).all(|w| (w[0].0, w[0].1) < (w[1].0, w[1].1) && w[0].2 < w[1].2));
        assert!(PATCH_SCHEDULE.iter().all(|(_, _, d)| iso_to_secs(d).is_some()));
    }

    #[test]
    fn notes_release_times() {
        let at = |s: &str| iso_to_secs(s).unwrap();
        // 26.21 shipped Oct 21 (notes Oct 20), 26.22 ships Nov 4 (notes Nov 3).
        assert_eq!(notes_releases_around(at("2026-10-21T09:00:00Z")), (Some(at("2026-10-20T12:00:00Z")), at("2026-11-03T12:00:00Z")));
        assert_eq!(notes_releases_around(at("2026-11-03T12:00:00Z")).0, Some(at("2026-11-03T12:00:00Z")));
        assert_eq!(notes_releases_around(at("2026-01-01T00:00:00Z")), (None, at("2026-01-07T12:00:00Z")));
        // Past the schedule: every two weeks from 26.24's notes (Dec 8).
        assert_eq!(notes_releases_around(at("2026-12-25T00:00:00Z")), (Some(at("2026-12-22T12:00:00Z")), at("2027-01-05T12:00:00Z")));
    }

    #[test]
    fn notes_file_names() {
        assert_eq!(
            notes_file("https://www.leagueoflegends.com/en-us/news/game-updates/league-of-legends-patch-26-21-notes/"),
            "notes-league-of-legends-patch-26-21-notes.json"
        );
        assert_eq!(notes_file("https://www.leagueoflegends.com/../..\\x?y"), "notes-xy.json");
        assert!(notes_file("https://www.leagueoflegends.com/").starts_with("notes-"));
    }

    #[test]
    fn notes_survive_a_restart() {
        let dir = std::env::temp_dir().join(format!("lb-patch-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let url = "https://www.leagueoflegends.com/en-us/news/game-updates/league-of-legends-patch-26-21-notes";
        let notes = PatchNotes {
            info: PatchInfo { version: "26.21".into(), title: "t".into(), url: url.into(), published: String::new() },
            sections: parse_article(&article_body(&fixture("patch_article.html")).unwrap()),
        };
        let disk = DiskCache { dir: Some(dir.clone()) };
        disk.write(&notes_file(url), &SavedNotes { format: CACHE_FORMAT, notes: notes.clone() });
        // A new client (as after restarting the app) reads it without the network.
        let client = PatchNotesClient::new("test", Some(dir.clone()));
        let rt = tokio::runtime::Builder::new_current_thread().build().unwrap();
        assert_eq!(rt.block_on(client.notes(url)).unwrap(), notes);
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// Parses real saved pages:
    /// `LB_PATCH_LIST=list.html LB_PATCH_HTML=page.html cargo test real_patch_page -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn real_patch_page() {
        if let Ok(list) = std::env::var("LB_PATCH_LIST") {
            for p in parse_list(&std::fs::read_to_string(list).unwrap()).unwrap().iter().take(5) {
                println!("{} | {} | {} | {}", p.version, p.published, p.title, p.url);
            }
        }
        let html = std::fs::read_to_string(std::env::var("LB_PATCH_HTML").unwrap()).unwrap();
        for s in parse_article(&article_body(&html).unwrap()) {
            println!("## {} ({}) notes={}", s.title, s.kind, s.notes.len());
            for e in &s.entries {
                let lines: usize = e.groups.iter().map(|g| g.lines.len()).sum();
                println!("  {:<28} {:<9} groups={} lines={}", e.name, e.verdict, e.groups.len(), lines);
            }
        }
    }
}
