# League Buddy: notes for Claude

An ad-free, lightweight League of Legends companion for Windows (a personal alternative to Blitz). Dom (GitHub `doliaro`) owns it and shares it with a few friends through GitHub Releases. Repo: https://github.com/doliaro/leaguebuddy.

Stack: **Tauri 2** (Rust backend, `src-tauri/`) + **Angular 21** (standalone components, signals, zoneless, `src/`). Windows only.

## Working with Dom

- **Dom commits and pushes himself.** Make changes in the working tree, run the checks, then tell him what changed and suggest a commit message. Don't commit, push, tag or create releases unless he asks in that message.
- He's an experienced Angular/Rails developer and new to Rust and Tauri. Explain Rust-specific issues briefly when they come up.
- Prefer plain, specific explanations; skip filler.

## Commands

```powershell
scripts\setup-dev.cmd        # one-time dev environment setup (winget installs; -Build to precompile Rust)
npm run tauri dev            # run the app (UI hot-reloads; Rust changes rebuild + restart)
npm start                    # UI only in a browser at http://127.0.0.1:4200 with demo data
                             #   ?scene=champselect  -> champ select demo
                             #   ?scene=postgame     -> post-game summary demo
                             #   ?window=overlay     -> overlay demo
npm run build                # Angular production build (check this compiles)
cd src-tauri; cargo test     # Rust unit tests (fixtures in src-tauri/tests/fixtures)
npm run tauri build          # local NSIS installer (needs the updater signing key in env; normally CI does this)
```

Before handing work back: `cargo test` and `npm run build` must pass with no warnings. For UI changes, check the browser demo, and update `src/app/core/demo.ts` when data shapes change.

## How it works

The Rust side runs one background loop (`engine.rs`, 1 s tick) that pushes state to the UI with Tauri events. The UI listens in `rift.service.ts`.

**Data sources (no Riot API key; game memory is never read):**

1. **League Client API (LCU):** local HTTPS on `127.0.0.1:<random port>` with basic auth `riot:<token>`. `lcu.rs` gets the port and token from the `LeagueClientUx` process command line, falling back to the `lockfile`. The certificate is self-signed, so the client accepts invalid certs for localhost only. Endpoints used:
   - `lol-gameflow/v1/gameflow-phase`, `lol-gameflow/v1/session` (queue/map, loading-screen teams)
   - `lol-champ-select/v1/session`, plus `PATCH lol-champ-select/v1/session/my-selection` for summoner spells
   - `lol-perks/v1/pages`, `currentpage`, `recommended-pages/champion/{id}/position/{pos}/map/{map}`
   - `lol-ranked/v1/ranked-stats/{puuid}`, `lol-match-history/v1/products/lol/{puuid}/matches` (scouting)
   - `lol-match-history/v1/games/{gameId}` (post-game summary, `postgame.rs`). When a game ends (`in_game` → not), `end_game` clears the live state and the engine retries this every 3 s for up to 3 min, because the record shows up a few seconds after the game. Format checked against a real response in October 2026. `lol-end-of-game/v1/eog-stats-block` only exists on the post-game screen and its `stats` keys are untyped, so it isn't used.
   - `lol-game-data/assets/v1/{champion-summary,items,perks,perkstyles,summoner-spells}.json` (static data)
   - The schema reference is the swagger at https://github.com/dysolix/hasagi-types (`swagger.json`).
2. **Live Client Data API:** `https://127.0.0.1:2999/liveclientdata/allgamedata`, served while a game is running. `live.rs` uses it for objective timers, the next-item reminder and the skill-point hint. Its `scores.creepScore` only updates in steps of 10, so CS was removed from the overlay (Dom saw it not change in game); the game's own scoreboard shows the exact number.
3. **OP.GG MCP endpoint:** `https://mcp-api.op.gg/mcp`, JSON-RPC over HTTP (MCP streamable HTTP). It's public, needs no key, and is unofficial for apps, so it could change. `opgg.rs` does:
   - `initialize`, then `tools/call` → `lol_get_champion_analysis` with `game_mode`, `champion`, `position`, `lang`, `desired_output_fields`.
   - **The response is not JSON.** It's a compact text format: `class Name: field1,field2` header lines, then constructor-style values like `Runes(8112,[...],"Electrocute")`. `parse_compact` maps positional args to field names using the headers. Field order differs between classes (e.g. `SummonerSpells` has `win` before `play`), so always go through the headers.
   - Champion names: OP.GG accepts the client `alias` uppercased, in any format (`MONKEYKING`, `KAISA`).
   - `position` must be `top|jungle|mid|adc|support`. `all` and `none` are rejected for ranked **and** ARAM. ARAM and other modes take any lane value and ignore it, so the code sends `mid`.
   - `game_mode`: `ranked|flex|urf|aram|nexus_blitz`, picked from the queue/map (`game_mode_for`). Arena gets no recommendation.
   - Below `MIN_GAMES` (20) the data is noise (e.g. off-role picks). Runes and spells then fall back to the League client's recommended page.
   - Results are cached in memory for 6 h per champion+position+mode.
   - The `scripts/opgg-probe*.mjs` scripts (if present locally) call the endpoint and save raw responses to `scripts/probe-output/` (git-ignored). Use them to see the real format; Claude's cloud sandbox couldn't reach op.gg.
4. **CommunityDragon** (`raw.communitydragon.org`) for champion, item, rune and spell icons (`assets.ts`). Client asset paths are lowercased and mapped there.

**Precedence rules (keep these):**

