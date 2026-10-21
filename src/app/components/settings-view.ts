import { Component, inject, signal } from '@angular/core';
import { RiftService } from '../core/rift.service';
import { UpdateService } from '../core/update.service';
import { Config, TimerConfig } from '../core/models';
import { clock } from '../core/assets';

type BoolKey = 'scoutInChampSelect' | 'scoutOnLoading' | 'overlayEnabled';

@Component({
  selector: 'rl-settings',
  template: `
    @if (rift.config(); as cfg) {
      <div class="grid">
        <section class="card stack">
          <h2>Overlay</h2>
          <label class="toggle">
            <input type="checkbox" [checked]="cfg.overlayEnabled" (change)="setBool('overlayEnabled', $any($event.target).checked)" />
            <span class="track"></span>
            <span class="label"><b>Show the in-game overlay</b><span>Needs League's window mode set to Borderless or Windowed; exclusive fullscreen draws over it.</span></span>
          </label>
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
          <p class="faint small">Screen pixels from the top-left. Leave empty for the top-right corner. The overlay ignores the mouse, so it can't be dragged.</p>
          <div>
            <button (click)="rift.previewOverlay(!rift.overlayPreview())">
              {{ rift.overlayPreview() ? 'Hide preview' : 'Preview overlay' }}
            </button>
          </div>
        </section>

        <section class="card stack">
          <h2>Objective timers</h2>
          <p class="faint small">Riot changes these between seasons; adjust them here if a patch moves a spawn.</p>
          @for (t of timerFields; track t.key) {
            <div class="field">
              <span>{{ t.label }}</span>
              <input type="number" min="0" step="5" [value]="cfg.timers[t.key]" (change)="setTimer(t.key, +$any($event.target).value)" />
              <span class="mono faint">{{ time(cfg.timers[t.key]) }}</span>
            </div>
          }
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
          <p class="faint small">Only needed if League Buddy never connects. It normally finds the client on its own.</p>
          <div class="field">
            <input type="text" class="wide" placeholder="C:\\Riot Games\\League of Legends" [value]="cfg.installDir ?? ''"
              (change)="setInstall($any($event.target).value)" />
          </div>
        </section>
        <section class="card stack">
          <h2>About &amp; updates</h2>
          <p class="muted small">
            @if (updates.currentVersion()) { League Buddy {{ updates.currentVersion() }} } @else { League Buddy (dev build) }
          </p>
          <p class="faint small">League Buddy checks for updates when it starts and every few hours, then asks before installing.</p>
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
    .field input[type='range'] { flex: 1; accent-color: var(--gold); }
    .wide { flex: 1; }
    .small { font-size: 12.5px; margin: 0; }
  `,
})
export class SettingsView {
  protected readonly rift = inject(RiftService);
  protected readonly updates = inject(UpdateService);
  protected readonly error = signal('');
  protected time = clock;
  protected readonly timerFields: { key: keyof TimerConfig; label: string }[] = [
    { key: 'firstDragon', label: 'First dragon at' },
    { key: 'dragonRespawn', label: 'Dragon respawn' },
    { key: 'elderRespawn', label: 'Elder respawn' },
    { key: 'firstBaron', label: 'First Baron at' },
    { key: 'baronRespawn', label: 'Baron respawn' },
    { key: 'inhibRespawn', label: 'Inhibitor respawn' },
  ];

  private save(fn: (c: Config) => Config): void {
    this.rift.updateConfig(fn).catch((e) => this.error.set(String(e)));
  }

  setBool(key: BoolKey, v: boolean): void {
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
  setTimer(key: keyof TimerConfig, v: number): void {
    if (!Number.isFinite(v) || v < 0) return;
    this.save((c) => ({ ...c, timers: { ...c.timers, [key]: v } }));
  }
  setInstall(v: string): void {
    this.save((c) => ({ ...c, installDir: v.trim() || null }));
  }
}
