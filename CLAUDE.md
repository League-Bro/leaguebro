# League Bro: notes for Claude

An ad-free, lightweight League of Legends companion for Windows (a personal alternative to Blitz). Dom (GitHub `doliaro`) owns it and shares it with a few friends through GitHub Releases. Repo: https://github.com/doliaro/leaguebro (renamed from `leaguebuddy` in October 2026; the app was renamed from League Buddy to League Bro in issue 5). Dom's local folder is still `Desktop\leaguebuddy`: a fresh clone elsewhere hit Windows Smart App Control blocking Cargo's build scripts, so he kept the old folder. The updater endpoint uses the new URL; copies installed before the rename still have the old one and rely on GitHub's redirect, so never create a new `doliaro/leaguebuddy` repo.

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
                             #   ?scene=swiftplay    -> Swiftplay lobby demo
                             #   ?window=overlay     -> overlay demo
                             #   ?fullscreen         -> "League is set to Fullscreen" hint (combines with ?scene=)
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
   - `lol-game-settings/v1/game-settings` → `General.WindowMode` (0 Fullscreen, 1 Windowed, 2 Borderless; same as `Config/game.cfg`, checked October 2026). Read on connect and every 15 s (`refresh_window_mode`) into `Status.window_mode`; the UI shows a "switch to Borderless" hint (`fullscreen-hint.ts`, Live tab + Settings → Overlay) while it's Fullscreen and the overlay is on.
   - `GET`/`PUT lol-item-sets/v1/item-sets/{summonerId}/sets` (shop build, `itemsets.rs`). `PUT` replaces the whole list, so read, swap our set, write back. Item `id`s are strings. Format checked with a real write and read-back in October 2026; block headers are kept ASCII because the in-game shop draws them.
   - `lol-perks/v1/pages`, `currentpage`, `recommended-pages/champion/{id}/position/{pos}/map/{map}`
   - `lol-lobby/v1/lobby/members/localMember/player-slots` (Swiftplay). Swiftplay (queue 480) has no champ select: you pick a champion, runes and spells per position slot in the lobby. In the `Lobby` phase the engine reads the slots every tick and imports each slot whose champion or position changed; the Live tab shows the slots (`swiftplay` event, `Shared.swiftplay`) with an "Import runes" button (`import_swiftplay_now`, every slot with a champion, even with auto-import off). `perks` is JSON in a string: `{"perkIds":[...],"perkStyle":8100,"perkSubStyle":8200}`. **Runes don't stick through `PUT player-slots`** (checked October 2026: spells changed, runes didn't), because the perks plugin keeps its own per champion+position (`lol-perks/v1/quick-play-selections/champion/{id}/position/{pos}`, GET only) and puts them back. So spells go through the `PUT` (the whole list, re-read first), runes through `POST player-slots/{index}/{perksString}` (the JSON percent-encoded in the path; not yet confirmed to stick), and the import reads the slots back and reports an error if the runes didn't take. All lobby writes return 400 while a game is running. Shop builds: one `League Bro:` item set per slot champion (`itemsets::apply_many`), written with the runes.
   - `lol-ranked/v1/ranked-stats/{puuid}`, `lol-match-history/v1/products/lol/{puuid}/matches` (scouting, and the Profile page via `profile.rs`). That endpoint returns only the requested player in each game, and the client keeps just a few dozen recent games (32 for Dom in October 2026, even when asked for 100). `profile::allowed` drops Brawl and League Classic games for both: League Classic by champion id ≥ 60000, Brawl by mode `BRAWL` / queue 2400 (not yet seen in real data, so check that when someone plays Brawl). The profile also drops custom/practice games, and its insights skip remakes. Lane/role in this data (`timeline.lane`/`role`) is unreliable, so there's no per-role breakdown. The profile's insights come for all queues plus per queue (`modes`), and the page starts on the queue you're in (`current_queue_id`, from the gameflow session). For enemy and lane-opponent stats ("toughest" lists: 2+ games, more losses than wins), `profile.rs` also fetches each game's full record (`games/{gameId}`, 8 at a time, kept in memory for the session); the lane opponent is a guess (`positions`: Smite = jungle, `timeline.lane`/`role`, lower-CS bot laner = support) and is left empty when two players on either side land on the same position.
   - `lol-match-history/v1/games/{gameId}` (post-game summary, `postgame.rs`). When a game ends (`in_game` → not), `end_game` clears the live state and the engine retries this every 3 s for up to 3 min, because the record shows up a few seconds after the game. Format checked against a real response in October 2026. `lol-end-of-game/v1/eog-stats-block` only exists on the post-game screen and its `stats` keys are untyped, so it isn't used.
   - `lol-game-data/assets/v1/{champion-summary,items,perks,perkstyles,summoner-spells}.json` (static data). `champion-summary` also lists League Classic copies of ~80 champions: same name, id = 60000 + the normal id, alias `Jade_…` (checked October 2026). `ChampInfo.classic` marks them (`is_league_classic`); the Champions tab lists them separately, and OP.GG lookups and the live-game name match skip them.
   - The schema reference is the swagger at https://github.com/dysolix/hasagi-types (`swagger.json`).
