import { ChangeDetectionStrategy, Component, ElementRef, afterRenderEffect, computed, inject, signal, viewChild } from '@angular/core';
import { RiftService } from '../core/rift.service';
import { championIcon, clock } from '../core/assets';
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
    {
      id: 6655, name: "Luden's Companion", price: 2850, affordable: false,
      components: [
        { id: 3802, name: 'Lost Chapter', price: 1200, affordable: true },
        { id: 1026, name: 'Blasting Wand', price: 850, affordable: true },
      ],
    },
    { id: 4645, name: 'Shadowflame', price: 3200, affordable: false },
    { id: 3089, name: "Rabadon's Deathcap", price: 3600, affordable: false },
    { id: 3135, name: 'Void Staff', price: 3000, affordable: false },
  ],
  hasBuild: true,
  skillMax: ['Q', 'W', 'E'],
  nextSkill: 'Q',
  lane: { opponent: 'Zed', championId: 238, mine: 5350, theirs: 3967 },
  team: { ours: 21400, theirs: 22650 },
  situational: [
    { id: 3102, name: "Banshee's Veil", tag: 'survive', label: 'Survive burst', reason: 'Burst from Zed (assassin, 7/2)', score: 2, started: false, offPool: false, games: 210, winRate: 0.53, price: 3000, affordable: false },
    { id: 3165, name: 'Morellonomicon', tag: 'antiHeal', label: 'Anti-heal', reason: 'Healing from Darius (Ravenous Hydra)', score: 1.2, started: true, offPool: false, games: 120, winRate: 0.51, price: 2150, affordable: false },
  ],
};

