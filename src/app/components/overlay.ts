import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, ElementRef, afterRenderEffect, computed, effect, inject, input, signal, viewChild } from '@angular/core';
import { RiftService } from '../core/rift.service';
import { championIcon, clock } from '../core/assets';
import { OverlayState } from '../core/models';

/** Seconds the overlay's clock may run past the last update. */
const MAX_AHEAD = 3;

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
  skillLevels: [4, 2, 1, 1],
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
    '(document:contextmenu)': 'inline() || $event.preventDefault()',
  },
  template: `
    @if (state(); as o) {
      <div class="panel" [style.opacity]="opacity()">
        <!-- One line, spread across the width: item gold diffs, CS/min (each can be off). -->
        @if ((showLane() && o.lane) || (showTeam() && o.team) || (showCs() && csPerMin(o))) {
          <div class="top">
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
                <img class="coin" src="gold.png" alt="" />
                <span class="diff" [class.ahead]="l.mine > f.theirs" [class.behind]="l.mine < f.theirs">{{ gold(l.mine - f.theirs) }}</span>
              </button>
            }
            @if (showTeam() && o.team; as t) {
              <div class="gold">
                <span class="cap">Team</span>
                <img class="coin" src="gold.png" alt="" />
                <span class="diff" [class.ahead]="t.ours > t.theirs" [class.behind]="t.ours < t.theirs">{{ gold(t.ours - t.theirs) }}</span>
              </div>
            }
            @if (showCs() && csPerMin(o); as cs) {
              <div class="gold"><span class="cap">CS/min</span><span class="diff cs" [class.low]="+cs < 5" [class.great]="+cs >= 8">{{ cs }}</span></div>
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
              <div class="timer" [class]="t.side" [class.soon]="t.spawnAt - now() <= 30">
                <span class="label">{{ t.label }}</span>
                <span class="left">{{ time(t.spawnAt - now()) }}</span>
              </div>
            }
          </div>
        }
        @if (o.skillMax.length) {
          <!-- The max order with points so far: the skill you're maxing now, the one after it, and a pulse on the one to level when you have a point. -->
          @let m = maxing(o);
          <div class="build skills">
            <div class="cap">Skills</div>
            <div class="maxrow">
              @for (k of o.skillMax; track k; let i = $index; let last = $last) {
                <div class="sk" [class.now]="i === m" [class.next]="i === m + 1" [class.done]="points(o, k) >= MAX_RANK" [class.levelup]="k === o.nextSkill"
                  [title]="i === m ? 'Maxing now' : i === m + 1 ? 'Max next' : ''">
                  <b>{{ rift.abilityKey(k) }}</b>
                  <span class="pips">
                    @for (p of ranks; track p) { <i [class.on]="p < points(o, k)"></i> }
                  </span>
                </div>
                @if (!last) {
                  <svg class="sep" viewBox="0 0 6 10" width="6" height="10" aria-hidden="true"><path d="M1 1l4 4-4 4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" /></svg>
                }
              }
              @if (o.nextSkill && !o.skillMax.includes(o.nextSkill)) {
                <div class="sk ult levelup" title="Level up now"><b>{{ rift.abilityKey(o.nextSkill) }}</b><span class="tag">Up</span></div>
              }
            </div>
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
          <!-- Collapsed until you open it: the header is the dropdown and says how many counters there are. -->
          <div class="build sit">
            <button #moreBtn class="cap toggle" [class.open]="expanded()" [attr.aria-expanded]="expanded()" (click)="expanded.set(!expanded())">
              Situational · vs this team
              <span class="count">{{ o.situational.length }}</span>
              <svg viewBox="0 0 10 10" width="9" height="9" aria-hidden="true"><path d="M2 3.5l3 3 3-3" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" /></svg>
            </button>
            @if (expanded()) {
              @for (it of o.situational; track it.id) {
                <div class="item" [class.ready]="it.affordable" [title]="it.reason">
                  @if (rift.itemIcon(it.id); as url) { <img [src]="url" alt="" (error)="rift.hideImg($event)" /> }
                  <span class="name">{{ it.name }}</span>
                  @if (it.price) { <span class="price">{{ it.price }}</span> }
                </div>
                <div class="why"><span class="tag">{{ it.label }}</span> · {{ it.reason }}</div>
              }
            }
          </div>
        }
        <!-- The move handle, a pin on the top-right corner: hold and drag; the rest of the overlay lets clicks through to the game. -->
        <button #moveBtn class="move" [title]="inline() ? 'In game, drag here to move it' : 'Drag to move'" aria-label="Move overlay" (pointerdown)="dragStart($event)" (pointermove)="dragMove($event)"
          (pointerup)="dragEnd($event)" (pointercancel)="dragEnd($event)">
          <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
            <path d="M8 1.5v13M1.5 8h13" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
            <path d="M5.8 3.7 8 1.5l2.2 2.2M5.8 12.3 8 14.5l2.2-2.2M3.7 5.8 1.5 8l2.2 2.2M12.3 5.8 14.5 8l-2.2 2.2" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        </button>
        @if (preview() && !inline() && !rift.overlay()) {
          <div class="cap center">Preview</div>
        }
      </div>
    }
  `,
  styles: `
    :host { display: block; box-sizing: border-box; padding: 8px; }
    .panel {
      position: relative;
      /* Darker, flatter glass with one pink hairline on top, like the app's cards. */
      background: linear-gradient(180deg, rgba(255, 255, 255, 0.04), rgba(255, 255, 255, 0) 40%), rgba(11, 10, 16, 0.9);
      border: 1px solid rgba(255, 255, 255, 0.09);
      box-shadow: inset 0 1px 0 rgba(255, 79, 163, 0.55);
      border-radius: 14px;
      padding: 10px 12px;
      color: #f1f2f5;
      font-size: 13px;
      text-shadow: 0 1px 2px #000;
    }
    .top { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 4px 5px; margin-bottom: 6px; }
    /* Tighter labels so skills, both gold diffs and CS/min fit one line at the default width. */
    .top .cap { font: 500 10.5px var(--font); letter-spacing: 0.02em; }
    /* Sits on the corner, half over the border, in the host's 8px padding. Pink like the app's accents, with the system's pointing hand. */
    .move {
      all: unset; position: absolute; z-index: 11; top: -8px; right: -8px;
      display: grid; place-items: center; width: 22px; height: 22px; border-radius: 50%; box-sizing: border-box;
      background: rgb(43, 20, 36); border: 1px solid rgba(255, 79, 163, 0.6);
      color: var(--accent); cursor: pointer; transition: color 0.12s, background 0.12s, box-shadow 0.12s;
    }
    .move:hover { color: #fff; border-color: var(--accent); box-shadow: 0 0 8px var(--accent-glow); }
    .move:active { color: #fff; background: var(--accent); border-color: var(--accent); }
    .move svg { pointer-events: none; }
    .gold { display: flex; align-items: center; gap: 2px; white-space: nowrap; }
    .gold .champ { width: 18px; height: 18px; border-radius: 4px; border: 1px solid rgba(255, 255, 255, 0.15); }
    /* The game's own gold coin (floating text icon), bundled in public/. */
    .gold .coin { width: 14px; height: 14px; margin: 0 1px 0 1px; flex-shrink: 0; }
    /* Big glanceable numbers: the app's display face, same-width digits. */
    .gold .diff { font: 700 14.5px var(--display); font-variant-numeric: tabular-nums; color: var(--text-dim); }
    .gold .diff.ahead { color: var(--win); }
    .gold .diff.behind { color: var(--loss); }
    /* CS/min: red under 5, blue (the situational tags' blue) for 5–7.9, green from 8. */
    .gold .diff.cs { color: #7cc4ff; }
    .gold .diff.cs.low { color: var(--loss); }
    .gold .diff.cs.great { color: var(--win); }
    /* Kept clickable while the rest of the overlay lets clicks through (see the button rects). */
    .pick, .foe { all: unset; position: relative; z-index: 11; cursor: pointer; border-radius: 5px; }
    .pick { display: flex; align-items: center; gap: 2px; padding: 0 2px; white-space: nowrap; }
    .pick:hover, .pick.open { background: rgba(255, 255, 255, 0.08); }
    .pick:disabled { cursor: default; background: none; }
    .foes { display: flex; justify-content: space-between; gap: 3px; margin: -2px 0 6px; }
    .foe { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 1px; padding: 3px 0; background: rgba(255, 255, 255, 0.04); }
    .foe:hover { background: rgba(255, 255, 255, 0.1); }
    .foe.on { box-shadow: inset 0 0 0 1px rgba(255, 79, 163, 0.6); }
    .foe .champ { width: 20px; height: 20px; border-radius: 4px; border: 1px solid rgba(255, 255, 255, 0.15); }
    .foe .diff { font: 700 12px var(--display); font-variant-numeric: tabular-nums; color: var(--text-dim); }
    .foe .diff.ahead { color: var(--win); }
    .foe .diff.behind { color: var(--loss); }
    /* Skill order on one slim line: the label, then a chip per maxed ability with five pips for its
       points. Colour says which is which: pink is the one you're maxing now, teal the next, finished ones fade. */
    .build.skills { flex-direction: row; align-items: center; gap: 8px; }
    .skills .cap { flex: none; }
    .maxrow { flex: 1; min-width: 0; display: flex; align-items: center; gap: 4px; }
    .maxrow .sep { flex: none; color: var(--text-faint); }
    .sk {
      flex: 1 1 0; min-width: 0; height: 20px; box-sizing: border-box; display: flex; align-items: center; justify-content: center; gap: 5px;
      padding: 0 6px; border-radius: 6px; background: rgba(255, 255, 255, 0.035); border: 1px solid rgba(255, 255, 255, 0.08);
    }
    .sk b { font: 700 12.5px/1 var(--display); color: var(--text-dim); }
    .sk .pips { display: flex; gap: 2px; }
    .sk .pips i { width: 3px; height: 8px; border-radius: 1.5px; background: rgba(255, 255, 255, 0.14); }
    .sk .pips i.on { background: var(--text-dim); }
    .sk.now { border-color: rgba(255, 79, 163, 0.5); background: rgba(255, 79, 163, 0.12); }
    .sk.now b { color: var(--accent); }
    .sk.now .pips i.on { background: var(--accent); box-shadow: 0 0 4px var(--accent-glow); }
    .sk.next { border-color: rgba(47, 212, 196, 0.4); background: rgba(47, 212, 196, 0.07); }
    .sk.next b { color: var(--accent-2); }
    .sk.next .pips i.on { background: var(--accent-2); }
    .sk.done { opacity: 0.5; }
    /* R when it's the one to level: a small gold chip on the end. */
    .sk.ult { flex: none; gap: 4px; }
    .sk.ult b, .sk.ult .tag { color: var(--gold); }
    .sk.ult .tag { font-size: 8.5px; font-weight: 700; line-height: 1; letter-spacing: 0.06em; text-transform: uppercase; }
    /* The key to put your next point in. */
    .levelup { animation: pulse 1.6s ease-in-out infinite; }
    @keyframes pulse { 50% { box-shadow: 0 0 0 2px rgba(255, 79, 163, 0.45), 0 0 12px var(--accent-glow); } }
    .timers { display: flex; flex-direction: column; gap: 3px; }
    .timer {
      display: flex; justify-content: space-between; align-items: center; padding: 2px 9px; border-radius: 8px;
      background: rgba(255, 255, 255, 0.035); border-left: 2px solid var(--text-faint); font-size: 12.5px; color: var(--text-dim);
    }
    .timer.ally { border-left-color: var(--ally); }
    .timer.enemy { border-left-color: var(--enemy); }
    .timer.soon { background: rgba(255, 79, 163, 0.16); color: var(--text); box-shadow: inset 0 0 0 1px rgba(255, 79, 163, 0.35); }
    .timer.soon .left { color: var(--accent); text-shadow: 0 0 10px var(--accent-glow); }
    .left { font: 700 15px var(--display); font-variant-numeric: tabular-nums; color: var(--text); }
    .build { margin-top: 8px; border-top: 1px solid rgba(255, 255, 255, 0.06); padding-top: 7px; display: flex; flex-direction: column; gap: 5px; }
    .cap { font-size: 10.5px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.1em; color: var(--text-faint); }
    .build > .cap:first-child::before { content: ''; display: inline-block; width: 5px; height: 5px; border-radius: 50%; background: var(--accent); margin: 0 6px 1px 0; vertical-align: middle; box-shadow: 0 0 6px var(--accent-glow); }
    .center { text-align: center; margin-top: 6px; }
    .item { display: flex; align-items: center; gap: 8px; }
    .item img { width: 26px; height: 26px; border-radius: 6px; border: 1px solid rgba(255, 255, 255, 0.14); }
    .item .name { flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-weight: 600; }
    .item .price { font: 700 12.5px var(--display); font-variant-numeric: tabular-nums; color: var(--text-faint); }
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
    .comp .name { font-weight: 400; }
    .comp img { width: 20px; height: 20px; }
    .comp .n { width: 10px; margin-left: -14px; font: 10px var(--mono); color: var(--text-faint); text-align: right; }
    /* Blue, not red or green, so it doesn't read like the gold diffs. */
    .sit .tag { font-size: 10px; text-transform: uppercase; letter-spacing: 0.06em; color: #7cc4ff; }
    /* Wraps instead of cutting off: the click-through overlay can't show a tooltip. */
    .sit .why { margin: -2px 0 2px 32px; font-size: 11.5px; color: var(--text-dim); line-height: 1.3; }
    /* The section header is the dropdown: a real button (kept clickable), with a count and a chevron that flips when open. */
    .toggle {
      all: unset; position: relative; z-index: 11; align-self: stretch; display: flex; align-items: center; gap: 6px;
      font-size: 10.5px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.1em; color: var(--text-faint);
      cursor: pointer; margin: -2px -4px; padding: 2px 4px; border-radius: 6px;
    }
    .toggle::before { flex: none; margin: 0 !important; }
    .toggle:hover { color: var(--text-dim); background: rgba(255, 255, 255, 0.05); }
    .toggle .count {
      font: 700 10px/1 var(--display); letter-spacing: 0; color: #7cc4ff; padding: 2px 5px; border-radius: 5px;
      background: rgba(124, 196, 255, 0.12); border: 1px solid rgba(124, 196, 255, 0.35);
    }
    .toggle svg { margin-left: auto; color: #7cc4ff; transition: transform 0.15s; }
    .toggle.open svg { transform: rotate(180deg); }
  `,
})
export class Overlay {
  protected readonly rift = inject(RiftService);
  protected readonly preview = this.rift.overlayPreview;
  /** Shown inside the main window (Settings' preview), not as the overlay window. */
  readonly inline = input(false);
  protected readonly state = computed(() => this.rift.overlay() ?? (this.preview() || this.inline() ? this.previewState() : null));
  /** The sample game, minus what the engine leaves out with your settings (skill order, the build). */
  private readonly previewState = computed((): OverlayState => {
    const c = this.rift.config();
    const opgg = c?.recSource === 'opgg';
    const build = opgg && (c?.useRecommendedBuilds ?? true);
    return {
      ...PREVIEW,
      skillMax: opgg && (c?.showSkillHint ?? true) ? PREVIEW.skillMax : [],
      nextSkill: opgg && (c?.showSkillHint ?? true) ? PREVIEW.nextSkill : null,
      skillLevels: PREVIEW.skillLevels,
      nextItems: build ? PREVIEW.nextItems : [],
      buyNow: build ? PREVIEW.buyNow : [],
      hasBuild: build,
    };
  });
  protected readonly MAX_RANK = 5;
  protected readonly ranks = [0, 1, 2, 3, 4];
  /** Points in one ability (Q, W, E or R). */
  protected points(o: OverlayState, key: string): number {
    return o.skillLevels?.['QWER'.indexOf(key)] ?? 0;
  }
  /** Index in the max order of the ability you're maxing now: the first one not at rank 5. */
  protected maxing(o: OverlayState): number {
    const i = o.skillMax.findIndex((k) => this.points(o, k) < this.MAX_RANK);
    return i < 0 ? o.skillMax.length : i;
  }
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
  /** Ticks a few times a second while there are timers, so they count down between updates. */
  private readonly tick = signal(0);
  private readonly ticking = computed(() => this.showTimers() && !!this.state()?.timers.length);
  /**
   * Game time now: the last update's, plus the time since it arrived. Capped a
   * little ahead, so a paused game or a slow read doesn't run the timers off.
   */
  protected readonly now = computed(() => {
    this.tick();
    const t = this.state()?.gameTime ?? 0;
    if (!this.rift.overlay()) return t;
    return t + Math.min(MAX_AHEAD, (performance.now() - this.rift.overlayAt()) / 1000);
  });
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
  protected time = clock;
  protected champIcon = championIcon;
  private readonly moveBtn = viewChild<ElementRef<HTMLElement>>('moveBtn');
  private readonly moreBtn = viewChild<ElementRef<HTMLElement>>('moreBtn');
  private readonly goldBtn = viewChild<ElementRef<HTMLElement>>('goldBtn');
  private readonly foesRow = viewChild<ElementRef<HTMLElement>>('foesRow');
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  constructor() {
    effect((onCleanup) => {
      if (!this.ticking()) return;
      const id = setInterval(() => this.tick.update((n) => n + 1), 250);
      onCleanup(() => clearInterval(id));
    });
    afterRenderEffect(() => {
      // The buttons stay clickable while the rest of the overlay is click-through.
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
      const rects = [this.moveBtn(), this.moreBtn(), this.goldBtn(), this.foesRow()]
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

  /** Hold the move handle to drag the window; it stays where you let go. */
  protected dragStart(e: PointerEvent): void {
    if (e.button !== 0) return;
    e.preventDefault();
    // Captured, so moves keep coming when a fast drag gets ahead of the window.
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    this.rift.dragOverlay('start');
  }

  protected dragMove(e: PointerEvent): void {
    if (!(e.currentTarget as HTMLElement).hasPointerCapture(e.pointerId) || this.dragFrame) return;
    // Once per frame; the backend reads the cursor itself, so skipped moves lose nothing.
    this.dragFrame = requestAnimationFrame(() => {
      this.dragFrame = 0;
      this.rift.dragOverlay('move');
    });
  }

  /** Let go (or the drag was cancelled): the backend saves the spot. */
  protected dragEnd(e: PointerEvent): void {
    if (!(e.currentTarget as HTMLElement).hasPointerCapture(e.pointerId)) return;
    (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    this.rift.dragOverlay('end');
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
