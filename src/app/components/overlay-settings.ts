import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { RiftService } from '../core/rift.service';
import { FullscreenHint } from './fullscreen-hint';
import { Overlay } from './overlay';
import { Config } from '../core/models';

type BoolKey =
  | 'overlayEnabled'
  | 'showTimers'
  | 'showLaneDiff'
  | 'showSituational'
  | 'showCs'
  | 'overlayGrowUp'
  | 'showTeamDiff'
  | 'showBuyNow';

/** The Overlay page: the in-game overlay's look, position and parts (moved out of Settings). */
@Component({
  selector: 'rl-overlay-settings',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FullscreenHint, Overlay],
  template: `
    @if (rift.config(); as cfg) {
      <div class="page">
        <div class="col">
          <section class="card stack" [class.off]="!cfg.overlayEnabled">
            <h2>What it shows</h2>
            <h3 class="sub first">Top line</h3>
            <label class="toggle">
              <input type="checkbox" [checked]="cfg.showLaneDiff" (change)="setBool('showLaneDiff', $any($event.target).checked)" />
              <span class="track"></span>
              <span class="label"><b>Item gold vs your lane opponent</b><span>The total cost of your items against theirs. Not shown in modes without roles, like ARAM.</span></span>
            </label>
            <label class="toggle">
              <input type="checkbox" [checked]="cfg.showTeamDiff ?? true" (change)="setBool('showTeamDiff', $any($event.target).checked)" />
              <span class="track"></span>
              <span class="label"><b>Item gold vs the enemy team</b><span>Your team's item value against theirs.</span></span>
            </label>
            <label class="toggle">
              <input type="checkbox" [checked]="cfg.showCs ?? true" (change)="setBool('showCs', $any($event.target).checked)" />
              <span class="track"></span>
              <span class="label"><b>CS per minute</b><span>From the first minute on. The game only updates CS every 10 minions, so it moves in steps.</span></span>
            </label>
            <h3 class="sub">Sections</h3>
            <label class="toggle">
              <input type="checkbox" [checked]="cfg.showTimers" (change)="setBool('showTimers', $any($event.target).checked)" />
              <span class="track"></span>
              <span class="label"><b>Objective timers</b><span>Dragon, Baron and inhibitor respawns. The Live tab shows them either way.</span></span>
            </label>
            <label class="toggle" [class.off]="cfg.recSource !== 'opgg'">
              <input type="checkbox" [checked]="cfg.showSkillHint" [disabled]="cfg.recSource !== 'opgg'" (change)="setRec('showSkillHint', $any($event.target).checked)" />
              <span class="track"></span>
              <span class="label"><b>Skill order</b><span>Which ability you're maxing now (pink), which one is next (teal), and what to level when you have a point.@if (cfg.recSource !== 'opgg') { Needs OP.GG recommendations. }</span></span>
            </label>
            <label class="toggle" [class.off]="cfg.recSource !== 'opgg'">
              <input type="checkbox" [checked]="cfg.useRecommendedBuilds" [disabled]="cfg.recSource !== 'opgg'" (change)="setRec('useRecommendedBuilds', $any($event.target).checked)" />
              <span class="track"></span>
              <span class="label"><b>Next items to buy</b><span>Starting items, then OP.GG's next item and the parts left to buy, green when you can afford them.@if (cfg.recSource !== 'opgg') { Needs OP.GG recommendations. }</span></span>
            </label>
            <label class="toggle" [class.off]="cfg.recSource !== 'opgg' || !cfg.useRecommendedBuilds">
              <input type="checkbox" [checked]="cfg.showBuyNow ?? true" [disabled]="cfg.recSource !== 'opgg' || !cfg.useRecommendedBuilds" (change)="setBool('showBuyNow', $any($event.target).checked)" />
              <span class="track"></span>
              <span class="label"><b>Buy now</b><span>What your gold buys now toward the next item, like a Long Sword before the Noonquiver.@if (cfg.recSource !== 'opgg' || !cfg.useRecommendedBuilds) { Needs Next items to buy. }</span></span>
            </label>
            <label class="toggle" [class.off]="cfg.recSource !== 'opgg'">
              <input type="checkbox" [checked]="cfg.showSituational" [disabled]="cfg.recSource !== 'opgg'" (change)="setBool('showSituational', $any($event.target).checked)" />
              <span class="track"></span>
              <span class="label"><b>Situational items</b><span>The best counter item from OP.GG's 4th–6th item options, updated as enemies buy items. The Live tab shows them either way.@if (cfg.recSource !== 'opgg') { Needs OP.GG recommendations. }</span></span>
            </label>
          </section>
        </div>
        <div class="col">
          <section class="card stack">
            <h2>Overlay</h2>
            <label class="toggle">
              <input type="checkbox" [checked]="cfg.overlayEnabled" (change)="setBool('overlayEnabled', $any($event.target).checked)" />
              <span class="track"></span>
              <span class="label"><b>Show the in-game overlay</b><span>Needs League in Borderless or Windowed mode. Fullscreen draws over it.</span></span>
            </label>
            <rl-fullscreen-hint />
            <!-- A copy of the overlay inside this window, with your settings applied as you change them;
                 the real overlay window (and where it sits in game) is left alone. -->
            <div class="frame" [class.off]="!cfg.overlayEnabled"><rl-overlay [inline]="true" /></div>
            <p class="faint small">Preview with sample game data. Your switches and sizes apply as you change them.</p>
          </section>

          <section class="card stack" [class.off]="!cfg.overlayEnabled">
            <h2>Size and position</h2>
            <div class="field">
              <span>Opacity</span>
              <input type="range" min="0.4" max="1" step="0.05" [value]="cfg.overlayOpacity"
                (change)="setNum('overlayOpacity', +$any($event.target).value)" />
              <span class="mono faint val">{{ (cfg.overlayOpacity * 100).toFixed(0) }}%</span>
              <span class="reset"></span>
            </div>
            <div class="field">
              <span>Width</span>
              <input type="range" min="260" max="480" step="10" [value]="cfg.overlayWidth"
                (change)="setNum('overlayWidth', +$any($event.target).value)" />
              <span class="mono faint val">{{ cfg.overlayWidth }} px</span>
              <span class="reset"></span>
            </div>
            <div class="field">
              <span>Size</span>
              <input type="range" min="0.8" max="1.5" step="0.05" [value]="cfg.overlayScale"
                (change)="setNum('overlayScale', +$any($event.target).value)" />
              <span class="mono faint val">{{ (cfg.overlayScale * 100).toFixed(0) }}%</span>
              <button class="ghost icon-btn reset" [disabled]="cfg.overlayWidth === 340 && cfg.overlayScale === 1" (click)="resetSize()" title="Reset width and size" aria-label="Reset width and size"><svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M4 12a8 8 0 1 0 2.34-5.66M4 4v5h5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" /></svg></button>
            </div>
            <p class="faint small">The height follows what's on the overlay. Size scales text and icons.</p>
            <div class="field">
              <span>Position</span>
              <input type="number" placeholder="X auto" [value]="cfg.overlayX ?? ''" (change)="setPos('overlayX', $any($event.target).value)" />
              <input type="number" placeholder="Y auto" [value]="cfg.overlayY ?? ''" (change)="setPos('overlayY', $any($event.target).value)" />
              <button class="ghost icon-btn reset" (click)="resetPos()" title="Reset position" aria-label="Reset position"><svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M4 12a8 8 0 1 0 2.34-5.66M4 4v5h5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" /></svg></button>
            </div>
            <p class="faint small">Screen pixels from the top-left. Leave empty for the top-right corner, or drag the overlay by its corner handle during a game.</p>
            <label class="toggle">
              <input type="checkbox" [checked]="cfg.overlayGrowUp ?? false" (change)="setBool('overlayGrowUp', $any($event.target).checked)" />
              <span class="track"></span>
              <span class="label"><b>Grow upward</b><span>For an overlay at the bottom of your screen: the bottom edge stays put and new rows push the top up.</span></span>
            </label>
          </section>
        </div>
      </div>
      @if (error()) { <p class="loss">{{ error() }}</p> }
    }
  `,
  styles: `
    /* Two even columns: what the overlay shows on the left, the overlay itself (preview) and its size on the right. */
    .page { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; align-items: start; }
    .col { display: flex; flex-direction: column; gap: 16px; min-width: 0; }
    .card { gap: 6px; }
    .card.off { opacity: 0.6; }
    .frame {
      width: fit-content; max-width: 100%; overflow: auto; margin: 6px auto 0; padding: 6px 6px 2px; border-radius: 16px; border: 1px solid var(--line);
      background: linear-gradient(160deg, #24324a, #2d3b2a 60%, #3a3326); box-shadow: 0 12px 40px rgba(0, 0, 0, 0.45);
      transition: filter 0.15s, opacity 0.15s;
    }
    .frame.off { filter: grayscale(1); opacity: 0.45; }
    .frame + .small { text-align: center; }
    /* One column on a narrow window, the preview first. */
    @media (max-width: 1100px) {
      .page { grid-template-columns: minmax(0, 1fr); }
      .col:last-child { order: -1; }
    }
    .field { display: flex; align-items: center; gap: 10px; min-height: 34px; }
    .field > span:first-child { width: 72px; flex: none; color: var(--text-dim); }
    .field input[type='range'] { flex: 1; accent-color: var(--accent); }
    .field input[type='number'] { flex: 1; min-width: 0; }
    .field .val { width: 56px; text-align: right; }
    .field .reset { width: 34px; flex: none; }
    .small { font-size: 12.5px; margin: 0; }
    .sub {
      margin: 8px 0 0; padding-top: 10px; border-top: 1px solid var(--line);
      font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--text-faint);
    }
    .sub.first { margin-top: 0; padding-top: 0; border-top: none; }
    .toggle.off { opacity: 0.55; }
  `,
})
export class OverlaySettingsView {
  protected readonly rift = inject(RiftService);
  protected readonly error = signal('');

  private save(fn: (c: Config) => Config): void {
    this.rift.updateConfig(fn).catch((e) => this.error.set(String(e)));
  }

  setBool(key: BoolKey, v: boolean): void {
    this.save((c) => ({ ...c, [key]: v }));
  }
  setRec(key: 'useRecommendedBuilds' | 'showSkillHint', v: boolean): void {
    this.save((c) => ({ ...c, [key]: v }));
  }
  setNum(key: 'overlayOpacity' | 'overlayWidth' | 'overlayScale', v: number): void {
    this.save((c) => ({ ...c, [key]: v }));
  }
  setPos(key: 'overlayX' | 'overlayY', raw: string): void {
    const v = raw.trim() === '' ? null : Math.round(Number(raw));
    // A typed position wins over the saved bottom edge (see overlayGrowUp).
    this.save((c) => ({ ...c, [key]: Number.isFinite(v as number) ? v : null, overlayBottom: null }));
  }
  /** Width and Size back to the defaults (config.rs). */
  resetSize(): void {
    this.save((c) => ({ ...c, overlayWidth: 340, overlayScale: 1 }));
  }
  resetPos(): void {
    this.save((c) => ({ ...c, overlayX: null, overlayY: null, overlayBottom: null }));
  }
}