2. **Live Client Data API:** `https://127.0.0.1:2999/liveclientdata/allgamedata`, served while a game is running. `live.rs` uses it for objective timers, the next-item reminder, the skill-point hint and the lane item-value diff (`lane_diff`: you vs the enemy with the same `position`, summing `priceTotal` × `count` from the client's item list; none in ARAM etc. where positions are empty). It doesn't report enemy gold, so the diff is item value, like Blitz's; items are public on the scoreboard, so this is within Riot's rules. Its `scores.creepScore` only updates in steps of 10, so CS was removed from the overlay (Dom saw it not change in game); the game's own scoreboard shows the exact number.
3. **OP.GG**, two sources with the same numbers, both unofficial for apps (they could change):
   - **Website API (tried first, ~0.3 s):** `lol-api-champion.op.gg/api/global/champions/{mode}/{championId}/{lane}` (the JSON behind op.gg's champion pages) plus `…/builds` in parallel, whose `single_items` depth 4–6 are the 4th–6th item options. `lane` is `top|jungle|mid|adc|support`, or `none` for ARAM/URF/Nexus Blitz. No `tier` param = Emerald+, which matches the MCP tool. Each list is every option, most played first, with no names; `web_to_mcp` takes the first of each into the MCP tool's `data` shape so `extract` reads both (plus the top `PICK_OPTIONS` (3) runes, spells, boots and core builds as `<key>_options`; the MCP fallback only has the top one), and the UI names runes and items from the client's data. Damage type comes from the League client's `lol-game-data/assets/v1/champions/{id}.json` (`tacticalInfo.damageType`, local and instant; that's why `recommend` takes the `Lcu`). Checked October 2026 to give the same runes, spells and damage type as MCP (`cargo test live_lookup_speed -- --ignored --nocapture` compares them and prints timings).
   - **MCP endpoint (fallback, ~3.5 s, most of it OP.GG's server):** `https://mcp-api.op.gg/mcp`, JSON-RPC over HTTP (MCP streamable HTTP), public, no key. Used only when the website API fails or takes over 5 s. `opgg.rs` does:
   - `initialize`, then `tools/call` → `lol_get_champion_analysis` with `game_mode`, `champion`, `position`, `lang`, `desired_output_fields`.
   - **The response is not JSON.** It's a compact text format: `class Name: field1,field2` header lines, then constructor-style values like `Runes(8112,[...],"Electrocute")`. `parse_compact` maps positional args to field names using the headers. Field order differs between classes (e.g. `SummonerSpells` has `win` before `play`), so always go through the headers.
   - Champion names: OP.GG accepts the client `alias` uppercased, in any format (`MONKEYKING`, `KAISA`).
   - `position` must be `top|jungle|mid|adc|support`. `all` and `none` are rejected for ranked **and** ARAM. ARAM and other modes take any lane value and ignore it, so the code sends `mid`.
   - `game_mode`: `ranked|flex|urf|aram|nexus_blitz`, picked from the queue/map (`game_mode_for`). Arena gets no recommendation.
   - Below `MIN_GAMES` (20) the data is noise (e.g. off-role picks). Runes and spells then fall back to the League client's recommended page.
   - Results are saved to disk (`%LOCALAPPDATA%\dev.dom.leaguebro\opgg`, one file per champion+position+mode) and expire on the patch cycle (`expires_at`): every 24 h for the week after a patch's notes come out, then every 7 days, and always when the next notes are due (`patch::notes_releases_around`, from `PATCH_SCHEDULE`). If OP.GG can't be reached, an expired answer is used only if it was fetched since the latest patch notes; otherwise runes fall back to the client. Bump `opgg::CACHE_FORMAT` when `Recommendation`, `extract`, `Matchup` or `parse_matchup` changes (saved matchups share it).
   - **Picking another option:** `Recommendation` carries `rune_options`, `spell_options`, `core_options`, `boots_options` (option 0 is always the top one; others need ≥ `MIN_GAMES`). The rec card shows them as chips when there's more than one. `RecChoice` holds the picked indexes and `opgg::with_choice` swaps them into the runes, spells, core, boots and `build_order` (`games` stays the top page's). In champ select the pick lives in `sh.rec.choice` (`choose_rec_option` → `engine::choose`, which re-imports runes, spells and the item set if you've picked that champion); `RecState::effective()` is what the overlay and imports use, and `for_ui()` is what the UI gets. A new champion/role starts back on option 0. The Champions tab only previews (`rec_with_choice`, nothing imported).
   - **Lane matchup (`matchup.rs`, `rl-matchup` card above the rec card):** in lane modes (`ranked`/`flex`), once you lock in (`engine::matchup_key`; hovering starts nothing, since each lookup is a ~3.5 s MCP call plus a match history read), then again whenever the enemy picks or the opponent pick change. The client doesn't say which lane an enemy plays, so the opponent is a guess: OP.GG's games per lane for each picked champion (`TierLists::lane_games`, from the tier list's one OP.GG request), every enemy put in a different lane, likeliest arrangement kept, and only if that champion plays your lane in ≥ 5% of its games (`guess_opponent`). The player can pick another enemy or none (`choose_lane_opponent` → `Shared::opponent_pick`, cleared each champ select). Only enemy champions are used, never names. `OpGg::matchup` fetches the website API with `?target_champion={id}` (same shape as the champion's own answer, matchup games only; checked October 2026) plus the MCP tool `lol_get_lane_matchup_guide` (JSON, ~3.5 s, the only source of `opponent_champion_tip`, `lane_advantage_champion`, `lane_solo_kill_advantage_champion` (a champion name or `EVEN`) and `recommended_play_style`); the guide also stands in when the website fails. The head-to-head record is the opponent's entry in the answer's `counters` (`win` = your champion's wins). Saved like recs (`rec-m-…` files) only when the tip came back. Your own record vs them is `profile::record_against` (match history lane opponents). The matchup lives on `RecState.matchup` (kept when `ensure_rec` republishes); `RecChoice.matchup` switches imports, spells, the shop set and the overlay to the matchup build (`RecState::effective`, only with ≥ `MIN_GAMES`), and a new opponent resets it to all games. `cargo test live_matchup -- --ignored --nocapture` checks it against OP.GG.
   - The Champions tab uses the `lookup_rec` command (any champion, `ranked` + role or `aram`). It returns the recommendation directly and doesn't touch `sh.rec`, which belongs to champ select. `RecCard` shows champ select's rec unless given a `lookup` input. Saved per-champion rune pages and builds were removed in October 2026 (old `runeOverrides` / `builds` keys in settings.json are ignored and dropped on the next save); rune auto-import switches are in Settings → Rune import.
   - The `scripts/opgg-probe*.mjs` scripts (if present locally) call the endpoint and save raw responses to `scripts/probe-output/` (git-ignored). Use them to see the real format; Claude's cloud sandbox couldn't reach op.gg.
4. **CommunityDragon** (`raw.communitydragon.org`) for champion, item, rune and spell icons (`assets.ts`). Client asset paths are lowercased and mapped there. While the League client is closed it's also the source of the static data (`util::CDRAGON_GAME_DATA`, the same `lol-game-data/assets/v1` files: `engine::load_web_statics`, retried every minute) and of the rec card's damage type, so the Champions and Tier List tabs work without the client. The client's copy replaces it on connect.
5. **Riot patch notes** (`www.leagueoflegends.com`) for the Patch Notes tab (`patch.rs`). The site is Next.js, so `patch.rs` reads the JSON in `<script id="__NEXT_DATA__">`: the patch-notes tag page for the list, then each article's `richText.body` HTML, parsed with `scraper` into buffs, nerfs and adjustments. Only fetched when the Patch Notes tab is opened. Both are saved to disk (`%LOCALAPPDATA%\dev.dom.leaguebro\patch-notes`): a patch's notes are downloaded once and never again; the list is re-checked only when the next patch's notes are due (the day before that patch in `PATCH_SCHEDULE`, Riot's published dates; newest notes + 14 days once the table runs out), then at most every 6 h until they appear. **Add each new year's dates to `PATCH_SCHEDULE`** from https://support.riotgames.com/league-of-legends/gameplay/patch-schedule-league-of-legends. Bump `CACHE_FORMAT` when the parser or saved shapes change. `get_patch` only fetches URLs under `https://www.leagueoflegends.com/`. Fixtures: `tests/fixtures/patch_list.html`, `patch_article.html`.

**Precedence rules (keep these):**

- Rune page: OP.GG (if ≥ `MIN_GAMES`), then the client's recommended page.
- Overlay build: OP.GG's `build_order` (if ≥ `MIN_GAMES` and `useRecommendedBuilds` is on).
- Shop item set: on lock-in (same rules as spells: OP.GG, ≥ `MIN_GAMES`, `setItemSets` on), one set titled `League Bro: <Champ> <Role>` for that champion and map, blocks Starter / Boots / Core build / 4th-6th item options. Any other `League Bro:` set is replaced (Swiftplay writes one per lobby slot instead); the user's own sets are never touched. **Where it goes:** the shop lists sets that apply to every champion first and opens on the first one, and the client rewrites the `sortrank` apps send (champion sets always become 9999, checked October 2026), so a set in the client's list can't get ahead of a player's own global set. So, like Blitz, League Bro writes its sets as files, `Config\Global\Recommended\!!!!league-bro-<n>.json` (four `!` sorts ahead of Blitz's `!!!blitz-`), and removes any `League Bro:` set from the client's list. The client-list write is only the fallback when the install folder isn't found. Global files show for every champion and outlive the app, so they're removed when champ select starts, when League Bro quits (main window close), and on its first phase after connecting outside a game. They're not removed at game end, because Swiftplay writes them in the lobby and only rewrites when a pick changes. Each file also carries `associatedChampions`; whether the game honors that for global files is untested.
- Other apps' global item sets: the game reads item sets from files under `<install>\Config`; the client writes its own list there as `RIOT_ItemSet_<n>.json`, and some apps (Blitz: `Global\Recommended\!!!blitz-<n>.json`, seen October 2026) write files straight into `Config\Global\Recommended`. Global sets show for every champion, stay after the app closes, and are listed before champion-specific ones, so they can push League Bro's set out of the shop's dropdown. Settings → Recommendations lists them (`itemsets::scan_global`) and moves them to `Config\Global\Recommended-moved-by-league-bro` on request, with a put-back button. Never automatic, and never the client's own `RIOT_ItemSet_*` files. The install folder comes from `GET /data-store/v1/install-dir`, else Settings.
- Summoner spells: `arrange_spells` keeps each recommended spell in the slot where the player already has it, so Flash stays on their usual key.
- Overlay mouse handling: locked = click-through, except over the padlock button. `watch_overlay_cursor` (engine.rs, 50 ms) hit-tests the cursor against the button rect the overlay reports (`set_overlay_button`, CSS px) and toggles `set_ignore_cursor_events`. Unlocked = whole window takes input; dragging uses `data-tauri-drag-region`, which needs `core:window:allow-start-dragging` in `capabilities/default.json` and only fires on the exact element carrying the attribute (hence the full-panel `.drag-layer`). Locking saves the position; a fresh show (game start) always re-locks.
- Overlay contents: Settings → Overlay → "Show on the overlay" has one switch per part. `showLaneDiff` and `showTimers` only hide those parts in the overlay window (`overlay.ts`), so the Live tab keeps them; `showSkillHint` and `useRecommendedBuilds` are applied in the engine and need OP.GG recommendations (greyed out in Settings otherwise). The padlock always shows.
- League Bro owns exactly one rune page, named `League Bro: <Champ> <Role>` and kept to 25 characters or fewer (`page_name`). It deletes and recreates that page each time, and also cleans up old `Riftlight:` and `LB:` pages (`is_ours` matches the prefix plus `:`). It never touches the user's other pages unless "reuse the selected page when full" is on.

## Riot rules (hard constraints)

These keep users safe from bans. Don't add features that break them, even if asked; explain why instead.

- Never read or write game memory, inject into the game, or automate input (no auto-accept, no scripts). The overlay is a separate always-on-top, click-through window, not something drawn inside the game.
- **No overlay in League's Fullscreen mode.** Tested October 2026: League's Fullscreen covers the always-on-top overlay window, even with topmost reasserted every tick. Apps that show overlays there (e.g. Blitz, a Riot-approved app) most likely draw inside the game's rendering, which means injecting into the game. That's off-limits here, and Vanguard would likely flag it for an unregistered app. Tell users to use Borderless or Windowed (the app does, via the Fullscreen hint). Riot Developer Portal registration doesn't grant in-game drawing. An Xbox Game Bar widget does show over League's Fullscreen (Dom tested a pinned Game Bar widget, October 2026) and isn't injection, but it's a separate packaged UWP app with its own install and certificate, so Dom decided against it.
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
  itemsets.rs   OP.GG build as a client item set (in-game shop)
  opgg.rs       OP.GG client (website API, MCP fallback), compact-format parser, Recommendation model
  patch.rs      Riot patch notes: list + article parsing into buffs/nerfs, PATCH_SCHEDULE
  cache.rs      on-disk cache folders (patch notes, OP.GG), usage + clearing for Settings
  scout.rs      rank + match history summaries
  live.rs       live game: timers, next items, skill hint, overlay state
  postgame.rs   post-game summary from the match-history record
  profile.rs    your profile: rank, recent matches, insights; the Brawl/League Classic filter
  matchup.rs    lane opponent guess (champ select) + matchup lookup onto RecState.matchup
  config.rs     settings (%APPDATA%\dev.dom.leaguebro\settings.json), serde defaults for new fields
  util.rs       shared JSON accessors (int/text/list…, a key or a /pointer), web client + get_json, error text
src-tauri/tauri.conf.json   windows (main + transparent overlay), CSP, updater pubkey + endpoint, version
src/app/core/   rift.service.ts (events/commands), update.service.ts (auto-update), models.ts, demo.ts, assets.ts, why.ts (recommendation explanations)
src/app/components/  shell, live-view, post-game, champions-view, profile-view, rec-card, player-card, patch-view, settings-view, feedback-view, overlay
                     (the Profile page isn't in the tab bar; the "League Bro" brand and your name in the header open it)
.github/workflows/build-windows.yml   release workflow (tauri-action, signs updates, publishes latest.json)
.github/workflows/pages.yml           publishes site/ to GitHub Pages (https://doliaro.github.io/leaguebro/)
.github/ISSUE_TEMPLATE/               bug report + feature request issue forms; the Feedback tab opens them prefilled
                                      (query params = field ids) via `open_issue_page`, which only opens github.com/doliaro/leaguebro/issues links
site/index.html                       download website: one static page, no build step; the download button
                                      reads releases/latest from GitHub's API in the browser and picks the
                                      *-setup.exe asset, falling back to the releases page
scripts/setup-dev.ps1 (+ .cmd)        dev environment setup
scripts/bump-version.ps1 (+ .cmd)     sets the version in all five files before a release
```

Adding a setting: add it to `config.rs` (with a default; `#[serde(default)]` keeps old settings files loading) **and** to `Config` in `models.ts` and `demoConfig()`.

## Releases and auto-updates

- Version lives in `src-tauri/tauri.conf.json`, `package.json` and `src-tauri/Cargo.toml`, mirrored in `package-lock.json` (twice) and `Cargo.lock` (the `leaguebro` entry). Bump with `scripts\bump-version.cmd <x.y.z>`: it edits just those six spots (no find-and-replace; the lock files hold unrelated packages at the same version numbers), refuses a version not higher than the current one or the newest local `v*` tag, and writes nothing unless every spot matched.
- Dom pushes, then runs **Actions → Release Windows installer → Run workflow**. That publishes `League.Bro_x.y.z_x64-setup.exe`, the `.sig`, and `latest.json`.
- Installed copies check `releases/latest/download/latest.json` on startup and every 6 h, then show an "Update and restart" banner. Dev builds never self-update (`isDevMode()`).
- Updates are signed. The private key and password are the repo secrets `TAURI_SIGNING_PRIVATE_KEY` / `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`; the public key is in `tauri.conf.json`. Never change the pubkey unless Dom has lost the key, because that breaks updates for everyone already installed.
- The website (`site/`) needs no change per release. Keep its copy in step with the app when features change, and keep the Riot "isn't endorsed by Riot Games" notice in its footer (required for fan projects). It uses no Riot logos or champion art.
- The installs are unsigned for Windows (SmartScreen "Run anyway"). Code signing (e.g. Azure Trusted Signing) is a possible future step.

## Status (October 2026)

- Released: v0.1.0 (named "Riftlight", obsolete). v0.1.2 (rename + auto-updates) needs a release run if it hasn't happened yet. Dom and his friend need to install the first updater-enabled version manually once.
- Renamed to League Bro in issue 5 (identifier now `dev.dom.leaguebro`). Settings are **not** carried over from the old identifier, pages and item sets made under the old name are not cleaned up, and since the NSIS install folder and uninstall entry follow `productName`, updating an old install puts League Bro next to it. Users should uninstall the old copy and delete its leftover rune page.
- Written but **not yet tested in a real game**, so verify when Dom plays:
  - OP.GG recommendations in champ select (card, rune import, spell setting), and the in-game recommendation fetch if the app starts mid-game.
  - Overlay skill hint ("Level up Q") and the OP.GG build reminder.
  - Rune lookup for ARAM / blind pick, and inhibitor lane labels (`Barracks_T1_L1` → Top, `C` → Mid, `R` → Bot).
  - Objective spawn timings. They're the `TimerConfig` defaults in `config.rs` (no longer editable in Settings, as of October 2026); when Riot moves a spawn, change the default and release. A user's `settings.json` keeps whatever `timers` values it already has.
  - Post-game summary after a full 10-player game, and the live view resetting when the game ends.
  - The League Bro item set showing in the in-game shop (written on lock-in).
  - Swiftplay: that the per-slot `POST` keeps the runes (the import says so if not), that the game uses them, and that the two item sets show in the shop.
  - Overlay padlock (hover-to-click while locked) and dragging.
  - Lane item-value diff: that `position` matches up with the right enemy in ranked/normal draft.
  - Lane matchup: how often the lane-opponent guess is right in ranked draft, that the MCP guide answers for most champions, and importing the "vs" build.
  - Profile page against real data (icon, level, ranks, a match's full scoreboard).
  - Profile lane opponents: how often the `timeline.lane`/`role` guess finds one in real games, and that it's the right champion. Also how long the first load takes with ~32 full-record fetches.
- Known gap: blind pick with no assigned role has no OP.GG position. The UI shows an error and runes fall back to the client.

Ideas Dom has mentioned or that came up: letting the user pick a role for blind pick, and Riot developer portal registration if it's ever shared more widely.
