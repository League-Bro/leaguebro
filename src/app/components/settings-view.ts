import { ChangeDetectionStrategy, Component, effect, inject, signal, untracked } from '@angular/core';
import { RiftService } from '../core/rift.service';
import { UpdateService } from '../core/update.service';
import { FullscreenHint } from './fullscreen-hint';
import { AbilityKeys, CacheInfo, CacheName, Config, GlobalSets } from '../core/models';

type BoolKey =
  | 'scoutInChampSelect'
  | 'scoutOnLoading'
  | 'overlayEnabled'
  | 'autoImportRunes'
  | 'importOnHover'
  | 'reuseCurrentPageWhenFull'
  | 'showTimers'
  | 'showLaneDiff'
  | 'showSituational';

@Component({
  selector: 'rl-settings',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FullscreenHint],
  template: `
    @if (rift.config(); as cfg) {
      <div class="grid">
        <section class="card stack">
          <h2>Overlay</h2>
          <label class="toggle">
            <input type="checkbox" [checked]="cfg.overlayEnabled" (change)="setBool('overlayEnabled', $any($event.target).checked)" />
            <span class="track"></span>
            <span class="label"><b>Show the in-game overlay</b><span>Set League's window mode to Borderless or Windowed. Fullscreen draws over it.</span></span>
          </label>
          <rl-fullscreen-hint />
          <div class="field">
            <span>Opacity</span>
            <input type="range" min="0.4" max="1" step="0.05" [value]="cfg.overlayOpacity"
              (change)="setNum('overlayOpacity', +$any($event.target).value)" />
            <span class="mono faint">{{ (cfg.overlayOpacity * 100).toFixed(0) }}%</span>
          </div>
          <div class="field">
            <span>Position</span>
            <input type="number" placeholder="auto" [value]="cfg.overlayX ?? ''" (change)="setPos('overlayX', $any($event.target).value)" />
            <input type="number" placeholder="auto" [value]="cfg.overlayY ?? ''" (change)="setPos('overlayY', $any($event.target).value)" />
            <button class="ghost" (click)="resetPos()">Reset</button>
          </div>
          <p class="faint small">
            @if (rift.overlayLocked()) {
              Screen pixels from the top-left. Leave empty for the top-right corner, or unlock the overlay and drag it where you want it.
            } @else {
              Unlocked: drag the overlay to where you want it, then lock it here or with the padlock on the overlay.
            }
          </p>
          <div class="row">
            <button (click)="rift.previewOverlay(!rift.overlayPreview())">
              {{ rift.overlayPreview() ? 'Hide preview' : 'Preview overlay' }}
            </button>
            <button [class.ghost]="rift.overlayLocked()" (click)="toggleLock()">
              {{ rift.overlayLocked() ? 'Unlock to move' : 'Lock in place' }}
            </button>
          </div>

          <h3 class="sub">Show on the overlay</h3>
          <label class="toggle">
            <input type="checkbox" [checked]="cfg.showLaneDiff" (change)="setBool('showLaneDiff', $any($event.target).checked)" />
            <span class="track"></span>
            <span class="label"><b>Items vs your lane opponent</b><span>The total cost of your items against theirs. Not shown in modes without roles, like ARAM.</span></span>
          </label>
          <label class="toggle" [class.off]="cfg.recSource !== 'opgg'">
            <input type="checkbox" [checked]="cfg.showSkillHint" [disabled]="cfg.recSource !== 'opgg'" (change)="setRec('showSkillHint', $any($event.target).checked)" />
            <span class="track"></span>
            <span class="label"><b>Skill order</b><span>Which ability to max, and what to level when you have a point.@if (cfg.recSource !== 'opgg') { Needs OP.GG recommendations. }</span></span>
          </label>
          <label class="toggle">
            <input type="checkbox" [checked]="cfg.showTimers" (change)="setBool('showTimers', $any($event.target).checked)" />
            <span class="track"></span>
            <span class="label"><b>Objective timers</b><span>Dragon, Baron and inhibitor respawns. The Live tab shows them either way.</span></span>
          </label>
          <label class="toggle" [class.off]="cfg.recSource !== 'opgg'">
            <input type="checkbox" [checked]="cfg.useRecommendedBuilds" [disabled]="cfg.recSource !== 'opgg'" (change)="setRec('useRecommendedBuilds', $any($event.target).checked)" />
            <span class="track"></span>
            <span class="label"><b>Next items to buy</b><span>The next two items from OP.GG's build, priced green when you can afford them.@if (cfg.recSource !== 'opgg') { Needs OP.GG recommendations. }</span></span>
          </label>
          <label class="toggle" [class.off]="cfg.recSource !== 'opgg'">
            <input type="checkbox" [checked]="cfg.showSituational" [disabled]="cfg.recSource !== 'opgg'" (change)="setBool('showSituational', $any($event.target).checked)" />
            <span class="track"></span>
            <span class="label"><b>Situational items</b><span>The best counter item for this game from OP.GG's 4th–6th item options, updated as enemies buy items, with a button for the rest. The Live tab shows them either way.@if (cfg.recSource !== 'opgg') { Needs OP.GG recommendations. }</span></span>
          </label>
        </section>

        <section class="card stack">
          <h2>Recommendations</h2>
          <div class="seg">
            <button [class.on]="cfg.recSource === 'opgg'" (click)="setSource('opgg')">OP.GG meta</button>
            <button [class.on]="cfg.recSource === 'client'" (click)="setSource('client')">League client only</button>
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
              <input type="checkbox" [checked]="cfg.setSummonerSpells" (change)="setRec('setSummonerSpells', $any($event.target).checked)" />
              <span class="track"></span>
              <span class="label"><b>Set summoner spells</b><span>On lock-in. Flash stays on whichever key you already use.</span></span>
            </label>
            <label class="toggle">
              <input type="checkbox" [checked]="cfg.setItemSets" (change)="setRec('setItemSets', $any($event.target).checked)" />
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
          <h2>Ability keys</h2>
          <p class="faint small">If you've rebound your abilities in League, enter your keys. Skill orders everywhere in League Bro (champ select, the Champions tab, the overlay, patch notes) then show your keys instead of Q W E R.</p>
          <div class="field">
            @for (k of abilitySlots; track k) {
              <label class="keybind">
                <span class="faint small">{{ k.toUpperCase() }}</span>
                <input type="text" class="key" maxlength="12" [placeholder]="k.toUpperCase()" [value]="cfg.abilityKeys[k]"
                  [attr.aria-label]="'Your key for the ' + k.toUpperCase() + ' ability'" (input)="setKey(k, $any($event.target).value)" />
              </label>
            }
            <button class="ghost" (click)="resetKeys()">Reset</button>
          </div>
        </section>

        <section class="card stack">
          <h2>Rune import</h2>
          <label class="toggle">
            <input type="checkbox" [checked]="cfg.autoImportRunes" (change)="setBool('autoImportRunes', $any($event.target).checked)" />
            <span class="track"></span>
            <span class="label"><b>Import runes</b><span>In champ select, creates one page called "League Bro: …" and replaces it each game. In a Swiftplay lobby, sets the runes of each champion you pick there.</span></span>
          </label>
          <label class="toggle">
            <input type="checkbox" [checked]="cfg.importOnHover" (change)="setBool('importOnHover', $any($event.target).checked)" />
            <span class="track"></span>
            <span class="label"><b>Import while hovering</b><span>Don't wait for lock-in. Handy for blind pick.</span></span>
          </label>
          <label class="toggle">
            <input type="checkbox" [checked]="cfg.reuseCurrentPageWhenFull" (change)="setBool('reuseCurrentPageWhenFull', $any($event.target).checked)" />
            <span class="track"></span>
            <span class="label"><b>Reuse the selected page when slots are full</b><span>Overwrites whichever editable page is selected. Leave off if you'd rather keep one slot free for League Bro.</span></span>
          </label>
        </section>

        <section class="card stack">
          <h2>Scouting</h2>
          <label class="toggle">
            <input type="checkbox" [checked]="cfg.scoutInChampSelect" (change)="setBool('scoutInChampSelect', $any($event.target).checked)" />
            <span class="track"></span>
            <span class="label"><b>Look up teammates in champ select</b><span>Only players whose names the client shows: your party, and everyone in normals. Ranked hides the rest until loading.</span></span>
          </label>
          <label class="toggle">
            <input type="checkbox" [checked]="cfg.scoutOnLoading" (change)="setBool('scoutOnLoading', $any($event.target).checked)" />
            <span class="track"></span>
            <span class="label"><b>Look up all ten players on the loading screen</b><span>Ranks and recent games, straight from the League client. No API key needed.</span></span>
          </label>
        </section>

        <section class="card stack">
          <h2>League install folder</h2>
          <p class="faint small">Only needed if League Bro never connects. It normally finds the client on its own.</p>
          <div class="field">
            <input type="text" class="wide" placeholder="C:\\Riot Games\\League of Legends" [value]="cfg.installDir ?? ''"
              (change)="setInstall($any($event.target).value)" />
          </div>
        </section>
        <section class="card stack">
          <h2>Clear cache</h2>
          <p class="faint small">League Bro saves downloads so it doesn't fetch them every time. Clearing one makes it download fresh copies the next time they're needed.</p>
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

        <section class="card stack">
          <h2>About &amp; updates</h2>
          <p class="muted small">
            @if (updates.currentVersion()) { League Bro {{ updates.currentVersion() }} } @else { League Bro (dev build) }
          </p>
          <p class="faint small">League Bro checks for updates when it starts and every few hours, then asks before installing.</p>
          <div class="row">
            <button [disabled]="updates.checking() || !updates.currentVersion()" (click)="updates.check(true)">
              {{ updates.checking() ? 'Checking…' : 'Check for updates' }}
            </button>
            @if (updates.lastResult()) { <span class="faint small">{{ updates.lastResult() }}</span> }
          </div>
        </section>
      </div>
      @if (error()) { <p class="loss">{{ error() }}</p> }
    }
  `,
  styles: `
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(380px, 1fr)); gap: 16px; }
    .card { gap: 8px; }
    .field { display: flex; align-items: center; gap: 10px; }
    .field > span:first-child { width: 150px; color: var(--text-dim); }
    .field input[type='range'] { flex: 1; accent-color: var(--accent); }
    .wide { flex: 1; }
    .keybind { display: flex; flex-direction: column; align-items: center; gap: 2px; }
    .key { width: 52px; text-align: center; text-transform: uppercase; }
    .small { font-size: 12.5px; margin: 0; }
    .sub {
      margin: 10px 0 0; padding-top: 12px; border-top: 1px solid var(--line);
      font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--text-faint);
    }
    .toggle.off { opacity: 0.55; }
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
export class SettingsView {
  protected readonly rift = inject(RiftService);
  protected readonly updates = inject(UpdateService);
  protected readonly error = signal('');
  protected readonly abilitySlots: (keyof AbilityKeys)[] = ['q', 'w', 'e', 'r'];

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

  private save(fn: (c: Config) => Config): void {
    this.rift.updateConfig(fn).catch((e) => this.error.set(String(e)));
  }

  setBool(key: BoolKey, v: boolean): void {
    this.save((c) => ({ ...c, [key]: v }));
  }
  setSource(v: 'opgg' | 'client'): void {
    this.save((c) => ({ ...c, recSource: v }));
  }
  setRec(key: 'setSummonerSpells' | 'setItemSets' | 'useRecommendedBuilds' | 'showSkillHint', v: boolean): void {
    this.save((c) => ({ ...c, [key]: v }));
  }
  setNum(key: 'overlayOpacity', v: number): void {
    this.save((c) => ({ ...c, [key]: v }));
  }
  setPos(key: 'overlayX' | 'overlayY', raw: string): void {
    const v = raw.trim() === '' ? null : Math.round(Number(raw));
    this.save((c) => ({ ...c, [key]: Number.isFinite(v as number) ? v : null }));
  }
  resetPos(): void {
    this.save((c) => ({ ...c, overlayX: null, overlayY: null }));
  }
  async toggleLock(): Promise<void> {
    const unlocking = this.rift.overlayLocked();
    if (unlocking && !this.rift.overlayPreview()) await this.rift.previewOverlay(true);
    await this.rift.setOverlayLocked(!unlocking);
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
