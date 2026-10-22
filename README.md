# League Bro

A small, ad-free League of Legends companion for Windows. It imports your runes automatically, shows who you're playing with and against, and adds a lightweight in-game overlay with objective timers. There are no ads, no accounts and no tracking.

## Install

Download it from **[doliaro.github.io/leaguebro](https://doliaro.github.io/leaguebro/)**, the League Bro website, which always links the newest installer. Or:

1. Go to the **[latest release](https://github.com/doliaro/leaguebro/releases/latest)** and download `League.Bro_x.y.z_x64-setup.exe`.
2. Run it. If Windows shows **"Windows protected your PC"**, click **More info → Run anyway**. That warning appears because the app isn't code-signed, not because something is wrong with it.
3. Open League Bro, then open League. It connects on its own.

In League, set **Settings → Video → Window Mode** to **Borderless** (or Windowed). In Fullscreen the game covers the overlay.

To move the overlay, click the padlock in its top-right corner, drag it where you want it, then click the padlock again. The rest of the overlay ignores the mouse, so clicks go through to the game.

League Bro updates itself. When a new version is out, a banner at the top of the window offers **Update and restart**. It never installs in the middle of a game unless you click. You can also check under **Settings → About & updates**.

To uninstall, use Windows **Settings → Apps → Installed apps → League Bro**.

If you installed the app before it was renamed to League Bro, updating installs League Bro next to the old copy and starts with default settings. Uninstall the old copy from Installed apps, and delete its old rune page and item set in the League client.

## What it does

### Recommendations (OP.GG)

When you hover or lock a champion, League Bro pulls OP.GG's ranked stats for that champion and role and shows the most popular rune page, summoner spells, skill order, starting items and build path, with game counts and win rate.

When OP.GG has other popular choices (up to three rune pages, summoner spell pairs, core builds and boots, each with enough games to trust), they show as numbered chips with their win rates. Hover one for details, click it to switch. In champ select, once you've picked that champion, switching re-imports your runes, spells and shop build right away, and the overlay follows your choice.

To look up any champion outside champ select, use the **Champions** tab: pick a champion, then Ranked (with a role) or ARAM.

### Rune, summoner spell and shop build auto-import

When you lock in, League Bro creates a rune page called `League Bro: <Champion> <Role>` and selects it. It reuses that one page every game, so your other pages are never touched. It also sets your summoner spells, keeping Flash on whichever key you already use.

It also adds OP.GG's build to the in-game shop as an item set with the same name: starter items, boots, core build and options for items 4 to 6, with win rates. It's listed first under **Item Sets** in the shop, so the shop opens on it. Like the rune page, it's one set that gets replaced each game, and your own item sets aren't touched. League Bro removes it when it closes, so it never shows up in a game League Bro isn't running for.

- **Where the page comes from:** OP.GG's most popular page. For rare picks with too few games on OP.GG, it uses the League client's own suggestion.
- **Options:** under **Settings → Recommendations** you can switch to League client suggestions only, or turn off summoner spells or the shop build. Turn on "Import while hovering" for blind pick. If all your page slots are full, delete one page, or turn on "Reuse the selected page when slots are full".

### Scouting

Each player card shows rank, LP, win rate, record and KDA over the last 20 games, most-played champions, and how often they've played their current pick.

- **Champ select:** only your party, plus everyone in normal games. Riot hides other players' names in ranked champ select, and League Bro follows that rule.
- **Loading screen:** all ten players, except anyone using streamer mode.

### In-game overlay

A small, click-through panel in the top-right corner shows:

- how your items compare with your lane opponent's: the total cost of each of your items, and the difference (green when you're ahead). The game doesn't share enemy gold, so this is item value, like Blitz shows. Not shown in modes without roles, like ARAM.
- objective timers: dragon (switching to Elder after a soul), Baron, and destroyed inhibitors
- which ability to max, plus a "Level up Q" hint whenever you have an unspent skill point
- the next two items to buy, with the price turning green when you can afford it. These come from OP.GG's build.

Under **Settings → Overlay** you can change its position and opacity, and choose which of these four parts it shows. Use **Preview overlay** to see where it sits.

### Post-game summary

When a game ends, the **Live** tab shows the result, your KDA, CS per minute, damage, gold, vision, kill share and items, plus a scoreboard for both teams. It stays until your next champ select, or until you close it.

### Your profile

Click **League Bro** (or your name) at the top of the window to open your profile: your rank, insights from your recent games (win rate, KDA, CS, damage and gold per minute, vision, streak, best champions and queues), and your match history. Click a match to see its full scoreboard. It covers the games the League client keeps, usually your last few dozen. Custom and practice games aren't included, and neither are Brawl or League Classic, which Riot doesn't allow apps to show.

### What it doesn't do

League Bro doesn't read game memory, use a Riot API key, or track enemy ability or summoner spell cooldowns. It uses only the League client's local API, Riot's official in-game data API (port 2999), and OP.GG's public stats, and stays within [Riot's third-party app rules](https://developer.riotgames.com/policies/general).

## Troubleshooting

| Problem | Fix |
| --- | --- |
| "League client not found" while League is open | Under **Settings**, enter your install folder, usually `C:\Riot Games\League of Legends`. If League runs as administrator, run League Bro as administrator too. |
| Overlay doesn't show in game | Set League to **Borderless** (League Bro shows a reminder when League is on Fullscreen), and make sure "Show the in-game overlay" is on in **Settings**. |
| Rune import fails | Your rune page slots are full. Delete one page, or turn on "Reuse the selected page when slots are full". |
| League Bro's build is missing or cut off in the shop | Another app (like Blitz) left item sets that show for every champion, ahead of League Bro's. **Settings → Recommendations** lists them; click **Move them aside** (you can put them back). |
| Objective timer is off | Riot changes spawn times between seasons. Report it on the **Feedback** tab so the next release can fix it. |
| Champion or item icons missing | Icons load from CommunityDragon and need an internet connection. |
| "Couldn't get OP.GG data" | OP.GG is unreachable or changed something. Runes fall back to the League client's suggestion automatically. You can also switch to "League client only" under **Settings → Recommendations**. |

Settings are stored in `%APPDATA%\dev.dom.leaguebro\settings.json`. Delete that file to reset everything.

---

## Development

Built with [Tauri 2](https://tauri.app) (Rust) and Angular 21.

### Quick setup (Windows)

Clone the repo, then run the setup script from the project folder:

```powershell
git clone https://github.com/doliaro/leaguebro.git
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
npm run tauri build    # build an installer into src-tauri\target\release\bundle\nsis\
cd src-tauri; cargo test   # Rust unit tests
```

In browser mode, add `?scene=champselect` to the URL to see champ select, or `?window=overlay` to see the overlay.

Don't run a dev copy and an installed copy of League Bro at the same time; both would try to manage your rune page.

### Troubleshooting setup

| Problem | Fix |
| --- | --- |
| `'git'` / `'node'` / `'cargo'` is not recognized | Close and reopen the terminal (and VS Code) so it picks up the new PATH. |
| `npm.ps1 cannot be loaded because running scripts is disabled` | Run `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`, or use `npm.cmd` instead of `npm`. |
| `linker 'link.exe' not found` | The Visual Studio Build Tools (C++ workload) are missing. Rerun the setup script or install them as above. |
| Stuck on `Waiting for your frontend dev server to start` | Something else is using port 4200, or `npm run start` failed. Run `npm start` alone to see the error. |
| `winget` isn't recognized | Install **App Installer** from the Microsoft Store, or use the manual links above. |

### Website

The download site is a single static page, `site/index.html`, published to GitHub Pages at https://doliaro.github.io/leaguebro/ by `.github/workflows/pages.yml` whenever `site/` changes on `main`. The page asks GitHub's API for the latest release in the visitor's browser, so a new release shows up on the site without republishing. To preview it locally, open `site/index.html` in a browser.

One-time setup: in the repo's **Settings → Pages**, set **Source** to **GitHub Actions**.

### Releasing a new version

Installers are built on GitHub's servers by `.github/workflows/build-windows.yml`, so releasing doesn't need Rust installed locally.

1. Bump the version, e.g. `0.1.6` → `0.1.7`. Installed copies only update to a higher version, so it has to go up:
   ```powershell
   scripts\bump-version.cmd 0.1.7
   ```
   That updates all five files that hold it (`src-tauri/tauri.conf.json`, `package.json`, `src-tauri/Cargo.toml`, `package-lock.json`, `src-tauri/Cargo.lock`), and refuses a version that isn't higher than the current one or the newest release tag.
2. Commit and push:
   ```powershell
   git add -A
   git commit -m "Release 0.1.7"
   git push
   ```
3. Go to **Actions → Release Windows installer → Run workflow**. About 10–15 minutes later, a new release appears with the installer attached. Everyone who has League Bro installed gets the update banner the next time it checks.

### Auto-updates

Installed copies check `releases/latest/download/latest.json` on startup and every 6 hours. Every update is signed, and the app only installs updates signed with the project's private key. The matching public key is in `src-tauri/tauri.conf.json` under `plugins.updater.pubkey`.

The release workflow needs two repository secrets (**Settings → Secrets and variables → Actions**):

| Secret | Value |
| --- | --- |
| `TAURI_SIGNING_PRIVATE_KEY` | the full contents of the private key file |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | its password |

Keep a backup of the key and password somewhere safe, like a password manager. If you lose them, installed copies can't verify new updates, and everyone has to reinstall manually once you set up a new key.

Dev builds (`npm run tauri dev`) never update themselves.

### Project layout

```
src/                       Angular UI (main window and overlay share one bundle)
  app/core/                Tauri bridge (rift.service.ts), models, demo data
  app/components/          Live, Runes, Builds, Settings and Overlay screens
src-tauri/src/
  lcu.rs                   finds the League client and talks to its local API
  engine.rs                background loop: game phase, champ select, loading screen, overlay
  runes.rs                 rune page selection and import
  scout.rs                 rank and match history lookups
  live.rs                  in-game data, objective timers, next-item and skill hints
  opgg.rs                  OP.GG recommendations (MCP client + response parser)
  config.rs                settings file
.github/workflows/         Windows installer release workflow
scripts/setup-dev.cmd      one-step dev environment setup (runs setup-dev.ps1)
```
