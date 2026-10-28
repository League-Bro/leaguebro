import { DecimalPipe } from '@angular/common';
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
  cs: 90,
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
  buyNow: [
    { id: 3802, name: 'Lost Chapter', count: 1, price: 1200 },
  ],
  hasBuild: true,
  skillMax: ['Q', 'W', 'E'],
  nextSkill: 'Q',
  lane: {
    opponent: 'Zed', championId: 238, mine: 5350, theirs: 3967,
    foes: [
      { opponent: 'Darius', championId: 122, position: 'TOP', theirs: 4875 },
      { opponent: 'Vi', championId: 254, position: 'JUNGLE', theirs: 4100 },
      { opponent: 'Zed', championId: 238, position: 'MIDDLE', theirs: 3967 },
      { opponent: "Kai'Sa", championId: 145, position: 'BOTTOM', theirs: 6200 },
      { opponent: 'Pyke', championId: 555, position: 'UTILITY', theirs: 3500 },
    ],
  },
  team: { ours: 21400, theirs: 22650 },
  situational: [
    { id: 3102, name: "Banshee's Veil", tag: 'survive', label: 'Survive burst', reason: 'Burst from Zed (assassin, 7/2)', score: 2, started: false, offPool: false, games: 210, winRate: 0.53, price: 3000, affordable: false },
    { id: 3165, name: 'Morellonomicon', tag: 'antiHeal', label: 'Anti-heal', reason: 'Healing from Darius (Ravenous Hydra)', score: 1.2, started: true, offPool: false, games: 120, winRate: 0.51, price: 2150, affordable: false },
  ],
};

