import { ChangeDetectionStrategy, Component, computed, input, signal } from '@angular/core';
import { MatchLine } from '../core/models';
import { readLocal, writeLocal } from '../core/storage';
import { RankPicker, rankName } from './rank-picker';

type Role = 'top' | 'jungle' | 'mid' | 'adc' | 'support' | 'any';
type AxisKey = 'gold' | 'damage' | 'fights' | 'kda' | 'deaths' | 'vision' | 'objectives';

/**
 * Rough per-role targets for an average ranked game (around Gold/Platinum, scaled by `RANK_SCALE`), per minute
 * unless noted. `any` is used when the game's position isn't known.
 */
type Targets = { gold: number; damage: number; kp: number; kda: number; deaths: number; vision: number; objectives: number };

const TARGETS: Record<Role, Targets> = {
  //        gold/min  dmg/min   kill part.  KDA        deaths/min      vision/min    objective dmg/min
  top: { gold: 400, damage: 600, kp: 0.45, kda: 2.6, deaths: 0.18, vision: 0.7, objectives: 220 },
  jungle: { gold: 380, damage: 470, kp: 0.6, kda: 3, deaths: 0.17, vision: 1, objectives: 600 },
  mid: { gold: 420, damage: 720, kp: 0.55, kda: 2.8, deaths: 0.18, vision: 0.75, objectives: 160 },
  adc: { gold: 430, damage: 720, kp: 0.55, kda: 2.8, deaths: 0.17, vision: 0.65, objectives: 230 },
  support: { gold: 270, damage: 320, kp: 0.62, kda: 3.3, deaths: 0.18, vision: 2.1, objectives: 60 },
  any: { gold: 390, damage: 580, kp: 0.55, kda: 2.9, deaths: 0.18, vision: 1, objectives: 250 },
};

/**
 * How the targets move with rank (estimates): gold, damage, vision, objective damage and KDA
 * scale by this, the deaths target shrinks by it, and kill participation stays put.
 */
const RANK_SCALE: Record<string, number> = {
  IRON: 0.85, BRONZE: 0.89, SILVER: 0.94, GOLD: 0.98, PLATINUM: 1.02, EMERALD: 1.05, DIAMOND: 1.08, MASTER: 1.12, GRANDMASTER: 1.14, CHALLENGER: 1.16,
};
/** A "+" filter (Gold+) sits a little above its own rank. */
const PLUS_BUMP = 0.03;
/** Where the chosen rank to compare with is kept ('' = the player's own). */
const RANK_KEY = 'leaguebro.playstyleRank';

/** Queues and modes the targets don't fit (they're for Summoner's Rift). */
const OFF_RIFT_QUEUES = new Set([72, 73, 75, 76, 78, 83, 98, 100, 310, 313, 317, 318, 325, 450, 720, 900, 920, 1010, 1020, 1300, 1400, 1700, 1710, 1900, 2300, 2400]);
const OFF_RIFT_MODE = /ARAM|CHERRY|ARENA|URF|ONEFORALL|NEXUS|ULTBOOK|BRAWL|KIWI|STRAWBERRY|DOOMBOT|SNOWURF|TUTORIAL|PRACTICE/i;

const AXES: { key: AxisKey; label: string; low: string; high: string }[] = [
  {
    key: 'gold', label: 'Gold',
    low: "Farm between fights and catch side waves. CS is most of a game's gold.",
    high: 'Turn leads into more: take plates and push your wave before you roam, so no gold is left behind.',
  },
  {
    key: 'damage', label: 'Damage',
    low: 'Trade more in lane and stay in range in fights. Only damage to champions counts.',
    high: 'Look for longer trades when your spells are up, and keep hitting the closest target in fights instead of waiting for the perfect one.',
  },
  {
    key: 'fights', label: 'Team fights',
    low: 'Group with your team for skirmishes and objectives. Too many kills are happening without you.',
    high: 'Watch the minimap for fights about to start and get there first, with Teleport or a shove and roam.',
  },
  {
    key: 'kda', label: 'KDA',
    low: "Pick fights you can win and walk away from the ones you can't. A good KDA is mostly not throwing deaths away.",
    high: 'Keep the discipline: count enemy cooldowns before you commit, and leave once the fight is won.',
  },
  {
    key: 'deaths', label: 'Deaths',
    low: 'Ward before pushing past the river, and back off when your lane opponent goes missing.',
    high: "Every death you skip is gold and time for your team. Check the minimap every few seconds and don't face-check bushes.",
  },
  {
    key: 'vision', label: 'Vision',
    low: 'Buy a Control Ward every back, use your trinket on cooldown, and swap to Oracle Lens later on.',
    high: 'Ward where the next objective spawns a minute before it does, and clear enemy wards on the way.',
  },
  {
    key: 'objectives', label: 'Objectives',
    low: 'Hit towers after a won fight and show up for dragons, grubs and Baron. Objectives win games.',
    high: 'Set up the next objective before the fight starts, and ping it so your team goes with you.',
  },
];

