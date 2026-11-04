import { ChangeDetectionStrategy, Component, effect, inject, signal, untracked } from '@angular/core';
import { UpdateService } from '../core/update.service';
import { IS_MAC } from '../core/platform';
import { AbilityKeys, CacheInfo, CacheName, GlobalSets } from '../core/models';
import { ConfigPage } from './config-page';
import { OverlaySettingsView } from './overlay-settings';
import { FeedbackView } from './feedback-view';

type Section = 'overlay' | 'champselect' | 'display' | 'app' | 'feedback';

/** The section you were on, so leaving Settings and coming back opens it again (this run only). */
let lastSection: Section = 'overlay';

@Component({
  selector: 'rl-settings',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [OverlaySettingsView, FeedbackView],
  template: `
    @if (rift.config(); as cfg) {
      <div class="layout">
        <nav class="side" aria-label="Settings sections">
          @for (s of sections; track s.id) {
            <button [class.on]="section() === s.id" [attr.aria-current]="section() === s.id ? 'page' : null" (click)="show(s.id)">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path [attr.d]="s.icon" /></svg>
              <span class="label"><b>{{ s.label }}</b><span>{{ s.hint }}</span></span>
              @if (s.id === 'overlay') { <span class="pill" [class.on]="cfg.overlayEnabled">{{ cfg.overlayEnabled ? 'On' : 'Off' }}</span> }
            </button>
          }
        </nav>
        <div class="pane">
          @switch (section()) {
            @case ('champselect') {
              <div class="grid">
              <section class="card stack">
                <h2>Recommendations</h2>
                <div class="seg">
                  <button [class.on]="cfg.recSource === 'opgg'" (click)="set('recSource', 'opgg')">OP.GG meta</button>
                  <button [class.on]="cfg.recSource === 'client'" (click)="set('recSource', 'client')">League client only</button>
                </div>
                <p class="faint small">
                  @if (cfg.recSource === 'opgg') {
                    Runes, summoner spells, skill order and items come from OP.GG's ranked stats for your champion and role.
                  } @else {
                    Runes come from the League client's built-in suggestions. No spells, skill order or item builds.
                  }
                </p>
                @if (cfg.recSource === 'opgg') {
                  <label class="toggle">
                    <input type="checkbox" [checked]="cfg.setSummonerSpells" (change)="set('setSummonerSpells', $any($event.target).checked)" />
                    <span class="track"></span>
                    <span class="label"><b>Set summoner spells</b><span>On lock-in. Flash stays on whichever key you already use.</span></span>
                  </label>
                  <label class="toggle">
                    <input type="checkbox" [checked]="cfg.setItemSets" (change)="set('setItemSets', $any($event.target).checked)" />
                    <span class="track"></span>
                    <span class="label"><b>Add the build to the in-game shop</b><span>On lock-in, as a "League Bro" item set listed first under Item Sets, so the shop opens on it. Your own item sets aren't touched.</span></span>
                  </label>
                }
                @if (global(); as gs) {
                  @if (gs.found.length || gs.moved.length) {
                    <div class="global-sets">
                      @if (gs.found.length) {
                        <b>Other apps' item sets are in every game's shop</b>
                        <p class="faint small">
                          {{ gs.found.join(', ') }}. Another app saved {{ gs.found.length === 1 ? 'this' : 'these' }} for every
                          champion, so {{ gs.found.length === 1 ? 'it shows' : 'they show' }} first in the shop and can push League Bro's
                          build out of the list. Moving them aside keeps a copy you can put back.
                        </p>
                        <div class="row">
                          <button [disabled]="globalBusy()" (click)="moveGlobal()">Move them aside</button>
                        </div>
                      }
                      @if (gs.moved.length) {
                        <p class="faint small">
                          Moved aside: {{ gs.moved.join(', ') }}.
                          <button class="link" [disabled]="globalBusy()" (click)="restoreGlobal()">Put them back</button>
                        </p>
                      }
                    </div>
                  }
                }
              </section>

              <section class="card stack">
                <h2>Rune import</h2>
                <label class="toggle">
                  <input type="checkbox" [checked]="cfg.autoImportRunes" (change)="set('autoImportRunes', $any($event.target).checked)" />
                  <span class="track"></span>
                  <span class="label"><b>Import runes</b><span>In champ select, creates one page called "League Bro: …" and overwrites it each game. In a Swiftplay lobby, sets the runes of each champion you pick there.</span></span>
                </label>
                <label class="toggle">
                  <input type="checkbox" [checked]="cfg.importOnHover" (change)="set('importOnHover', $any($event.target).checked)" />
                  <span class="track"></span>
                  <span class="label"><b>Import while hovering</b><span>Don't wait for lock-in. Handy for blind pick.</span></span>
                </label>
                <label class="toggle">
                  <input type="checkbox" [checked]="cfg.keepMyPagesWhenFull" (change)="set('keepMyPagesWhenFull', $any($event.target).checked)" />
                  <span class="track"></span>
                  <span class="label"><b>Keep my pages when slots are full</b><span>If every slot is used and there's no League Bro page yet, League Bro takes over the selected page once and reuses it after that. Turn on to get an error instead.</span></span>
                </label>
              </section>

              <section class="card stack">
                <h2>Scouting</h2>
                <label class="toggle">
                  <input type="checkbox" [checked]="cfg.scoutInChampSelect" (change)="set('scoutInChampSelect', $any($event.target).checked)" />
                  <span class="track"></span>
                  <span class="label"><b>Look up teammates in champ select</b><span>Only players whose names the client shows: your party, and everyone in normals. Ranked hides the rest until loading.</span></span>
                </label>
                <label class="toggle">
                  <input type="checkbox" [checked]="cfg.scoutOnLoading" (change)="set('scoutOnLoading', $any($event.target).checked)" />
                  <span class="track"></span>
                  <span class="label"><b>Look up all ten players on the loading screen</b><span>Ranks and recent games, straight from the League client. No API key needed.</span></span>
                </label>
              </section>

              </div>
            }
            @case ('overlay') { <rl-overlay-settings /> }
            @case ('feedback') { <rl-feedback /> }
            @case ('display') {
              <div class="grid">
              <section class="card stack">
                <h2>Ability keys</h2>
                <p class="faint small">Rebound your abilities in League? Enter your keys and every skill order in League Bro shows them instead of Q W E R.</p>
                <div class="setting-field">
                  @for (k of abilitySlots; track k) {
                    <label class="keybind">
                      <span class="faint small">{{ k.toUpperCase() }}</span>
                      <input type="text" class="key" maxlength="12" [placeholder]="k.toUpperCase()" [value]="cfg.abilityKeys[k]"
                        [attr.aria-label]="'Your key for the ' + k.toUpperCase() + ' ability'" (input)="setKey(k, $any($event.target).value)" />
                    </label>
                  }
                  <button class="ghost icon-btn" (click)="resetKeys()" title="Reset keys" aria-label="Reset keys"><svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M4 12a8 8 0 1 0 2.34-5.66M4 4v5h5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" /></svg></button>
                </div>
              </section>

              <section class="card stack">
                <h2>Post-game</h2>
                <label class="toggle">
                  <input type="checkbox" [checked]="cfg.showRoasts" (change)="set('showRoasts', $any($event.target).checked)" />
                  <span class="track"></span>
                  <span class="label"><b>Roasts</b><span>"The Bro's review" after each game: a bit of trash talk for what went badly, and some hype for what went well. Also shown for other players when you click them.</span></span>
                </label>
              </section>

              </div>
            }
            @case ('app') {
              <div class="grid">
              <section class="card stack">
                <h2>About &amp; updates</h2>
                <p class="muted small">
                  @if (updates.currentVersion()) { League Bro {{ updates.currentVersion() }} } @else { League Bro (dev build) }
                </p>
                <p class="faint small">League Bro updates itself when it starts. While it runs, it checks every minute (and when you come back to it) and asks before installing. It never updates during champ select or a game.</p>
                <div class="row">
                  <button [disabled]="updates.checking() || !updates.currentVersion()" (click)="updates.check(true)">
                    {{ updates.checking() ? 'Checking…' : 'Check for updates' }}
                  </button>
                  @if (updates.lastResult()) { <span class="faint small">{{ updates.lastResult() }}</span> }
                </div>
                @if (updates.launchNote()) { <p class="faint small">{{ updates.launchNote() }}</p> }
              </section>

              <section class="card stack">
                <h2>Privacy</h2>
                <label class="toggle">
                  <input type="checkbox" [checked]="cfg.shareUsageStats" (change)="set('shareUsageStats', $any($event.target).checked)" />
                  <span class="track"></span>
                  <span class="label"><b>Share anonymous usage stats</b><span>Once a day, League Bro says "the app was opened" with a random ID made up on this computer, the app version and the {{ osName }} version. Never your Riot ID, games or settings. It only helps count how many people use the app.</span></span>
                </label>
              </section>

              <section class="card stack">
                <h2>Troubleshooting</h2>
                <h3 class="setting-head first">League install folder</h3>
                <p class="faint small">Only needed if League Bro never connects. It normally finds the client on its own.</p>
                <div class="setting-field">
                  <input type="text" class="wide" [placeholder]="installHint" [value]="cfg.installDir ?? ''"
                    (change)="setInstall($any($event.target).value)" />
                </div>
                <h3 class="setting-head">Clear cache</h3>
                <p class="faint small">Saved downloads. Clearing one fetches a fresh copy the next time it's needed.</p>
                @for (c of cacheRows; track c.key) {
                  <div class="cache-row">
                    <span class="label"><b>{{ c.label }}</b><span>{{ c.hint }}</span></span>
                    <span class="mono faint">{{ usage(c.key) }}</span>
                    <button class="ghost" [disabled]="clearing() === c.key || isEmpty(c.key)" (click)="clearCache(c.key)">
                      {{ clearing() === c.key ? 'Clearing…' : 'Clear' }}
                    </button>
                  </div>
                }
              </section>

              </div>
            }
          }
        </div>
      </div>
      @if (error()) { <p class="loss">{{ error() }}</p> }
    }
  `,
  styles: `
    /* A list of sections on the left, one section's cards on the right. */
    .layout { display: grid; grid-template-columns: 232px minmax(0, 1fr); gap: 24px; align-items: start; }
    .side { position: sticky; top: 0; display: flex; flex-direction: column; gap: 4px; }
    .side button {
      display: flex; align-items: center; gap: 12px; padding: 10px 12px; text-align: left;
      background: none; border: 1px solid transparent; border-radius: var(--radius-sm); color: var(--text-dim);
    }
    .side button:hover:not(:disabled) { background: var(--bg-hover); color: var(--text); }
    .side button.on, .side button.on:hover:not(:disabled) { background: var(--accent-soft); border-color: var(--line); color: var(--text); }
    .side svg { width: 20px; height: 20px; flex: none; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
    .side button.on svg { stroke: var(--accent); }
    .side .label { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
    .side .label b { font-weight: 600; }
    .side .label span { font-size: 12px; color: var(--text-faint); }
    .pill {
      font: 600 10.5px var(--mono); text-transform: uppercase; padding: 1px 7px; border-radius: 999px;
      color: var(--text-faint); border: 1px solid var(--line-strong);
    }
    .pill.on { color: var(--win); border-color: color-mix(in srgb, var(--win) 45%, transparent); }
    .pane { min-width: 0; }
    /* A narrow window: the sections become a row of tabs above the cards. */
    @media (max-width: 1080px) {
      .layout { grid-template-columns: minmax(0, 1fr); gap: 16px; }
      .side { position: static; flex-direction: row; flex-wrap: wrap; }
      .side button { flex: 1 1 0; padding: 8px 12px; }
      .side .label span { display: none; }
    }
    /* Columns, not a grid row per pair of cards: a tall card no longer
       leaves a gap next to a short one, and cards fill each column in order. */
    .grid { columns: 360px 2; column-gap: 16px; }
    .grid > .card { break-inside: avoid; margin-bottom: 16px; gap: 6px; }
    .wide { flex: 1; }
    .keybind { display: flex; flex-direction: column; align-items: center; gap: 2px; }
    .key { width: 52px; text-align: center; text-transform: uppercase; }
    .global-sets {
      display: flex; flex-direction: column; gap: 6px; margin-top: 4px; padding: 10px 12px;
      border: 1px solid var(--line-strong); border-radius: 10px; background: var(--bg-sunken);
    }
    .global-sets .small { line-height: 1.45; }
    .link { background: none; border: none; padding: 0; margin-left: 4px; color: var(--accent); font: inherit; cursor: pointer; }
    .link:disabled { opacity: 0.5; cursor: default; }
    .cache-row { display: flex; align-items: center; gap: 12px; }
    .cache-row .label { flex: 1; display: flex; flex-direction: column; gap: 2px; }
    .cache-row .label span { font-size: 12.5px; color: var(--text-faint); }
    .cache-row .mono { white-space: nowrap; }
  `,
})
export class SettingsView extends ConfigPage {
  /** Icons are 24×24 stroke paths. */
  protected readonly sections: { id: Section; label: string; hint: string; icon: string }[] = [
    { id: 'overlay', label: 'Overlay', hint: 'The in-game panel', icon: 'M3 5h18v12H3z M8 21h8 M14 8h4v4h-4z' },
    { id: 'champselect', label: 'Champ select', hint: 'Builds, runes and scouting', icon: 'M12 3l7 3v5c0 4.5-3 8.3-7 10-4-1.7-7-5.5-7-10V6z M9 12l2 2 4-4' },
    { id: 'display', label: 'Display', hint: 'Ability keys, post-game', icon: 'M4 7h16v10H4z M8 11h1 M11.5 11h1 M15 11h1 M8 14h8' },
    { id: 'app', label: 'App', hint: 'Updates, privacy, cache', icon: 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z M12 2v3 M12 19v3 M4.9 4.9l2.1 2.1 M17 17l2.1 2.1 M2 12h3 M19 12h3 M4.9 19.1 7 17 M17 7l2.1-2.1' },
    { id: 'feedback', label: 'Feedback', hint: 'Report a bug, share an idea', icon: 'M4 5h16v11H9l-5 4z M8 9h8 M8 12h5' },
  ];
  protected readonly section = signal<Section>(lastSection);
  protected show(s: Section): void {
    lastSection = s;
    this.section.set(s);
  }
  protected readonly updates = inject(UpdateService);
  protected readonly abilitySlots: (keyof AbilityKeys)[] = ['q', 'w', 'e', 'r'];
  protected readonly osName = IS_MAC ? 'macOS' : 'Windows';
  protected readonly installHint = IS_MAC ? '/Applications/League of Legends.app/Contents/LoL' : 'C:\\Riot Games\\League of Legends';

  protected readonly cache = signal<CacheInfo | null>(null);
  protected readonly clearing = signal<CacheName | null>(null);
  protected readonly cacheRows: { key: CacheName; label: string; hint: string }[] = [
    { key: 'patchNotes', label: 'Patch notes', hint: 'The patch list and every patch you opened.' },
    { key: 'runes', label: 'Rune pages', hint: 'OP.GG runes, spells, skill order and builds.' },
  ];

  /** Other apps' global item sets; null until loaded or while League isn't found. */
  protected readonly global = signal<GlobalSets | null>(null);
  protected readonly globalBusy = signal(false);

  constructor() {
    super();
    // Reloaded whenever a recommendation arrives, since that's when the rune
    // cache grows. Patch notes only change on the Patch Notes tab, and coming
    // back here recreates this view.
    effect(() => {
      this.rift.rec();
      untracked(() => this.refreshCache());
    });
    // Needs League's folder, which comes from the client once connected.
    effect(() => {
      if (this.rift.status().connected) untracked(() => this.refreshGlobal());
    });
  }

  private refreshGlobal(): void {
    // Not finding League's folder isn't worth an error here; the section just stays hidden.
    this.rift.globalItemSets().then((g) => this.global.set(g), () => this.global.set(null));
  }

  async moveGlobal(): Promise<void> {
    await this.globalAction(() => this.rift.moveGlobalItemSets());
  }
  async restoreGlobal(): Promise<void> {
    await this.globalAction(() => this.rift.restoreGlobalItemSets());
  }
  private async globalAction(run: () => Promise<GlobalSets>): Promise<void> {
    this.globalBusy.set(true);
    this.error.set('');
    try {
      this.global.set(await run());
    } catch (e) {
      this.error.set(String(e));
    } finally {
      this.globalBusy.set(false);
    }
  }

  private refreshCache(): void {
    this.rift.cacheInfo().then((c) => this.cache.set(c), (e) => this.error.set(String(e)));
  }

  protected isEmpty(key: CacheName): boolean {
    const u = this.cache()?.[key];
    return !u || (!u.files && !u.inMemory);
  }

  protected usage(key: CacheName): string {
    const u = this.cache()?.[key];
    if (!u) return '';
    if (!u.files) return u.inMemory ? 'Not saved to disk' : 'Empty';
    const size = u.bytes < 1024 * 1024 ? `${Math.max(1, Math.round(u.bytes / 1024))} KB` : `${(u.bytes / 1024 / 1024).toFixed(1)} MB`;
    return `${u.files} ${u.files === 1 ? 'file' : 'files'} · ${size}`;
  }

  async clearCache(key: CacheName): Promise<void> {
    this.clearing.set(key);
    this.error.set('');
    try {
      this.cache.set(await this.rift.clearCache(key));
    } catch (e) {
      this.error.set(String(e));
    } finally {
      this.clearing.set(null);
    }
  }

  setKey(key: keyof AbilityKeys, raw: string): void {
    // Empty is fine: displays fall back to Q/W/E/R (RiftService.abilityKey).
    const v = raw.trim().toUpperCase();
    this.save((c) => ({ ...c, abilityKeys: { ...c.abilityKeys, [key]: v } }));
  }
  resetKeys(): void {
    this.save((c) => ({ ...c, abilityKeys: { q: 'Q', w: 'W', e: 'E', r: 'R' } }));
  }
  setInstall(v: string): void {
    this.save((c) => ({ ...c, installDir: v.trim() || null }));
  }
}