@Component({
  selector: 'rl-overlay',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DecimalPipe],
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
          <!-- Our own drag, not data-tauri-drag-region: Windows' drag frees the cursor from League's window. -->
          <div class="drag-layer" (pointerdown)="dragStart($event)" (pointermove)="dragMove($event)"></div>
        }
        <!-- One line, spread across the width: skill order, item gold diffs, CS/min (each can be off). -->
        @if (o.skillMax.length || (showLane() && o.lane) || (showTeam() && o.team) || (showCs() && csPerMin(o))) {
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
            <!-- Item gold: you vs an enemy (their icon; your lane opponent unless you picked another), then team vs team, then CS/min. -->
            @if (showLane() && o.lane; as l) {
              @let f = foe();
              <button #goldBtn class="gold pick" [class.open]="foesOpen()" [disabled]="!l.foes?.length"
                title="Compare against another enemy" (click)="foesOpen.set(!foesOpen())">
                @if (f.position !== lanePos()) {
                  <span class="cap">{{ role(f.position) }}</span>
                }
                @if (champIcon(f.championId ?? 0); as url) {
                  <img class="champ" [src]="url" [alt]="f.opponent" (error)="rift.hideImg($event)" />
                } @else {
                  <span class="cap">vs {{ f.opponent.slice(0, 3) }}</span>
                }
                <svg class="coin" viewBox="0 0 16 16" aria-hidden="true"><g stroke="#3a2606" stroke-width="0.8"><path d="M2.5 11.2v1.6c0 1.2 2.5 2.1 5.5 2.1s5.5-.9 5.5-2.1v-1.6z" fill="#b07a1e" /><ellipse cx="8" cy="11.2" rx="5.5" ry="2.1" fill="#e9b949" /><path d="M2.5 7.7v1.6c0 1.2 2.5 2.1 5.5 2.1s5.5-.9 5.5-2.1V7.7z" fill="#b07a1e" /><ellipse cx="8" cy="7.7" rx="5.5" ry="2.1" fill="#e9b949" /><path d="M2.5 4.2v1.6c0 1.2 2.5 2.1 5.5 2.1s5.5-.9 5.5-2.1V4.2z" fill="#b07a1e" /><ellipse cx="8" cy="4.2" rx="5.5" ry="2.1" fill="#fbd96b" /></g><ellipse cx="8" cy="4.2" rx="3" ry="1" fill="none" stroke="#c48d22" stroke-width="0.7" /></svg>
                <span class="diff" [class.ahead]="l.mine > f.theirs" [class.behind]="l.mine < f.theirs">{{ gold(l.mine - f.theirs) }}</span>
              </button>
            }
            @if (showTeam() && o.team; as t) {
              <div class="gold">
                <span class="cap">Team</span>
                <svg class="coin" viewBox="0 0 16 16" aria-hidden="true"><g stroke="#3a2606" stroke-width="0.8"><path d="M2.5 11.2v1.6c0 1.2 2.5 2.1 5.5 2.1s5.5-.9 5.5-2.1v-1.6z" fill="#b07a1e" /><ellipse cx="8" cy="11.2" rx="5.5" ry="2.1" fill="#e9b949" /><path d="M2.5 7.7v1.6c0 1.2 2.5 2.1 5.5 2.1s5.5-.9 5.5-2.1V7.7z" fill="#b07a1e" /><ellipse cx="8" cy="7.7" rx="5.5" ry="2.1" fill="#e9b949" /><path d="M2.5 4.2v1.6c0 1.2 2.5 2.1 5.5 2.1s5.5-.9 5.5-2.1V4.2z" fill="#b07a1e" /><ellipse cx="8" cy="4.2" rx="5.5" ry="2.1" fill="#fbd96b" /></g><ellipse cx="8" cy="4.2" rx="3" ry="1" fill="none" stroke="#c48d22" stroke-width="0.7" /></svg>
                <span class="diff" [class.ahead]="t.ours > t.theirs" [class.behind]="t.ours < t.theirs">{{ gold(t.ours - t.theirs) }}</span>
              </div>
            }
            @if (showCs() && csPerMin(o); as cs) {
              <div class="gold"><span class="cap">CS</span><span class="diff cs" [class.low]="+cs < 5" [class.great]="+cs >= 8">{{ cs }}</span></div>
            }
          </div>
          @if (foesOpen() && showLane() && o.lane?.foes?.length) {
            <!-- Like swapping rows on the scoreboard: pick the enemy to compare against. -->
            <div #foesRow class="foes">
              @for (e of o.lane!.foes!; track $index) {
                <button class="foe" [class.on]="e.opponent === foe().opponent" (click)="pickFoe(e.opponent)">
                  <span class="cap">{{ role(e.position) }}</span>
                  @if (champIcon(e.championId ?? 0); as url) {
                    <img class="champ" [src]="url" [alt]="e.opponent" (error)="rift.hideImg($event)" />
                  } @else {
                    <span class="cap">{{ e.opponent.slice(0, 3) }}</span>
                  }
                  <span class="diff" [class.ahead]="o.lane!.mine > e.theirs" [class.behind]="o.lane!.mine < e.theirs">{{ gold(o.lane!.mine - e.theirs) }}</span>
                </button>
              }
            </div>
          }
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
          @if (showBuyNow() && buyNow().length) {
            <!-- Your gold right now, spent toward the build: the next item or the pieces of it that fit. -->
            <div class="build buy">
              <div class="cap">Buy now · {{ o.gold | number: '1.0-0' }} gold</div>
              <div class="chips">
                @for (b of buyNow(); track b.id) {
                  <span class="chip">
                    @if (rift.itemIcon(b.id); as url) { <img [src]="url" alt="" (error)="rift.hideImg($event)" /> }
                    <span class="name">{{ b.name }}@if (b.count > 1) { <span class="count">×{{ b.count }}</span> }</span>
                    <span class="price">{{ b.price * b.count }}</span>
                  </span>
                }
              </div>
            </div>
          }
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
        <!-- Bottom-right corner, out of the top line's way. -->
        <button #lockBtn class="lock" [title]="locked() ? 'Unlock to move' : 'Lock in place'"
          (click)="rift.setOverlayLocked(!locked())">
          <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
            <rect x="3" y="7" width="10" height="7" rx="1.5" fill="currentColor" />
            <path [attr.d]="locked() ? 'M5 7V5a3 3 0 0 1 6 0v2' : 'M5 7V5a3 3 0 0 1 6 0'" fill="none" stroke="currentColor" stroke-width="1.6" />
          </svg>
        </button>
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
      padding: 10px 12px 14px;
      color: #f1f2f5;
      font-size: 13px;
      text-shadow: 0 1px 2px #000;
    }
    .drag-layer { position: absolute; inset: 0; z-index: 10; border-radius: 14px; cursor: move; }
    .top { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 4px 5px; margin-bottom: 6px; }
    /* Tighter labels so skills, both gold diffs and CS/min fit one line at the default width. */
    .top .cap { letter-spacing: 0.02em; }
    .lock {
      all: unset; position: relative; z-index: 11;
      display: grid; place-items: center; width: 20px; height: 20px; border-radius: 5px;
      color: var(--text-faint); cursor: pointer;
    }
    .lock:hover { color: var(--accent); background: rgba(255, 79, 163, 0.16); }
    .lock { position: absolute; right: 4px; bottom: 3px; width: 16px; height: 16px; }
    .gold { display: flex; align-items: center; gap: 2px; white-space: nowrap; }
    .gold .champ { width: 18px; height: 18px; border-radius: 4px; border: 1px solid rgba(255, 255, 255, 0.15); }
    .gold .coin { width: 15px; height: 15px; margin-right: -2px; flex-shrink: 0; }
    .gold .diff { font: 600 13px var(--mono); color: var(--text-dim); }
    .gold .diff.ahead { color: var(--win); }
    .gold .diff.behind { color: var(--loss); }
    /* CS/min: red under 5, blue (the situational tags' blue) for 5–7.9, green from 8. */
    .gold .diff.cs { color: #7cc4ff; }
    .gold .diff.cs.low { color: var(--loss); }
    .gold .diff.cs.great { color: var(--win); }
    /* Above the drag layer, and kept clickable when locked (see the button rects). */
    .pick, .foe { all: unset; position: relative; z-index: 11; cursor: pointer; border-radius: 5px; }
    .pick { display: flex; align-items: center; gap: 2px; padding: 0 2px; white-space: nowrap; }
    .pick:hover, .pick.open { background: rgba(255, 255, 255, 0.08); }
    .pick:disabled { cursor: default; background: none; }
    .foes { display: flex; justify-content: space-between; gap: 3px; margin: -2px 0 6px; }
    .foe { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 1px; padding: 3px 0; background: rgba(255, 255, 255, 0.04); }
    .foe:hover { background: rgba(255, 255, 255, 0.1); }
    .foe.on { box-shadow: inset 0 0 0 1px rgba(255, 79, 163, 0.6); }
    .foe .champ { width: 20px; height: 20px; border-radius: 4px; border: 1px solid rgba(255, 255, 255, 0.15); }
    .foe .diff { font: 600 11.5px var(--mono); color: var(--text-dim); }
    .foe .diff.ahead { color: var(--win); }
    .foe .diff.behind { color: var(--loss); }
    .skills { display: flex; align-items: center; gap: 2px; font-size: 13px; flex-shrink: 0; }
    .skills b { color: var(--accent); padding: 0 1px; border-radius: 4px; }
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
    .buy .chips { display: flex; flex-wrap: wrap; gap: 4px; }
    .buy .chip {
      display: inline-flex; align-items: center; gap: 5px; max-width: 100%;
      padding: 2px 7px 2px 2px; border-radius: 6px; font-size: 12px;
      border: 1px solid rgba(60, 207, 142, 0.45); background: rgba(60, 207, 142, 0.1);
    }
    .buy .chip img { width: 20px; height: 20px; border-radius: 4px; }
    .buy .chip .name { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .buy .chip .price { font: 11.5px var(--mono); color: var(--win); }
    .buy .chip .count { margin-left: 3px; font: 11.5px var(--mono); color: var(--text-dim); }
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
  protected readonly showTeam = computed(() => this.rift.config()?.showTeamDiff ?? true);
  protected readonly showCs = computed(() => this.rift.config()?.showCs ?? true);
  protected readonly showBuyNow = computed(() => this.rift.config()?.showBuyNow ?? true);
  protected readonly expanded = signal(false);
  protected readonly foesOpen = signal(false);
  /** The enemy you picked, with the game's enemy line-up so a new game goes back to your lane opponent. */
  private readonly picked = signal<{ name: string; lineup: string } | null>(null);
  private readonly lineup = computed(() => (this.state()?.lane?.foes ?? []).map((f) => f.opponent).join('|'));
  protected readonly lanePos = computed(() => {
    const l = this.state()?.lane;
    return l?.foes?.find((f) => f.opponent === l.opponent)?.position ?? '';
  });
  /** Who the lane gold diff compares against: your pick, else your lane opponent. */
  protected readonly foe = computed(() => {
    const l = this.state()!.lane!;
    const p = this.picked();
    const pick = p && p.lineup === this.lineup() ? l.foes?.find((f) => f.opponent === p.name) : undefined;
    return pick ?? { opponent: l.opponent, championId: l.championId, position: this.lanePos(), theirs: l.theirs };
  });
  /** The shopping list, unless it only repeats rows the build card already marks green. */
  protected readonly buyNow = computed(() => {
    const o = this.state();
    const list = o?.buyNow ?? [];
    const it = o?.nextItems[0];
    const ready = new Set([it, ...(it?.components ?? [])].filter((x) => x?.affordable).map((x) => x!.id));
    return list.every((b) => ready.has(b.id) && b.count === 1) ? [] : list;
  });
  protected readonly locked = this.rift.overlayLocked;
  protected time = clock;
  protected champIcon = championIcon;
  private readonly lockBtn = viewChild<ElementRef<HTMLElement>>('lockBtn');
  private readonly moreBtn = viewChild<ElementRef<HTMLElement>>('moreBtn');
  private readonly goldBtn = viewChild<ElementRef<HTMLElement>>('goldBtn');
  private readonly foesRow = viewChild<ElementRef<HTMLElement>>('foesRow');
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  constructor() {
    afterRenderEffect(() => {
      // The buttons stay clickable while the rest of the locked overlay is click-through.
      // Re-measured on every update: rows above "more" (timers, items) move it.
      this.state();
      this.expanded();
      this.foesOpen();
      this.showTimers();
      this.showLane();
      this.showSit();
      this.showCs();
      this.showTeam();
      this.showBuyNow();
      this.width();
      this.scale();
      const rects = [this.lockBtn(), this.moreBtn(), this.goldBtn(), this.foesRow()]
        .map((b) => b?.nativeElement.getBoundingClientRect())
        .filter((r): r is DOMRect => !!r)
        .map((r): [number, number, number, number] => [r.x, r.y, r.width, r.height]);
      this.rift.setOverlayButtons(rects);
      // The window follows the panel's size (wrapped reasons, the expanded list, Settings).
      const r = this.host.nativeElement.getBoundingClientRect();
      if (this.state()) this.rift.fitOverlay(r.width, r.height);
    });
  }

  private dragFrame = 0;

  protected dragStart(e: PointerEvent): void {
    if (e.button !== 0) return;
    // Captured, so moves keep coming when a fast drag gets ahead of the window.
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    this.rift.dragOverlay(true);
  }

  protected dragMove(e: PointerEvent): void {
    if (!(e.target as HTMLElement).hasPointerCapture(e.pointerId) || this.dragFrame) return;
    // Once per frame; the backend reads the cursor itself, so skipped moves lose nothing.
    this.dragFrame = requestAnimationFrame(() => {
      this.dragFrame = 0;
      this.rift.dragOverlay(false);
    });
  }

  protected pickFoe(name: string): void {
    this.picked.set({ name, lineup: this.lineup() });
    this.foesOpen.set(false);
  }

  /** Scoreboard role, short: Top, Jg, Mid, Bot, Sup. */
  role(position: string): string {
    return { TOP: 'Top', JUNGLE: 'Jg', MIDDLE: 'Mid', BOTTOM: 'Bot', UTILITY: 'Sup' }[position] ?? '?';
  }

  /** CS per minute to one decimal, e.g. "7.2"; nothing in the first minute, when it jumps around. */
  csPerMin(o: OverlayState): string {
    return o.gameTime >= 60 && o.cs != null ? ((o.cs * 60) / o.gameTime).toFixed(1) : '';
  }

  /** Signed and short: +500, −1.3k. */
  gold(n: number): string {
    const sign = n > 0 ? '+' : n < 0 ? '−' : '±';
    const a = Math.abs(n);
    return sign + (a >= 1000 ? `${(a / 1000).toFixed(1)}k` : `${a}`);
  }
}