/** A game's score on an axis tops out at this many times the target, so one stomp doesn't hide the rest. */
const GAME_CAP = 2;
/** The chart's edge stands for this many times the target; the dashed ring is the target. */
const EDGE = 1.5;
const MIN_GAMES = 3;

const VIEW_W = 400;
const VIEW_H = 300;
const CX = 200;
const CY = 152;
const R = 120;
/** Labels sit this far out (share of the radius). */
const LABEL_AT = 1.16;

interface Axis {
  key: AxisKey;
  label: string;
  /** What to work on: the "low" tip under target, the "high" one on or above it. */
  tip: string;
  /** Average share of the target (1 = on target). */
  score: number;
  /** What it was, for the label: "412/min". */
  value: string;
  /** The target in the same units: "450/min". */
  goal: string;
  games: number;
}

function roleOf(m: MatchLine): Role {
  const p = m.position;
  if (p === 'top' || p === 'jungle' || p === 'mid' || p === 'adc' || p === 'support') return p;
  return m.spells.includes(11) ? 'jungle' : 'any';
}

function avg(list: number[]): number {
  return list.length ? list.reduce((a, b) => a + b, 0) / list.length : 0;
}

/** How much a rank filter ('gold', 'gold_plus', 'all') scales the targets. */
function rankScale(id: string): number {
  const base = id.replace(/_plus$/, '').toUpperCase();
  const k = RANK_SCALE[base];
  if (!k) return 1;
  return id.endsWith('_plus') ? k + PLUS_BUMP : k;
}

