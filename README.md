# League Buddy

A small, ad-free League of Legends companion for Windows. It imports your runes automatically, shows who you're playing with and against, and adds a lightweight in-game overlay with objective timers. There are no ads, no accounts and no tracking.

## Install

1. Go to the **[latest release](https://github.com/doliaro/leaguebuddy/releases/latest)** and download `League.Buddy_x.y.z_x64-setup.exe`.
2. Run it. If Windows shows **"Windows protected your PC"**, click **More info → Run anyway**. That warning appears because the app isn't code-signed, not because something is wrong with it.
3. Open League Buddy, then open League. It connects on its own.

In League, set **Settings → Video → Window Mode** to **Borderless** (or Windowed). Otherwise the game covers the overlay.

To uninstall, use Windows **Settings → Apps → Installed apps → League Buddy**.

## What it does

### Rune auto-import

When you lock in a champion, League Buddy creates a rune page called `League Buddy: <Champion> <Role>` and selects it. It reuses that one page every game, so your other pages are never touched.

- **Default:** the League client's own recommended page for your champion and role.
- **Your own page:** select it in the client's rune editor, then save it for that champion on the **Runes** tab. From then on League Buddy uses yours.
- **Options:** turn on "Import while hovering" for blind pick. If all your page slots are full, delete one page, or turn on "Reuse the selected page when slots are full".

### Scouting

Each player card shows rank, LP, win rate, record and KDA over the last 20 games, most-played champions, and how often they've played their current pick.

- **Champ select:** only your party, plus everyone in normal games. Riot hides other players' names in ranked champ select, and League Buddy follows that rule.
- **Loading screen:** all ten players, except anyone using streamer mode.

### In-game overlay

A small, click-through panel in the top-right corner shows:

- the game clock, your KDA and CS
- objective timers: dragon (switching to Elder after a soul), Baron, and destroyed inhibitors
- the next two items from your saved build for that champion, with the price turning green when you can afford it. Set up builds on the **Builds** tab.

You can change the overlay's position, opacity and the timer values under **Settings**. Use **Preview overlay** to see where it sits.

### What it doesn't do

League Buddy doesn't read game memory, use a Riot API key, or track enemy ability or summoner spell cooldowns. It uses only the League client's local API and Riot's official in-game data API (port 2999), and stays within [Riot's third-party app rules](https://developer.riotgames.com/policies/general).

## Troubleshooting

| Problem | Fix |
| --- | --- |
| "League client not found" while League is open | Under **Settings**, enter your install folder, usually `C:\Riot Games\League of Legends`. If League runs as administrator, run League Buddy as administrator too. |
| Overlay doesn't show in game | Set League to **Borderless**, and make sure "Show the in-game overlay" is on in **Settings**. |
| Rune import fails | Your rune page slots are full. Delete one page, or turn on "Reuse the selected page when slots are full". |
| Objective timer is off | Riot changes spawn times between seasons. Adjust them under **Settings → Objective timers**. |
| Champion or item icons missing | Icons load from CommunityDragon and need an internet connection. |

Settings are stored in `%APPDATA%\dev.dom.leaguebuddy\settings.json`. Delete that file to reset everything.

---

## Development

Built with [Tauri 2](https://tauri.app) (Rust) and Angular 21.

### Prerequisites (Windows)

- [Node.js 22 LTS](https://nodejs.org)
- [Rust](https://rustup.rs), installed with the defaults
- [Microsoft C++ Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/), with "Desktop development with C++" selected
- [Git](https://git-scm.com)

### Run and build

```powershell
npm install
npm run tauri dev      # run the app with live reload
npm run tauri build    # build an installer into src-tauri\target\release\bundle\nsis\
```

`npm start` runs only the UI at http://localhost:4200, with demo data and no League needed. Add `?scene=champselect` to see champ select, or `?window=overlay` to see the overlay.

Rust tests: `cd src-tauri; cargo test`

### Releasing a new version

Installers are built on GitHub's servers by `.github/workflows/build-windows.yml`, so releasing doesn't need Rust installed locally.

1. Bump `version` in `src-tauri/tauri.conf.json` (and `package.json` to match), e.g. `0.1.0` → `0.1.1`.
2. Commit and push:
   ```powershell
   git add -A
   git commit -m "Release 0.1.1"
   git push
   ```
3. Go to **Actions → Release Windows installer → Run workflow**. About 10–15 minutes later, a new release appears with the installer attached.

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
  live.rs                  in-game data, objective timers, next-item reminder
  config.rs                settings file
.github/workflows/         Windows installer release workflow
```