@Component({
  selector: 'rl-overlay',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [],
  // Laid out at the configured width whatever the window's size, so the
  // measured height is right before the window is resized to fit it.
  // No right-click menu: WebView2's own (Back, Refresh, Inspect…) would show over the game.
  host: {
    '[style.width.px]': 'width() / scale()',
    '[style.zoom]': 'scale()',
    '(document:contextmenu)': '$event.preventDefault()',
  },
  template: `
    @if (state(); as o) {
      <div class="panel" [style.opacity]="opacity()">
        @if (!locked()) {
          <!-- Invisible: unlocked looks the same as locked, it just takes the drag. -->
          <div class="drag-layer" data-tauri-drag-region></div>
        }
        <!-- One line: skill order, item gold diffs, padlock. -->
        <div class="top">
          @if (o.skillMax.length) {
            <div class="skills">
              @for (k of o.skillMax; track $index; let last = $last) {
                <b [class.levelup]="k === o.nextSkill">{{ rift.abilityKey(k) }}</b>@if (!last) { <span class="sep">›</span> }
              }
              @if (o.nextSkill && !o.skillMax.includes(o.nextSkill)) {
                <b class="levelup">{{ rift.abilityKey(o.nextSkill) }}</b>
              }
            </div>
          }
          <!-- Item gold: you vs your lane opponent (their icon), then team vs team. -->
          @if (showLane() && o.lane; as l) {
            <div class="gold">
              <span class="cap">vs</span>
              @if (champIcon(l.championId ?? 0); as url) {
                <img class="champ" [src]="url" [alt]="l.opponent" (error)="rift.hideImg($event)" />
              } @else {
                <span class="cap">{{ l.opponent.slice(0, 3) }}</span>
              }
              <svg class="coin" viewBox="0 0 16 16" aria-hidden="true"><g stroke="#3a2606" stroke-width="0.8"><path d="M2.5 11.2v1.6c0 1.2 2.5 2.1 5.5 2.1s5.5-.9 5.5-2.1v-1.6z" fill="#b07a1e" /><ellipse cx="8" cy="11.2" rx="5.5" ry="2.1" fill="#e9b949" /><path d="M2.5 7.7v1.6c0 1.2 2.5 2.1 5.5 2.1s5.5-.9 5.5-2.1V7.7z" fill="#b07a1e" /><ellipse cx="8" cy="7.7" rx="5.5" ry="2.1" fill="#e9b949" /><path d="M2.5 4.2v1.6c0 1.2 2.5 2.1 5.5 2.1s5.5-.9 5.5-2.1V4.2z" fill="#b07a1e" /><ellipse cx="8" cy="4.2" rx="5.5" ry="2.1" fill="#fbd96b" /></g><ellipse cx="8" cy="4.2" rx="3" ry="1" fill="none" stroke="#c48d22" stroke-width="0.7" /></svg>
              <span class="diff" [class.ahead]="l.mine > l.theirs" [class.behind]="l.mine < l.theirs">{{ gold(l.mine - l.theirs) }}</span>
            </div>
          }
          @if (showLane() && o.team; as t) {
            <div class="gold">
              <span class="cap">Team</span>
              <svg class="coin" viewBox="0 0 16 16" aria-hidden="true"><g stroke="#3a2606" stroke-width="0.8"><path d="M2.5 11.2v1.6c0 1.2 2.5 2.1 5.5 2.1s5.5-.9 5.5-2.1v-1.6z" fill="#b07a1e" /><ellipse cx="8" cy="11.2" rx="5.5" ry="2.1" fill="#e9b949" /><path d="M2.5 7.7v1.6c0 1.2 2.5 2.1 5.5 2.1s5.5-.9 5.5-2.1V7.7z" fill="#b07a1e" /><ellipse cx="8" cy="7.7" rx="5.5" ry="2.1" fill="#e9b949" /><path d="M2.5 4.2v1.6c0 1.2 2.5 2.1 5.5 2.1s5.5-.9 5.5-2.1V4.2z" fill="#b07a1e" /><ellipse cx="8" cy="4.2" rx="5.5" ry="2.1" fill="#fbd96b" /></g><ellipse cx="8" cy="4.2" rx="3" ry="1" fill="none" stroke="#c48d22" stroke-width="0.7" /></svg>
              <span class="diff" [class.ahead]="t.ours > t.theirs" [class.behind]="t.ours < t.theirs">{{ gold(t.ours - t.theirs) }}</span>
            </div>
          }
          <button #lockBtn class="lock" [title]="locked() ? 'Unlock to move' : 'Lock in place'"
            (click)="rift.setOverlayLocked(!locked())">
            <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
              <rect x="3" y="7" width="10" height="7" rx="1.5" fill="currentColor" />
              <path [attr.d]="locked() ? 'M5 7V5a3 3 0 0 1 6 0v2' : 'M5 7V5a3 3 0 0 1 6 0'" fill="none" stroke="currentColor" stroke-width="1.6" />
            </svg>
          </button>
        </div>
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
        @if (o.starter?.length) {
          <!-- Game start: what to buy first; the build takes over once it's bought. -->
          <div class="build">
            <div class="cap">Start · OP.GG build</div>
            @for (s of o.starter; track s.id) {
              <div class="item">
                @if (rift.itemIcon(s.id); as url) { <img [src]="url" alt="" (error)="rift.hideImg($event)" /> }
                <span class="name">{{ s.name }}@if (s.count > 1) { <span class="count">×{{ s.count }}</span> }</span>
                <span class="price">{{ s.price * s.count }}</span>
              </div>
            }
          </div>
        } @else if (o.nextItems[0]; as it) {
          <div class="build">
            <div class="cap">Next · OP.GG build</div>
            <!-- The next item, then its components left to buy; bought ones drop off. -->
            <div class="item" [class.ready]="it.affordable">
              @if (rift.itemIcon(it.id); as url) { <img [src]="url" alt="" (error)="rift.hideImg($event)" /> }
              <span class="name">{{ it.name }}</span>
              <span class="price">{{ it.price }}</span>
            </div>
            @for (c of it.components ?? []; track $index) {
              <div class="item comp" [class.ready]="c.affordable">
                <span class="n">{{ $index + 1 }}</span>
                @if (rift.itemIcon(c.id); as url) { <img [src]="url" alt="" (error)="rift.hideImg($event)" /> }
                <span class="name">{{ c.name }}</span>
                <span class="price">{{ c.price }}</span>
              </div>
            }
          </div>
        } @else if (o.hasBuild) {
          <div class="build"><div class="cap">Build complete</div></div>
        }
        @if (showSit() && o.situational.length) {
          <div class="build sit">
            <div class="cap">Situational · vs this team</div>
            @for (it of expanded() ? o.situational : o.situational.slice(0, 1); track it.id) {
              <div class="item" [class.ready]="it.affordable" [title]="it.reason">
                @if (rift.itemIcon(it.id); as url) { <img [src]="url" alt="" (error)="rift.hideImg($event)" /> }
                <span class="name">{{ it.name }}</span>
                @if (it.price) { <span class="price">{{ it.price }}</span> }
              </div>
              <div class="why"><span class="tag">{{ it.label }}</span> · {{ it.reason }}</div>
            }
            @if (o.situational.length > 1) {
              <button #moreBtn class="more" [class.open]="expanded()" (click)="expanded.set(!expanded())">
                {{ expanded() ? 'Show fewer' : '+' + (o.situational.length - 1) + ' more counter' + (o.situational.length > 2 ? 's' : '') }}
                <svg viewBox="0 0 10 10" width="9" height="9" aria-hidden="true"><path d="M2 3.5l3 3 3-3" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" /></svg>
              </button>
            }
          </div>
        }
        @if (preview() && !rift.overlay()) {
          <div class="cap center">Preview</div>
        }
      </div>
    }
  `,
  styles: `
    :host { display: block; box-sizing: border-box; padding: 6px; }
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
    .drag-layer { position: absolute; inset: 0; z-index: 10; border-radius: 14px; cursor: move; }
    .top { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 6px; margin-bottom: 6px; }
    .lock {
      all: unset; position: relative; z-index: 11;
      display: grid; place-items: center; width: 20px; height: 20px; border-radius: 5px;
      color: var(--text-faint); cursor: pointer;
    }
    .lock:hover { color: var(--accent); background: rgba(255, 79, 163, 0.16); }
    .lock { margin-left: auto; flex-shrink: 0; }
    .gold { display: flex; align-items: center; gap: 3px; white-space: nowrap; }
    .gold .champ { width: 18px; height: 18px; border-radius: 4px; border: 1px solid rgba(255, 255, 255, 0.15); }
    .gold .coin { width: 15px; height: 15px; margin-right: -2px; flex-shrink: 0; }
    .gold .diff { font: 600 13px var(--mono); color: var(--text-dim); }
    .gold .diff.ahead { color: var(--win); }
    .gold .diff.behind { color: var(--loss); }
    .skills { display: flex; align-items: center; gap: 2px; font-size: 13px; flex-shrink: 0; }
    .skills b { color: var(--accent); padding: 0 2px; border-radius: 4px; }
    .skills .sep { color: var(--text-faint); }
    /* The key to put your next point in. */
    .levelup { color: #fff; background: rgba(255, 79, 163, 0.35); animation: pulse 1.6s ease-in-out infinite; }
    @keyframes pulse { 50% { background: rgba(255, 79, 163, 0.1); } }
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
    .item .count { margin-left: 5px; font: 12px var(--mono); color: var(--text-dim); }
    .item.ready .price { color: var(--win); }
    .comp { padding-left: 14px; font-size: 12px; color: var(--text-dim); }
    .comp img { width: 20px; height: 20px; }
    .comp .n { width: 10px; margin-left: -14px; font: 10px var(--mono); color: var(--text-faint); text-align: right; }
    /* Blue, not red or green, so it doesn't read like the gold diffs. */
    .sit .tag { font-size: 10px; text-transform: uppercase; letter-spacing: 0.06em; color: #7cc4ff; }
    /* Wraps instead of cutting off: the locked overlay can't show a tooltip. */
    .sit .why { margin: -2px 0 2px 32px; font-size: 11.5px; color: var(--text-dim); line-height: 1.3; }
    /* Same blue as the tags; a real button, with a chevron that flips when open. */
    .more {
      all: unset; position: relative; z-index: 11; align-self: flex-start; margin: 2px 0 0 32px;
      display: inline-flex; align-items: center; gap: 5px;
      font-size: 11px; color: #7cc4ff; cursor: pointer; padding: 3px 9px; border-radius: 6px;
      border: 1px solid rgba(124, 196, 255, 0.45); background: rgba(124, 196, 255, 0.1);
    }
    .more:hover { background: rgba(124, 196, 255, 0.22); }
    .more svg { transition: transform 0.15s; }
    .more.open svg { transform: rotate(180deg); }
  `,
})
export class Overlay {
  protected readonly rift = inject(RiftService);
  protected readonly preview = this.rift.overlayPreview;
  protected readonly state = computed(() => this.rift.overlay() ?? (this.preview() ? PREVIEW : null));
  protected readonly opacity = computed(() => this.rift.config()?.overlayOpacity ?? 0.9);
  protected readonly width = computed(() => this.rift.config()?.overlayWidth ?? 340);
  protected readonly scale = computed(() => this.rift.config()?.overlayScale ?? 1);
  // Overlay-only switches: the Live tab's in-game bar still shows both.
  protected readonly showTimers = computed(() => this.rift.config()?.showTimers ?? true);
  protected readonly showLane = computed(() => this.rift.config()?.showLaneDiff ?? true);
  protected readonly showSit = computed(() => this.rift.config()?.showSituational ?? true);
  protected readonly expanded = signal(false);
  protected readonly locked = this.rift.overlayLocked;
  protected time = clock;
  protected champIcon = championIcon;
  private readonly lockBtn = viewChild<ElementRef<HTMLElement>>('lockBtn');
  private readonly moreBtn = viewChild<ElementRef<HTMLElement>>('moreBtn');
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  constructor() {
    afterRenderEffect(() => {
      // Both buttons stay clickable while the rest of the locked overlay is click-through.
      // Re-measured on every update: rows above "more" (timers, items) move it.
      this.state();
      this.expanded();
      this.showTimers();
      this.showLane();
      this.showSit();
      this.width();
      this.scale();
      const rects = [this.lockBtn(), this.moreBtn()]
        .map((b) => b?.nativeElement.getBoundingClientRect())
        .filter((r): r is DOMRect => !!r)
        .map((r): [number, number, number, number] => [r.x, r.y, r.width, r.height]);
      this.rift.setOverlayButtons(rects);
      // The window follows the panel's size (wrapped reasons, the expanded list, Settings).
      const r = this.host.nativeElement.getBoundingClientRect();
      if (this.state()) this.rift.fitOverlay(r.width, r.height);
    });
  }

  /** Signed and short: +500, −1.3k. */
  gold(n: number): string {
    const sign = n > 0 ? '+' : n < 0 ? '−' : '±';
    const a = Math.abs(n);
    return sign + (a >= 1000 ? `${(a / 1000).toFixed(1)}k` : `${a}`);
  }
}