/** Your recent games on seven axes, each against a target for the role you played, as a spider chart. */
@Component({
  selector: 'rl-playstyle-radar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RankPicker],
  template: `
    <section class="card stack">
      <div class="card-head">
        <div class="title">
          <h3>Playstyle</h3>
          @if (games() > 0) {
            <span class="faint small note">From {{ who() === 'You' ? 'your' : 'their' }} last {{ games() }} Summoner's Rift {{ games() === 1 ? 'game' : 'games' }}</span>
          }
        </div>
        <div class="head-right">
          <rl-rank-picker class="end" [small]="true" [value]="chosen()" [auto]="autoLabel()" [autoRank]="ownTier()" (picked)="pickRank($event)" />
        </div>
      </div>
      @if (offRift()) {
        <p class="faint small">The playstyle chart only counts Summoner's Rift games, so it sits this queue out.</p>
      } @else if (axes().length < 3) {
        <p class="faint small">Play a few more Summoner's Rift games and this fills in.</p>
      } @else {
        <div class="chart">
          <div class="plot">
          <svg class="radar" [attr.viewBox]="'0 0 ' + viewW + ' ' + viewH" role="img" [attr.aria-label]="summary()">
            @for (ring of rings; track ring) {
              <polygon class="ring" [attr.points]="ringPoints(ring)" />
            }
            @for (a of axes(); track a.key; let i = $index) {
              <line class="spoke" [class.on]="hover() === i" [attr.x1]="cx" [attr.y1]="cy" [attr.x2]="at(i, 1).x" [attr.y2]="at(i, 1).y" />
            }
            @if (hover() !== null) { <polygon class="slice" [attr.points]="slice(hover()!)" /> }
            <polygon class="target" [attr.points]="ringPoints(1 / edge)" />
            <polygon class="shape" [attr.points]="shape()" />
            @for (a of axes(); track a.key; let i = $index) {
              <circle class="goal-dot" [class.on]="hover() === i" [attr.cx]="at(i, 1 / edge).x" [attr.cy]="at(i, 1 / edge).y" r="2.5" />
              <circle class="dot" [class.weak]="isWeak(a.key)" [attr.cx]="at(i, reach(a.score)).x" [attr.cy]="at(i, reach(a.score)).y" r="3" />
            }
            @for (a of axes(); track a.key; let i = $index) {
              <g class="axis" [class.on]="hover() === i" tabindex="0" [attr.aria-label]="a.label + ': ' + a.value + ', goal ' + a.goal"
                 (mouseenter)="hover.set(i)" (mouseleave)="hover.set(null)" (focus)="hover.set(i)" (blur)="hover.set(null)">
                <rect class="hit" [attr.x]="labelBox(i, a).x" [attr.y]="labelBox(i, a).y" [attr.width]="labelBox(i, a).w" [attr.height]="labelBox(i, a).h" rx="4" />
                <text class="label" [class.weak]="isWeak(a.key)" [attr.x]="at(i, labelAt).x" [attr.y]="at(i, labelAt).y" [attr.text-anchor]="anchor(i)">
                  <tspan [attr.x]="at(i, labelAt).x" dy="-0.15em">{{ a.label }}</tspan>
                  <tspan class="val" [attr.x]="at(i, labelAt).x" dy="1.2em">{{ a.value }}</tspan>
                </text>
              </g>
            }
          </svg>
          @if (hovered(); as h) {
            <div class="hover-card" [style]="h.style" role="tooltip">
              <div class="hc-head">
                <span class="hc-title">{{ h.axis.label }}</span>
                <span class="mono hc-score" [class.under]="h.axis.score < 0.95">{{ pct(h.axis.score) }}% of goal</span>
              </div>
              <div class="hc-row"><span class="faint">{{ who() }}</span><span class="mono">{{ h.axis.value }}</span></div>
              <div class="hc-row goal"><span>Goal {{ goalWhere() }}</span><span class="mono">{{ h.axis.goal }}</span></div>
              <div class="hc-tip">
                <span class="faint cap">{{ h.axis.score < 0.95 ? 'How to improve' : 'Next step' }}</span>
                <span class="small">{{ h.axis.tip }}</span>
              </div>
            </div>
          }
          </div>
          <div class="key faint small">
            <span><i class="sw you"></i>{{ who() }}</span>
            <span><i class="sw goal"></i>Goal for the role played {{ goalWhere() }}</span>
          </div>
          <p class="faint small hint">Hover a section for the goal and how to improve it.</p>
        </div>
      }
    </section>
  `,
  styles: `
    :host { display: block; }
    .card.stack { gap: 6px; height: 100%; }
    .card-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; min-height: 26px; }
    .head-right { display: flex; align-items: center; gap: 10px; }
    .title { display: flex; align-items: baseline; flex-wrap: wrap; gap: 2px 10px; min-width: 0; }
    .note { white-space: nowrap; }
    h3 { margin: 0; }
    .chart { flex: 1; display: flex; flex-direction: column; justify-content: center; gap: 6px; }
    .plot { position: relative; width: 100%; max-width: 640px; margin: 0 auto; }
    .radar { width: 100%; height: auto; display: block; overflow: visible; }
    .ring { fill: none; stroke: var(--line-strong); stroke-width: 1; }
    .spoke { stroke: var(--line); stroke-width: 1; transition: stroke 0.15s; }
    .spoke.on { stroke: var(--accent-2); }
    .target { fill: var(--accent-2-soft); stroke: var(--accent-2); stroke-width: 1.4; stroke-dasharray: 4 4; opacity: 0.85; pointer-events: none; }
    .shape { fill: var(--accent-soft); stroke: var(--accent); stroke-width: 2; stroke-linejoin: round; filter: drop-shadow(0 0 6px var(--accent-glow)); pointer-events: none; }
    .dot { fill: var(--accent); pointer-events: none; }
    .dot.weak { fill: var(--bg); stroke: var(--accent); stroke-width: 2; }
    .goal-dot { fill: var(--accent-2); opacity: 0; transition: opacity 0.15s; pointer-events: none; }
    .goal-dot.on { opacity: 1; }
    .axis { cursor: pointer; outline: none; }
    .hit { fill: transparent; }
    .label { pointer-events: none; }
    /* The hovered axis's share of the chart, kept inside the outer ring. */
    .slice { fill: var(--accent-2-soft); stroke: none; pointer-events: none; }
    .label { font-size: 9.5px; fill: var(--text); dominant-baseline: middle; transition: fill 0.15s; }
    .label .val { font: 8.5px var(--mono); fill: var(--text-faint); }
    .label.weak { fill: var(--accent); font-weight: 600; }
    .axis.on .label { fill: var(--accent-2); }
    .axis:focus-visible .label { text-decoration: underline; }
    .hover-card {
      position: absolute; z-index: 5; width: 250px; pointer-events: none;
      display: flex; flex-direction: column; gap: 5px; padding: 10px 12px;
      background: var(--bg-raised); border: 1px solid var(--line-strong); border-radius: var(--radius-sm);
      box-shadow: 0 10px 28px rgba(0, 0, 0, 0.45);
    }
    .hc-head { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
    .hc-title { font-weight: 600; }
    .hc-score { font-size: 12px; color: var(--accent-2); }
    .hc-score.under { color: var(--accent); }
    .hc-row { display: flex; justify-content: space-between; gap: 8px; font-size: 12.5px; }
    .hc-row.goal { color: var(--accent-2); }
    .hc-tip { display: flex; flex-direction: column; gap: 2px; margin-top: 3px; padding-top: 7px; border-top: 1px solid var(--line); line-height: 1.4; }
    .cap { text-transform: uppercase; letter-spacing: 0.08em; font-size: 10.5px; }
    .key { display: flex; justify-content: center; flex-wrap: wrap; gap: 4px 16px; }
    .key span { display: inline-flex; align-items: center; gap: 6px; }
    .sw { display: inline-block; width: 14px; height: 8px; border-radius: 3px; }
    .sw.you { background: var(--accent-soft); border: 1.5px solid var(--accent); }
    .sw.goal { border: 1.5px dashed var(--accent-2); }
    .hint { margin: 0; text-align: center; }
  `,
})
export class PlaystyleRadar {
  /** The games to chart, newest first (already narrowed to the chosen queue). */
  readonly matches = input.required<MatchLine[]>();
  /** Whose games these are, for the legend. */
  readonly who = input('You');
  /** Their Solo/Duo (or Flex) tier, e.g. "GOLD"; the goals default to it. Null for unranked. */
  readonly tier = input<string | null>(null);

