# Riftlight

A small, ad-free League of Legends companion: rune auto-import, player scouting, and an in-game overlay. Built with Tauri 2 (Rust) and Angular 21.

## What it does

- **Rune auto-import.** When you lock in a champion, Riftlight creates a page called `Riftlight: <Champion> <Role>` and selects it. It replaces that one page each game. The page comes from the League client's own recommended page for your champion and role. To use your own page for a champion instead, select it in the rune editor and save it on the **Runes** tab.
- **Scouting.** Shows rank, recent record, KDA and most-played champions.
  - **In champ select:** only players whose names the client shows (your party, and everyone in normals). Ranked hides the rest until loading, per Riot's rules.
  - **On the loading screen:** all ten players, except anyone using streamer mode.
- **Overlay.** Shows the game clock, your KDA and CS, and objective timers (dragon/Elder, Baron, inhibitors). It also shows the next two items from the build you saved for your champion on the **Builds** tab. It is click-through and sits in the top-right corner by default.

Everything comes from two local APIs on your own PC: the League client API and Riot's Live Client Data API (port 2999). Riftlight doesn't read game memory, needs no Riot API key, and doesn't track enemy cooldowns. Champion and item icons load from CommunityDragon.

## Building it on Windows

You need, once:

1. **Node.js 22 LTS** (22.12 or newer): <https://nodejs.org>
2. **Rust**: <https://rustup.rs>. Install with the defaults.
3. **Microsoft C++ Build Tools**: <https://visualstudio.microsoft.com/visual-cpp-build-tools/>. Pick "Desktop development with C++".
4. WebView2 already ships with Windows 10/11.

Then, in this folder:

```powershell
npm install
npm run tauri dev      # run it with live reload
npm run tauri build    # make an installer
```

The installer lands in `src-tauri\target\release\bundle\nsis\`. The first build takes a few minutes; later ones are fast.

**No Rust on your PC?** Push this folder to GitHub and run **Release Windows installer** from the Actions tab. It builds the installer on GitHub's servers and publishes it as a Release. Share `https://github.com/<you>/<repo>/releases/latest` with friends: they download the `-setup.exe`, run it, and they're done. On the first run Windows SmartScreen says "Windows protected your PC" because the app isn't code-signed; click **More info → Run anyway**. Bump `version` in `src-tauri/tauri.conf.json` before each new release.

**Working on the UI only?** `npm start` opens it at http://localhost:4200 with demo data. Add `?scene=champselect` to see champ select, or `?window=overlay` to see the overlay.

## Using it

- Set League to **Borderless** or **Windowed** (Settings → Video → Window Mode). Exclusive fullscreen draws over the overlay.
- If Riftlight shows "League client not found" while League is open, enter your install folder under **Settings**. It is usually `C:\Riot Games\League of Legends`.
- If rune import says your page slots are full, delete one page in the client. Riftlight only ever uses one slot. You can also turn on "Reuse the selected page when slots are full".
- Settings are saved to `%APPDATA%\dev.dom.riftlight\settings.json`.

## Project layout

```
src/                       Angular UI (main window + overlay, same bundle)
  app/core/                Tauri bridge (rift.service.ts), models, demo data
  app/components/          Live, Runes, Builds, Settings, Overlay screens
src-tauri/src/
  lcu.rs                   finds the League client and talks to it
  engine.rs                background loop: game phase, champ select, loading, overlay
  runes.rs                 rune page selection and import
  scout.rs                 rank + match history lookups
  live.rs                  in-game data, objective timers, next-item reminder
  config.rs                settings file
```

Rust unit tests: `cd src-tauri && cargo test`.

## Things to check on first run

These parts were written against Riot's published API schema but couldn't be tested against a live client:

- Rune recommendation lookup for ARAM/blind pick (no assigned role). The code tries several position values.
- Inhibitor lane labels in the overlay (`Barracks_T1_L1` read as Top, `C` as Mid, `R` as Bot).
- Objective timings. These change between seasons, so all of them can be edited under Settings.
