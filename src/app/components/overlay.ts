import { Component, ElementRef, afterRenderEffect, computed, inject, viewChild } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { RiftService } from '../core/rift.service';
import { clock } from '../core/assets';
import { OverlayState } from '../core/models';

const PREVIEW: OverlayState = {
  gameTime: 742,
  gameMode: 'CLASSIC',
  championName: 'Preview',
  gold: 1310,
  kills: 3,
  deaths: 1,
  assists: 5,
  timers: [
    { key: 'dragon', label: 'Dragon', spawnAt: 860, side: 'neutral' },
    { key: 'inhib', label: 'Enemy Mid inhib', spawnAt: 1012, side: 'enemy' },
    { key: 'baron', label: 'Baron', spawnAt: 1200, side: 'neutral' },
  ],
  nextItems: [
    { id: 6655, name: "Luden's Companion", price: 2850, affordable: false },
    { id: 1058, name: 'Needlessly Large Rod', price: 1200, affordable: true },
  ],
  hasBuild: true,
  skillMax: ['Q', 'W', 'E'],
  nextSkill: 'Q',
  lane: { opponent: 'Zed', mine: 5350, theirs: 3967 },
};

@Component({
  selector: 'rl-overlay',
  imports: [DecimalPipe],
  template: `
    @if (state(); as o) {
      <div class="panel" [style.opacity]="opacity()">
        @if (!locked()) {
          <div class="drag-layer" data-tauri-drag-region>Drag to move, then lock</div>
        }
        <div class="top">
          @if (showLane() && o.lane; as l) {
            <div class="lane" title="Total cost of your items vs your lane opponent's">
              <span class="cap">vs {{ l.opponent }}</span>
              <span class="diff" [class.ahead]="l.mine > l.theirs" [class.behind]="l.mine < l.theirs">{{ signed(l.mine - l.theirs) }}</span>
              <span class="vals">{{ l.mine | number }} · {{ l.theirs | number }}</span>
            </div>
          }
          <button #lockBtn class="lock" [class.open]="!locked()" [title]="locked() ? 'Unlock to move' : 'Lock in place'"
            (click)="rift.setOverlayLocked(!locked())">
            <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
              <rect x="3" y="7" width="10" height="7" rx="1.5" fill="currentColor" />
              <path [attr.d]="locked() ? 'M5 7V5a3 3 0 0 1 6 0v2' : 'M5 7V5a3 3 0 0 1 6 0'" fill="none" stroke="currentColor" stroke-width="1.6" />
            </svg>
          </button>
        </div>
        @if (o.skillMax.length) {
          <div class="skills">
            <span class="cap">Max</span>
            @for (k of o.skillMax; track $index; let last = $last) {
              <b>{{ rift.abilityKey(k) }}</b>@if (!last) { <span class="sep">›</span> }
            }
            @if (o.nextSkill) {
              <span class="levelup">Level up <b>{{ rift.abilityKey(o.nextSkill) }}</b></span>
            }
          </div>
        }
        @if (showTimers() && o.timers.length) {
          <div class="timers">
            @for (t of o.timers; track t.key) {
              <div class="timer" [class]="t.side" [class.soon]="t.spawnAt - o.gameTime <= 30">
                <span class="label">{{ t.label }}</span>
                <span class="left">{{ time(t.spawnAt - o.gameTime) }}</span>
              </div>
            }
          </div>
        }
        @if (o.nextItems.length) {
          <div class="build">
            <div class="cap">Next · OP.GG build</div>
            @for (it of o.nextItems; track it.id) {
              <div class="item" [class.ready]="it.affordable">
                @if (rift.itemIcon(it.id); as url) { <img [src]="url" alt="" (error)="rift.hideImg($event)" /> }
                <span class="name">{{ it.name }}</span>
                <span class="price">{{ it.price }}</span>
              </div>
            }
          </div>
        } @else if (o.hasBuild) {
          <div class="build"><div class="cap">Build complete</div></div>
        }
        @if (preview() && !rift.overlay()) {
          <div class="cap center">Preview</div>
        }
      </div>
    }
  `,
  styles: `
    :host { display: block; padding: 6px; }
    .panel {
      position: relative;
      background: rgba(15, 13, 20, 0.88);
      border: 1px solid rgba(255, 79, 163, 0.35);
      border-radius: 14px;
      padding: 10px 12px;
      color: #f1f2f5;
      font-size: 13px;
      text-shadow: 0 1px 2px #000;
    }
    .drag-layer {
      position: absolute; inset: 0; z-index: 10;
      display: flex; align-items: center; justify-content: center;
      border: 1px dashed var(--accent); border-radius: 14px;
      background: rgba(15, 13, 20, 0.55);
      font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em;
      color: var(--accent); cursor: move;
    }
    .top { display: flex; align-items: center; justify-content: flex-end; gap: 8px; margin-bottom: 6px; }
    .lock {
      all: unset; position: relative; z-index: 11;
      display: grid; place-items: center; width: 20px; height: 20px; border-radius: 5px;
      color: var(--text-faint); cursor: pointer;
    }
    .lock:hover { color: var(--accent); background: rgba(255, 79, 163, 0.16); }
    .lock.open { color: var(--accent); background: rgba(255, 79, 163, 0.22); }
    .lane { flex: 1; min-width: 0; display: flex; align-items: baseline; gap: 8px; }
    .lane .diff { font: 600 13px var(--mono); color: var(--text-dim); }
    .lane .diff.ahead { color: var(--win); }
    .lane .diff.behind { color: var(--loss); }
    .lane .vals { margin-left: auto; font: 11px var(--mono); color: var(--text-faint); }
    .skills { display: flex; align-items: center; gap: 4px; margin-bottom: 6px; font-size: 12.5px; }
    .skills b { color: var(--accent); }
    .skills .sep { color: var(--text-faint); }
    .skills .cap { margin-right: 2px; }
    .levelup {
      margin-left: auto; padding: 1px 7px; border-radius: 5px;
      background: rgba(255, 79, 163, 0.22); animation: pulse 1.6s ease-in-out infinite;
    }
    @keyframes pulse { 50% { background: rgba(255, 79, 163, 0.08); } }
    .timers { display: flex; flex-direction: column; gap: 3px; }
    .timer { display: flex; justify-content: space-between; padding: 3px 8px; border-radius: 6px; background: rgba(255, 255, 255, 0.04); border-left: 2px solid var(--text-faint); }
    .timer.ally { border-left-color: var(--ally); }
    .timer.enemy { border-left-color: var(--enemy); }
    .timer.soon { background: rgba(255, 79, 163, 0.16); }
    .timer.soon .left { color: var(--accent); }
    .left { font-family: var(--mono); font-variant-numeric: tabular-nums; }
    .build { margin-top: 8px; border-top: 1px solid rgba(255, 255, 255, 0.08); padding-top: 6px; display: flex; flex-direction: column; gap: 4px; }
    .cap { font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.1em; color: var(--text-faint); }
    .center { text-align: center; margin-top: 6px; }
    .item { display: flex; align-items: center; gap: 8px; }
    .item img { width: 24px; height: 24px; border-radius: 4px; border: 1px solid rgba(255, 255, 255, 0.15); }
    .item .name { flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .item .price { font: 12px var(--mono); color: var(--text-faint); }
    .item.ready .price { color: var(--win); }
  `,
})
export class Overlay {
  protected readonly rift = inject(RiftService);
  protected readonly preview = this.rift.overlayPreview;
  protected readonly state = computed(() => this.rift.overlay() ?? (this.preview() ? PREVIEW : null));
  protected readonly opacity = computed(() => this.rift.config()?.overlayOpacity ?? 0.9);
  // Overlay-only switches: the Live tab's in-game bar still shows both.
  protected readonly showTimers = computed(() => this.rift.config()?.showTimers ?? true);
  protected readonly showLane = computed(() => this.rift.config()?.showLaneDiff ?? true);
  protected readonly locked = this.rift.overlayLocked;
  protected time = clock;
  private readonly lockBtn = viewChild<ElementRef<HTMLElement>>('lockBtn');

  constructor() {
    afterRenderEffect(() => {
      const r = this.lockBtn()?.nativeElement.getBoundingClientRect();
      this.rift.setOverlayButton(r ? [r.x, r.y, r.width, r.height] : null);
    });
  }

  signed(n: number): string {
    return `${n > 0 ? '+' : n < 0 ? '−' : '±'}${Math.abs(n).toLocaleString()}`;
  }
}