  /** The rank picked to compare with ('' = their own rank). Kept across visits. */
  protected readonly chosen = signal(readLocal(RANK_KEY) ?? '');
  protected readonly ownTier = computed(() => this.tier()?.toLowerCase() ?? null);
  /** The rank filter in use: the picked one, else their own, else all ranks. */
  private readonly rankId = computed(() => this.chosen() || this.ownTier() || 'all');
  private readonly scale = computed(() => rankScale(this.rankId()));
  /** "Gold", "Gold+" or "All ranks", for the legend and hover card. */
  protected readonly rankLabel = computed(() => rankName(this.rankId()));
  /** "in Gold", or "across all ranks". */
  protected readonly goalWhere = computed(() => (this.rankId() === 'all' ? 'across all ranks' : `in ${this.rankLabel()}`));
  protected readonly autoLabel = computed(() => {
    const own = this.ownTier();
    return `${this.who() === 'You' ? 'Your' : 'Their'} rank${own ? ` (${rankName(own)})` : ''}`;
  });

  protected readonly hover = signal<number | null>(null);

  /** The targets for the role played in `m`, scaled to the rank. */
  private target(m: MatchLine): Targets {
    const t = TARGETS[roleOf(m)];
    const k = this.scale();
    return { gold: t.gold * k, damage: t.damage * k, kp: t.kp, kda: t.kda * k, deaths: t.deaths / k, vision: t.vision * k, objectives: t.objectives * k };
  }

  protected readonly viewW = VIEW_W;
  protected readonly viewH = VIEW_H;
  protected readonly cx = CX;
  protected readonly cy = CY;
  protected readonly edge = EDGE;
  protected readonly labelAt = LABEL_AT;
  protected readonly rings = [0.25, 0.5, 0.75, 1];

