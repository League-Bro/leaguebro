# League Bro

A full featured League of Legends companion for Windows and Mac. It imports your runes, spells and shop build, scouts who you're playing with and against, suggests picks and bans, shows a click-through in-game overlay with objective timers, and reviews your games afterwards. 

League Bro is a hobby project and isn't endorsed by Riot Games.

## Install

Download it from **[league-bro.github.io/leaguebro](https://league-bro.github.io/leaguebro/)**, the League Bro website, which always links the newest installer. Or:

1. Go to the **[latest release](https://github.com/league-bro/leaguebro/releases/latest)** and download `League.Bro_x.y.z_x64-setup.exe`.
2. Run it. If Windows shows **"Windows protected your PC"**, click **More info → Run anyway**. That warning appears because the app isn't code-signed, not because something is wrong with it.
3. Open League Bro, then open League. It connects on its own.

On a Mac, download `League.Bro_x.y.z_universal.dmg` from the same release instead, open it and drag League Bro into Applications. The first time you open it, macOS says it can't check the app, because the app isn't notarized by Apple. Go to **System Settings → Privacy & Security**, scroll down and click **Open Anyway**. One download works on both Apple Silicon and Intel Macs. The Mac version is new and has had less testing than the Windows one.

In League, set **Settings → Video → Window Mode** to **Borderless** (or Windowed). In Fullscreen the game covers the overlay. League Bro shows a reminder when League is on Fullscreen.

League Bro updates itself. When a new version is out, it offers **Update and restart**. It never installs in the middle of a game unless you click. You can also check under **Settings → App → About & updates**.

To uninstall, use Windows **Settings → Apps → Installed apps → League Bro**. On a Mac, drag League Bro from Applications to the Trash.

If you installed the app before it was renamed to League Bro, updating installs League Bro next to the old copy and starts with default settings. Uninstall the old copy from Installed apps, and delete its old rune page and item set in the League client.

## Getting around

The window has its own title bar: drag it by the empty strip at the top, and use the buttons on the right to minimize, maximize or close. The tabs along the top are **Live**, **Champions**, **Patch Notes** and **Settings** (Ctrl+1 to 4, Cmd on a Mac). Click the **League Bro** logo or your name to open your **Profile**, which is also where the app opens. Press **Ctrl+K**, or just start typing, to jump to any champion's build or guide.

## What it does

### Your profile

Your rank (with its crest) for Solo/Duo and Flex, an LP graph of your climb, and your recent match history with LP won or lost per game. Click a match to see its full scoreboard. One card on the left shows your queues, best champions and toughest lane opponents and enemies, and follows the queue tabs at the top (All, Solo/Duo, Flex and so on).

It covers the games the League client keeps, usually your last few dozen. Custom and practice games aren't included, and neither are Brawl or League Classic, which Riot doesn't allow apps to show.

While League isn't running, the Profile can still load from OP.GG: enter your Riot ID and region once and it looks you up there.

**Other players:** click a name on any scoreboard, or search for `Name#TAG`, to open that player's profile. **← Back to you** returns to yours.

### Playstyle chart

The **Playstyle** card on your Profile is a spider chart of seven parts of your game, from your recent Summoner's Rift games in the selected queue tab (the card says how many):

| Axis | What it measures |
| --- | --- |
| Gold | gold earned per minute |
| Damage | damage to champions per minute |
| Team fights | kill participation: your kills and assists out of your team's kills |
| KDA | (kills + assists) / deaths |
| Deaths | deaths per minute (fewer is better, so the axis is flipped) |
| Vision | vision score per minute |
| Objectives | damage to towers, dragons, Baron and other objectives per minute |

The pink shape is you. The dotted ring is the **goal**: the average player of the rank you compare with, in the lanes you played. The menu next to **Compared with players in** picks that rank, and starts on your own Solo/Duo rank (Flex if you have none). Your choice is remembered. Hover a heading for your number, the goal, how close you are, and a tip on how to improve that part.

Only Summoner's Rift games count (not ARAM, Arena or other modes), and remakes are left out. It needs at least three games. Profiles loaded from OP.GG have no vision or objective numbers, so those two axes are left out there.

Where the goals come from, best first (the hover card says which one each axis uses):

1. **Real averages from Riot's API**, per rank and per lane, when `src/app/core/playstyle-targets.ts` has been generated (see [Rank goals for the Playstyle chart](#rank-goals-for-the-playstyle-chart) below).
2. **OP.GG's average KDA** for players of that rank in each lane.
3. **Estimates** for everything else: typical numbers per lane, scaled up or down by rank.

### Live tab

When you're not in a game, the Live tab shows a radar that sweeps while you're idle or in queue. Once a game starts it follows you through champ select, the loading screen, the game itself and the post-game summary.

### Champ select

- **Ban suggestions** at the top while your ban is still to make: champions with the best win rates in your lane at your rank (from Lolalytics), nudged towards champions you've recently lost to.
- **Pick suggestions** before you lock in: champions that do well against your likely lane opponent, from OP.GG's counter stats. The **Stats for** menu changes the rank they come from. Click one to hover it.
- **Your champion** with OP.GG's recommended build (see below) and an **Import now** button.
- **Both teams** in one card: each team's damage profile (physical, magic, true), what each comp is good at and how to play around it, all ten players lined up in their lane pairs, and the bans.

### Recommendations (OP.GG)

When you hover or lock a champion, League Bro pulls OP.GG's ranked stats for that champion and role and shows the most popular rune page, summoner spells, skill order (once you've locked in), starting items and build path, with game counts and win rate. Situational items are suggested from what the enemy team has: healing, tanks, shields and so on.

When OP.GG has other popular choices (up to three rune pages, summoner spell pairs, core builds and boots, each with enough games to trust), they show as numbered chips with their win rates. Hover one for details, click it to switch. In champ select, once you've picked that champion, switching re-imports your runes, spells and shop build right away, and the overlay follows your choice.

### Lane matchup

Once you've locked in and the enemy team picks, League Bro works out who's probably in your lane (from which lanes each enemy champion is usually played in) and shows the matchup: OP.GG's win rate for your champion against them, who usually wins the lane and gets more solo kills, how to play it, the damage they deal, OP.GG's lane tip, and your own recent games against them. If the guess is wrong, click the right enemy (or None).

When OP.GG has enough games of the matchup, the recommendation gets a **vs <Champion>** switch next to **All games**: it swaps in the runes, spells and build players use against that champion, and in champ select imports them right away. Only enemy champions are used, never names, so nothing hidden in ranked champ select is shown.

### Rune, summoner spell and shop build auto-import

When you lock in, League Bro creates a rune page called `League Bro: <Champion> <Role>` and selects it. It reuses that one page every game, so your other pages are left alone (unless every slot is full, see below). It also sets your summoner spells, keeping Flash on whichever key you already use. In Swiftplay, where you pick champions in the lobby, it imports for each of your slots and shows them on the Live tab.

It also adds OP.GG's build to the in-game shop as an item set with the same name: starter items, boots, core build and options for items 4 to 6, with win rates. It's listed first under **Item Sets** in the shop, so the shop opens on it. Like the rune page, it's one set that gets replaced each game, and your own item sets aren't touched. League Bro removes it when it closes, so it never shows up in a game League Bro isn't running for.

- **Where the page comes from:** OP.GG's most popular page. For rare picks with too few games on OP.GG, it uses the League client's own suggestion.
- **Options:** under **Settings → Champ select** you can switch to League client suggestions only, or turn off summoner spells or the shop build. Turn on "Import while hovering" for blind pick. If all your page slots are full and there's no League Bro page yet, League Bro takes over the selected page once (it tells you which) and reuses it from then on. Turn on "Keep my pages when slots are full" to get an error instead.

### Scouting

Each player shows their rank, LP, win rate, record and KDA over their last 20 games, most-played champions, and how often they've played their current pick.

- **Champ select:** only your party, plus everyone in normal games. Riot hides other players' names in ranked champ select, and League Bro follows that rule.
- **Loading screen and in game:** all ten players, except anyone using streamer mode. In custom games with bots, the list is filled in from the game's scoreboard.

### In-game overlay

A small, click-through panel shows:

- a top line with your skill order (which ability to max and which to level next), your gold against your lane opponent's or the whole enemy team's, and your CS per minute (red under 5, green from 8). Click the gold difference to compare with any enemy.
- objective timers: dragon (switching to Elder after a soul), Baron, and destroyed inhibitors
- your next item and its parts in the order to buy them, with **Buy now** when you can afford something; at the start of a game, your starting items. It says **Build complete** once you have six finished items.
- situational items against this enemy team

The game doesn't share enemy gold, so the gold numbers are the value of everyone's items. To move the overlay, hold the round handle on its top-right corner and drag. The rest of it ignores the mouse, so clicks go through to the game.

The **Overlay** section at the top of Settings has a switch for each part, its size and width, whether it grows upward, and a live preview.

### Post-game summary and Bro's review

When a game ends, the **Live** tab shows the result, your KDA, CS per minute, damage, gold, vision, kill share and items, the LP you won or lost, a gold lead graph, and a scoreboard for both teams with everyone's current rank. **Bro's review** grades your game (S+ to D) with a short verdict, some ribbing for the bad plays and credit for the good ones (no swearing; turn the roasts off under **Settings → Display → Post-game**), and a **Copy** button. It stays until your next champ select, or until you close it.

### Champions and Patch Notes

The **Champions** tab looks up any champion: the OP.GG build for Ranked (with a role) or ARAM, a tier list by lane and rank, and a beginner **Guide** with the champion's abilities, clips and tips. **Patch Notes** shows Riot's latest notes, sorted into buffs, nerfs and adjustments.

### Feedback

**Settings → Feedback** sends a bug report or an idea straight to the developers. It's anonymous unless you leave a way to reply.

### Anonymous usage stats

To count how many people use it, League Bro sends one anonymous "app open" event a day to [Aptabase](https://aptabase.com): a random install ID made up on your computer, the app version and the operating system. No Riot ID, games or settings. Turn it off in **Settings → App → Privacy → Share anonymous usage stats**; then nothing is sent.

### What it doesn't do

League Bro doesn't read game memory, inject anything into the game, automate input, or track enemy ability or summoner spell cooldowns, and the app itself uses no Riot API key. It uses:

- the League client's local API and Riot's official in-game data API (port 2999)
- OP.GG and Lolalytics public stats, CommunityDragon for icons, and Riot's website for patch notes
- the anonymous daily ping above (you can turn it off) and Feedback, only when you send something

It stays within [Riot's third-party app rules](https://developer.riotgames.com/policies/general).

## Troubleshooting

| Problem | Fix |
| --- | --- |
| "League client not found" while League is open | Under **Settings → App → Troubleshooting**, enter your install folder, usually `C:\Riot Games\League of Legends`. If League runs as administrator, run League Bro as administrator too. |
| Overlay doesn't show in game | Set League to **Borderless**, and make sure the overlay is switched on in **Settings → Overlay**. |
| Rune import fails with "slots are full" | "Keep my pages when slots are full" is on. Delete one page or turn that setting off. |
| League Bro's build is missing or cut off in the shop | Another app (like Blitz) left item sets that show for every champion, ahead of League Bro's. **Settings → Champ select** lists them; click **Move them aside** (you can put them back). |
| Objective timer is off | Riot changes spawn times between seasons. Report it under **Settings → Feedback** so the next release can fix it. |
| Champion or item icons missing | Icons load from CommunityDragon and need an internet connection. |
| "Couldn't get OP.GG data" | OP.GG is unreachable or changed something. Runes fall back to the League client's suggestion automatically. You can also switch to "League client only" under **Settings → Champ select**. |
| Something looks out of date | **Settings → App → Troubleshooting → Clear cache** throws away saved OP.GG and patch data. |

Settings are stored in `%APPDATA%\dev.dom.leaguebro\settings.json` (on a Mac, `~/Library/Application Support/dev.dom.leaguebro/settings.json`). Delete that file to reset everything.

---

## Development

Built with [Tauri 2](https://tauri.app) (Rust, in `src-tauri/`) and Angular 21 (standalone components, signals, zoneless, in `src/`). `CLAUDE.md` has the detailed notes on how everything works: every API endpoint used, the precedence rules, and Riot's rules the app must follow.

### Quick setup (Windows)

Clone the repo, then run the setup script from the project folder:

```powershell
git clone https://github.com/league-bro/leaguebro.git
cd leaguebro
scripts\setup-dev.cmd
```

The script checks for each tool below and installs whatever is missing with `winget`. It also lets `npm` run in PowerShell and runs `npm install`. It's safe to run again any time; anything already installed is skipped.

- Expect a few Windows permission prompts.
- The Visual Studio Build Tools download is several GB, so the first run can take 15–30 minutes.
- Add `-Build` (`scripts\setup-dev.cmd -Build`) to also compile the Rust side once, so your first `npm run tauri dev` starts fast.

When it says **All set**, open a **new** terminal (so it sees the updated PATH) and run:

```powershell
npm run tauri dev
```

The first run compiles all the Rust dependencies (about 5 minutes), then the League Bro window opens. After that it starts in seconds.

### Manual setup

If you'd rather install things yourself, or the script reports a problem:

| Tool | Why | Install |
| --- | --- | --- |
| [Git](https://git-scm.com) | source control | `winget install --id Git.Git -e` |
| [Node.js](https://nodejs.org) 22.12+ (LTS) | Angular UI and the Tauri CLI | `winget install --id OpenJS.NodeJS.LTS -e` |
| [Rust](https://rustup.rs) (stable, MSVC) | the app's backend | `winget install --id Rustlang.Rustup -e` |
| [Visual Studio 2022 Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) with **Desktop development with C++** | Rust's linker on Windows | `winget install --id Microsoft.VisualStudio.2022.BuildTools -e --override "--wait --passive --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"` |
| [WebView2 Runtime](https://developer.microsoft.com/microsoft-edge/webview2/) | renders the UI | built into Windows 10/11 |

Then close and reopen your terminal and run:

```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned   # once, so npm runs in PowerShell
npm install
npm run tauri dev
```

### Day-to-day

```powershell
npm run tauri dev      # run the app; UI changes reload instantly, Rust changes rebuild and restart it
npm start              # UI only, in your browser at http://127.0.0.1:4200 with demo data (no League needed)
npm run build          # production build of the UI (runs the copy-paste check first)
npm run check          # just the copy-paste check (scripts/check-code.mjs)
npm run tauri build    # build an installer into src-tauri\target\release\bundle\nsis\
cd src-tauri; cargo test   # Rust unit tests
```

Before committing, `npm run build` and `cargo test` should both pass with no warnings. `scripts/check-code.mjs` fails the build when the same block of code appears in two places, so share a helper instead of copying.

In browser mode, add one of these to the URL to see a screen without League. When a data shape changes, update the demo data in `src/app/core/demo.ts` too.

| URL | Shows |
| --- | --- |
| `?scene=champselect` | champ select |
| `?scene=ban` / `?scene=pick` | ban suggestions / pick suggestions |
| `?scene=postgame` / `?scene=postgame-bad` | the post-game summary (a good game / a bad one) |
| `?scene=swiftplay` | a Swiftplay lobby |
| `?scene=bots` | a custom game with bots |
| `?scene=idle` / `queue` / `offline` | the Live tab radar (no game, in queue, no client) |
| `?window=overlay` | the overlay |
| `?fullscreen` | the "League is set to Fullscreen" hint (works with `?scene=`) |
| `?profile=opgg` / `?profile=setup` | the Profile from OP.GG, and its Riot ID form |
| `?lp=N` | the LP graph with N saved ranks |
| `?update=splash` / `?update=prompt` | the update screens |

Don't run a dev copy and an installed copy of League Bro at the same time; both would try to manage your rune page.

### Troubleshooting setup

| Problem | Fix |
| --- | --- |
| `'git'` / `'node'` / `'cargo'` is not recognized | Close and reopen the terminal (and VS Code) so it picks up the new PATH. |
| `npm.ps1 cannot be loaded because running scripts is disabled` | Run `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`, or use `npm.cmd` instead of `npm`. |
| `linker 'link.exe' not found` | The Visual Studio Build Tools (C++ workload) are missing. Rerun the setup script or install them as above. |
| Stuck on `Waiting for your frontend dev server to start` | Something else is using port 4200, or `npm run start` failed. Run `npm start` alone to see the error. |
| `winget` isn't recognized | Install **App Installer** from the Microsoft Store, or use the manual links above. |

### Rank goals for the Playstyle chart

The Playstyle chart's goals are best when they're real averages. `scripts/calibrate-playstyle.mjs` makes them: it samples recent ranked Solo/Duo games from Riot's API for every rank from Iron to Challenger and writes the average gold, damage, kill participation, KDA, deaths, vision and objective damage per lane to `src/app/core/playstyle-targets.ts`. Until it has run, that file holds `RANK_TARGETS = null` and the chart falls back to OP.GG's KDA and estimates.

It needs a Riot API key. A personal development key from [developer.riotgames.com](https://developer.riotgames.com) is fine; it expires every 24 hours.

```powershell
# PowerShell
$env:RIOT_API_KEY = "RGAPI-..."; node scripts/calibrate-playstyle.mjs
```

```bash
# Git Bash
RIOT_API_KEY=RGAPI-... node scripts/calibrate-playstyle.mjs
```

- It takes about 20 minutes with the defaults, because a development key allows 100 requests every 2 minutes. It waits out rate limits on its own.
- Options (environment variables): `RIOT_PLATFORM` (default `na1`; also `euw1`, `kr` and so on), `PLAYERS_PER_RANK` (default 12) and `GAMES_PER_PLAYER` (default 5). The defaults give roughly 600 player-games per rank, about 120 per lane.
- Games under 15 minutes and early surrenders are skipped.
- Commit the regenerated `playstyle-targets.ts`; don't edit it by hand. Run it again every few patches to keep the goals current.

**Keys never go in the app or the repo.** The script reads the key only from the environment and doesn't save it. A key shipped inside the app could be pulled out of it by anyone, and Riot revokes leaked keys.

**Plan for the production key.** A Riot production key (applied for, waiting on Riot) has higher limits and doesn't expire. When it arrives, it goes in as a GitHub repository secret (`RIOT_API_KEY`), and a scheduled GitHub Action runs this script after each patch and publishes the result as a JSON file on the website. The app then downloads that file, so goals stay current without a new release, and the key stays on GitHub. If the app ever needs live Riot data per user, that would go through a small server of our own instead, never a key in the app.

### Website

The download site is a single static page, `site/index.html`, published to GitHub Pages at https://league-bro.github.io/leaguebro/ by `.github/workflows/pages.yml` ("Publish website") whenever `site/` changes on `main`. The page asks GitHub's API for the latest release in the visitor's browser and offers the Windows or Mac download to match their computer, so a new release shows up on the site without republishing. To preview it locally, open `site/index.html` in a browser.

`site/riot.txt` is Riot's verification file for the developer portal. Keep the "isn't endorsed by Riot Games" notice in the page footer; Riot requires it for fan projects.

One-time setup: in the repo's **Settings → Pages**, set **Source** to **GitHub Actions**.

### Releasing a new version

Installers are built on GitHub's servers by `.github/workflows/build-windows.yml` ("Release installers": Windows first, then the universal Mac app on a macOS runner), so releasing doesn't need Rust or a Mac. The version has to go up every time: installed copies only update to a higher version, so pushing to `main` without a bump re-publishes the same version and nobody gets an update.

**The quick way:** from `main`, with everything committed, run

```powershell
.\release          # PowerShell; release in Command Prompt, ./release in Git Bash
.\release 0.2.0    # a specific version
```

It checks that `main` is up to date with GitHub, bumps the version, asks before going on, commits `bump to x.y.z`, pushes, and starts the release and website workflows. It needs the [GitHub CLI](https://cli.github.com) (`winget install GitHub.cli`, then `gh auth login`). Answering no puts the version files back.

**By hand:**

1. Bump the version. `bump` goes to the next patch version (e.g. `0.1.41` → `0.1.42`); `bump 0.2.0` sets a specific one:
   ```powershell
   bump          # Command Prompt; .\bump in PowerShell, ./bump in Git Bash
   bump 0.2.0
   ```
   `bump` runs `scripts\bump-version.cmd`. It updates every file that holds the version (`src-tauri/tauri.conf.json`, `package.json`, `src-tauri/Cargo.toml`, `package-lock.json`, `src-tauri/Cargo.lock`), and refuses a version that isn't higher than the current one or the newest release tag.
2. Commit and push, then start the release, either with **Actions → Release installers → Run workflow** or by pushing a tag that matches the new version:
   ```powershell
   git commit -am "bump to 0.1.42"
   git tag v0.1.42
   git push origin main v0.1.42
   ```

About 10 to 15 minutes later a new release appears with the Windows installer and `latest.json`; the Mac `.dmg` is added about 15 minutes after that. Installed copies pick it up within a minute or so.

### Auto-updates

Installed copies check `releases/latest/download/latest.json` on startup and then every minute, and show the update offer when there's a newer version. Every update is signed, and the app only installs updates signed with the project's private key. The matching public key is in `src-tauri/tauri.conf.json` under `plugins.updater.pubkey`; never change it unless the private key is lost, because that breaks updates for everyone already installed.

Dev builds (`npm run tauri dev`) never update themselves.

### Repository secrets

Set under **Settings → Secrets and variables → Actions**:

| Secret | Used for |
| --- | --- |
| `TAURI_SIGNING_PRIVATE_KEY` | signing updates: the full contents of the private key file |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | its password |
| `APTABASE_APP_KEY` | the anonymous usage ping (see below) |
| `RIOT_API_KEY` | later: the production key for refreshing the Playstyle goals (see above) |

Keep a backup of the signing key and password somewhere safe, like a password manager. If you lose them, installed copies can't verify new updates, and everyone has to reinstall manually once you set up a new key. Don't keep keys or tokens in the project folder where they could be committed by accident.

### Usage stats key

The daily anonymous ping (`src-tauri/src/usage.rs`) goes to [Aptabase](https://aptabase.com) (US region). Its app key (`A-US-…`, from the Aptabase dashboard under **Instructions**) is read at build time from the `APTABASE_APP_KEY` environment variable, which the release workflow passes from the repository secret. Without it the app builds and runs normally and sends nothing, so local and dev builds stay silent unless you set the variable yourself. The dashboard's **Debug Data** switch shows events from dev builds.

### Feedback service

**Settings → Feedback** posts to a small Cloudflare Worker in `feedback-worker/` (with a D1 database). It stores each report, opens a GitHub issue for it in this repo (labelled `bug` or `enhancement` plus `from-app`) with a GitHub token kept as a Worker secret, and has a password-protected inbox page for the developers. It's deployed on Daniel's Cloudflare account, so redeploys go through him, and moving it to a new URL needs an app release. To work on it: `cd feedback-worker; npm install; npm run dev` (details in `CLAUDE.md`).

### Project layout

```
src/app/core/              Tauri bridge (rift.service.ts), models, demo data, auto-update,
                           playstyle-targets.ts (Playstyle goals, generated)
src/app/components/        one file per screen or card:
  shell.ts                   window frame, top tabs, champion search, update banner
  profile-view.ts            Profile: ranks, LP graph (lp-graph.ts), match history,
                             Playstyle chart (playstyle-radar.ts)
  live-view.ts               Live tab: idle radar, champ select, loading screen, game
  pick-suggest.ts, ban-suggest.ts, champ-teams.ts, rec-card.ts, matchup-card.ts
  post-game.ts               post-game summary and Bro's review
  overlay.ts                 the in-game overlay window
  champions-view.ts, champion-list.ts, guide-card.ts, patch-view.ts
  settings-view.ts, overlay-settings.ts, feedback-view.ts
src-tauri/src/
  lib.rs                     Tauri setup, window controls, commands the UI calls
  engine.rs                  background loop: game phase, champ select, loading screen, overlay
  lcu.rs                     finds the League client and talks to its local API
  runes.rs, itemsets.rs      rune page and shop item set import
  opgg.rs, tierlist.rs       OP.GG recommendations, tier lists (OP.GG, Lolalytics)
  matchup.rs, picks.rs, bans.rs, situational.rs   lane matchup, pick/ban and item suggestions
  scout.rs, profile.rs, opgg_profile.rs, lp_history.rs   ranks, match history, profiles, LP
  live.rs, postgame.rs       in-game data and timers, post-game summary
  patch.rs, guide.rs         patch notes, champion guides
  config.rs, cache.rs, usage.rs, feedback.rs, util.rs
src-tauri/tauri.conf.json  windows, security policy, updater key, version
                           (tauri.macos.conf.json: Mac bundle settings)
site/                      the download website
feedback-worker/           the feedback service (Cloudflare Worker)
scripts/                   setup-dev, bump-version, release, check-code, calibrate-playstyle
.github/workflows/         release installers (Windows + Mac), publish website
```