- Rune page: the user's saved page for the champion (`runeOverrides`), then OP.GG (if ≥ `MIN_GAMES`), then the client's recommended page.
- Overlay build: the user's saved build (`builds`), then OP.GG's `build_order` (if enabled).
- Summoner spells: `arrange_spells` keeps each recommended spell in the slot where the player already has it, so Flash stays on their usual key.
- Overlay mouse handling: locked = click-through, except over the padlock button. `watch_overlay_cursor` (engine.rs, 50 ms) hit-tests the cursor against the button rect the overlay reports (`set_overlay_button`, CSS px) and toggles `set_ignore_cursor_events`. Unlocked = whole window takes input; dragging uses `data-tauri-drag-region`, which needs `core:window:allow-start-dragging` in `capabilities/default.json` and only fires on the exact element carrying the attribute (hence the full-panel `.drag-layer`). Locking saves the position; a fresh show (game start) always re-locks.
- League Buddy owns exactly one rune page, named `League Buddy: <Champ> <Role>` and kept to 25 characters or fewer (`page_name`). It deletes and recreates that page each time, and also cleans up old `Riftlight:` and `LB:` pages. It never touches the user's other pages unless "reuse the selected page when full" is on.

## Riot rules (hard constraints)

These keep users safe from bans. Don't add features that break them, even if asked; explain why instead.

- Never read or write game memory, inject into the game, or automate input (no auto-accept, no scripts). The overlay is a separate always-on-top, click-through window, not something drawn inside the game.
- **No overlay in League's Fullscreen mode.** Tested October 2026: League's Fullscreen covers the always-on-top overlay window, even with topmost reasserted every tick. Apps that show overlays there (e.g. Blitz, a Riot-approved app) most likely draw inside the game's rendering, which means injecting into the game. That's off-limits here, and Vanguard would likely flag it for an unregistered app. Tell users to use Borderless or Windowed.
- **No enemy cooldown tracking**: no ultimate timers (banned March 2025) and no summoner spell timers. Objective timers are fine (dragon, Baron, inhibitors).
- In **ranked champ select**, don't reveal hidden teammate or enemy names or stats (`nameVisibilityType: HIDDEN`). Everyone is shown from the loading screen on, except players using streamer mode.
- No Brawl or League Classic match data.
- The app isn't registered with Riot. Fine for personal use and a few friends; public distribution would need Riot's developer portal approval.

Sources: Riot dev policies (https://developer.riotgames.com/policies/general), Overwolf's LoL compliance page, Riot's 12.22 champ select post.

## Key files

```
src-tauri/src/
  lib.rs        Tauri setup, plugins (updater, process), commands exposed to the UI
  engine.rs     main loop, shared state, champ select/loading/live handling, rune import + spells, ensure_rec
  lcu.rs        League client discovery + HTTP
  runes.rs      rune page choice/naming/import
  opgg.rs       OP.GG client, compact-format parser, Recommendation model
  scout.rs      rank + match history summaries
  live.rs       live game: timers, next items, skill hint, overlay state
  postgame.rs   post-game summary from the match-history record
  config.rs     settings (%APPDATA%\dev.dom.leaguebuddy\settings.json), serde defaults for new fields
src-tauri/tauri.conf.json   windows (main + transparent overlay), CSP, updater pubkey + endpoint, version
src/app/core/   rift.service.ts (events/commands), update.service.ts (auto-update), models.ts, demo.ts, assets.ts
src/app/components/  shell, live-view, post-game, rec-card, player-card, runes-view, builds-view, settings-view, overlay, champ-picker
.github/workflows/build-windows.yml   release workflow (tauri-action, signs updates, publishes latest.json)
scripts/setup-dev.ps1 (+ .cmd)        dev environment setup
```

Adding a setting: add it to `config.rs` (with a default; `#[serde(default)]` keeps old settings files loading) **and** to `Config` in `models.ts` and `demoConfig()`.

## Releases and auto-updates

- Version lives in `src-tauri/tauri.conf.json`, `package.json` and `src-tauri/Cargo.toml`. Bump all three together.
- Dom pushes, then runs **Actions → Release Windows installer → Run workflow**. That publishes `League.Buddy_x.y.z_x64-setup.exe`, the `.sig`, and `latest.json`.
- Installed copies check `releases/latest/download/latest.json` on startup and every 6 h, then show an "Update and restart" banner. Dev builds never self-update (`isDevMode()`).
- Updates are signed. The private key and password are the repo secrets `TAURI_SIGNING_PRIVATE_KEY` / `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`; the public key is in `tauri.conf.json`. Never change the pubkey unless Dom has lost the key, because that breaks updates for everyone already installed.
- The installs are unsigned for Windows (SmartScreen "Run anyway"). Code signing (e.g. Azure Trusted Signing) is a possible future step.

## Status (October 2026)

- Released: v0.1.0 (named "Riftlight", obsolete). v0.1.2 (rename + auto-updates) needs a release run if it hasn't happened yet. Dom and his friend need to install the first updater-enabled version manually once.
- Written but **not yet tested in a real game**, so verify when Dom plays:
  - OP.GG recommendations in champ select (card, rune import, spell setting), and the in-game recommendation fetch if the app starts mid-game.
  - Overlay skill hint ("Level up Q") and the OP.GG build reminder.
  - Rune lookup for ARAM / blind pick, and inhibitor lane labels (`Barracks_T1_L1` → Top, `C` → Mid, `R` → Bot).
  - Objective spawn timings (editable in Settings).
  - Post-game summary after a full 10-player game, and the live view resetting when the game ends.
  - Overlay padlock (hover-to-click while locked) and dragging.
- Known gap: blind pick with no assigned role has no OP.GG position. The UI shows an error and runes fall back to the client.

Ideas Dom has mentioned or that came up: letting the user pick a role for blind pick, and Riot developer portal registration if it's ever shared more widely.