  /** Counted Summoner's Rift games (remakes left out). */
  private readonly rift = computed(() =>
    this.matches().filter((m) => m.result !== 'remake' && m.duration > 300 && !OFF_RIFT_QUEUES.has(m.queueId) && !OFF_RIFT_MODE.test(m.gameMode)),
  );
  protected readonly games = computed(() => this.rift().length);
  /** Every game picked is off the Rift (an ARAM or Arena tab). */
  protected readonly offRift = computed(() => this.rift().length === 0 && this.matches().some((m) => m.result !== 'remake'));

  protected readonly axes = computed<Axis[]>(() => {
    const games = this.rift();
    if (games.length < MIN_GAMES) return [];
    const per = (m: MatchLine, n: number) => n / Math.max(1, m.duration / 60);
    const capped = (x: number) => Math.min(GAME_CAP, Math.max(0, x));
    const minutes = games.reduce((a, m) => a + m.duration / 60, 0);
    /** The average target over `list`, for the hover card. */
    const goalOf = (list: MatchLine[], f: (t: Targets, m: MatchLine) => number) => avg(list.map((m) => f(this.target(m), m)));
    const out: Axis[] = [];
    for (const def of AXES) {
      let scores: number[] = [];
      let value = '';
      let goal = '';
      switch (def.key) {
        case 'gold':
          scores = games.map((m) => capped(per(m, m.gold) / this.target(m).gold));
          value = `${Math.round(games.reduce((a, m) => a + m.gold, 0) / minutes)}/min`;
          goal = `${Math.round(goalOf(games, (t) => t.gold))}/min`;
          break;
        case 'damage':
          scores = games.map((m) => capped(per(m, m.damage) / this.target(m).damage));
          value = `${Math.round(games.reduce((a, m) => a + m.damage, 0) / minutes)}/min`;
          goal = `${Math.round(goalOf(games, (t) => t.damage))}/min`;
          break;
        case 'fights': {
          const known = games.filter((m) => m.teamKills != null);
          scores = known.map((m) => capped(m.teamKills! > 0 ? (m.kills + m.assists) / m.teamKills! / this.target(m).kp : 1));
          const kills = known.reduce((a, m) => a + m.teamKills!, 0);
          value = kills > 0 ? `${Math.round((100 * known.reduce((a, m) => a + m.kills + m.assists, 0)) / kills)}% KP` : '';
          goal = `${Math.round(100 * goalOf(known, (t) => t.kp))}% KP`;
          break;
        }
        case 'kda': {
          // Over all the games together, since one deathless game has no ratio of its own.
          const k = games.reduce((a, m) => a + m.kills + m.assists, 0);
          const d = games.reduce((a, m) => a + m.deaths, 0);
          const ratio = k / Math.max(1, d);
          const want = goalOf(games, (t) => t.kda);
          scores = [capped(ratio / want)];
          value = ratio.toFixed(1);
          goal = want.toFixed(1);
          break;
        }
        case 'deaths':
          // Fewer is better: the target over what you did, with a floor so a deathless game isn't infinite.
          scores = games.map((m) => {
            const t = this.target(m).deaths;
            return capped(t / Math.max(per(m, m.deaths), t / GAME_CAP));
          });
          value = `${(games.reduce((a, m) => a + m.deaths, 0) / games.length).toFixed(1)}/game`;
          goal = `${goalOf(games, (t, m) => (t.deaths * m.duration) / 60).toFixed(1)} or fewer/game`;
          break;
        case 'vision': {
          // OP.GG has no vision score (it comes through as 0).
          const known = games.some((m) => m.vision > 0) ? games : [];
          scores = known.map((m) => capped(per(m, m.vision) / this.target(m).vision));
          value = known.length ? `${(known.reduce((a, m) => a + m.vision, 0) / minutes).toFixed(1)}/min` : '';
          goal = `${goalOf(known, (t) => t.vision).toFixed(1)}/min`;
          break;
        }
        case 'objectives': {
          const known = games.filter((m) => m.objectiveDamage != null);
          scores = known.map((m) => capped(per(m, m.objectiveDamage!) / this.target(m).objectives));
          const mins = known.reduce((a, m) => a + m.duration / 60, 0);
          value = mins > 0 ? `${Math.round(known.reduce((a, m) => a + m.objectiveDamage!, 0) / mins)}/min` : '';
          goal = `${Math.round(goalOf(known, (t) => t.objectives))}/min`;
          break;
        }
      }
      const enough = def.key === 'kda' ? scores.length > 0 : scores.length >= MIN_GAMES;
      if (!enough) continue;
      const score = avg(scores);
      out.push({ key: def.key, label: def.label, tip: score < 0.95 ? def.low : def.high, score, value, goal, games: scores.length });
    }
    return out;
  });

  /** The two lowest axes under target, worst first; drawn in pink. */
  protected readonly weak = computed(() =>
    [...this.axes()]
      .filter((a) => a.score < 0.95)
      .sort((a, b) => a.score - b.score)
      .slice(0, 2),
  );

  /** The hovered axis and where its card goes: beside the label, toward the middle of the chart. */
  protected readonly hovered = computed(() => {
    const i = this.hover();
    const axis = i === null ? undefined : this.axes()[i];
    if (i === null || !axis) return null;
    const p = this.at(i, LABEL_AT);
    const x = (100 * p.x) / VIEW_W;
    const y = (100 * p.y) / VIEW_H;
    const side = this.anchor(i);
    const horiz = side === 'middle' ? `left: ${x}%; transform: translateX(-50%);` : side === 'start' ? `right: ${100 - x}%;` : `left: ${x}%;`;
    const vert = p.y < CY ? `top: calc(${y}% + 18px);` : `bottom: calc(${100 - y}% + 18px);`;
    return { axis, style: horiz + vert };
  });

  protected readonly shape = computed(() =>
    this.axes()
      .map((a, i) => {
        const p = this.at(i, this.reach(a.score));
        return `${p.x},${p.y}`;
      })
      .join(' '),
  );

  protected readonly summary = computed(
    () => `Playstyle compared with role goals ${this.goalWhere()}: ` + this.axes().map((a) => `${a.label} ${this.pct(a.score)}%`).join(', '),
  );

  protected pickRank(id: string): void {
    this.chosen.set(id);
    writeLocal(RANK_KEY, id || null);
  }

  protected isWeak(key: AxisKey): boolean {
    return this.weak().some((a) => a.key === key);
  }

  /** How far out a score sits, 0 to 1 (the edge is `EDGE` times the target). */
  protected reach(score: number): number {
    return Math.max(0.04, Math.min(score, EDGE) / EDGE);
  }

  /** The point at `frac` of the radius along axis `i` (fractions fall between axes), first axis straight up. */
  protected at(i: number, frac: number): { x: number; y: number } {
    const n = this.axes().length;
    const ang = -Math.PI / 2 + (i * 2 * Math.PI) / n;
    return { x: +(CX + Math.cos(ang) * R * frac).toFixed(1), y: +(CY + Math.sin(ang) * R * frac).toFixed(1) };
  }

  /** The box around axis `i`'s name and value, the only part that opens its hover card. Text width is estimated. */
  protected labelBox(i: number, a: Axis): { x: number; y: number; w: number; h: number } {
    const p = this.at(i, LABEL_AT);
    const w = Math.max(a.label.length * 5.6, a.value.length * 5.3) + 8;
    const h = 26;
    const side = this.anchor(i);
    const x = side === 'middle' ? p.x - w / 2 : side === 'start' ? p.x - 4 : p.x - w + 4;
    return { x: +x.toFixed(1), y: +(p.y - 10).toFixed(1), w: +w.toFixed(1), h };
  }

  /** Axis `i`'s part of the outer ring: from the centre out to halfway along the ring's two edges beside it. */
  protected slice(i: number): string {
    const mid = (a: { x: number; y: number }, b: { x: number; y: number }) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
    const tip = this.at(i, 1);
    return [{ x: CX, y: CY }, mid(this.at(i - 1, 1), tip), tip, mid(tip, this.at(i + 1, 1))].map((p) => `${p.x},${p.y}`).join(' ');
  }

  protected ringPoints(frac: number): string {
    return this.axes()
      .map((_, i) => {
        const p = this.at(i, frac);
        return `${p.x},${p.y}`;
      })
      .join(' ');
  }

  protected anchor(i: number): 'start' | 'middle' | 'end' {
    const x = this.at(i, 1).x - CX;
    return Math.abs(x) < 8 ? 'middle' : x > 0 ? 'start' : 'end';
  }

  protected pct(score: number): number {
    return Math.round(score * 100);
  }
}
