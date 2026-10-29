import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { formatTier, tierClass } from '../core/assets';
import { LpPoint, RankLine } from '../core/models';

const TIERS = ['IRON', 'BRONZE', 'SILVER', 'GOLD', 'PLATINUM', 'EMERALD', 'DIAMOND'];
const DIVISIONS = ['IV', 'III', 'II', 'I'];
/** Score where Master starts (Master and up share one LP count). */
const APEX = TIERS.length * 400;
/** Points shown; older ones scroll off the left. */
const SHOWN = 24;
const W = 240;
const H = 60;
const PAD_X = 6;
/** Room on the left for the division labels. */
const GUTTER = 18;
/** Closer division lines than this (px) only label where a tier starts. */
const LABEL_GAP = 11;
const PAD_Y = 7;
/** The widest gap between two points, so a few games don't stretch across the whole graph. */
const MAX_STEP = 34;
/** The least LP the height stands for, so a +5 doesn't look like a climb. */
const MIN_SPAN = 100;
/** Up to this many points, each one gets a dot. */
const DOTS_UP_TO = 12;

/** One number per rank, so ranks can be drawn on one axis: 100 per division, Master and up stacked on top of Diamond I. */
function score(p: { tier: string; division: string; lp: number }): number {
  const t = TIERS.indexOf(p.tier.toUpperCase());
  if (t < 0) return APEX + p.lp;
  return t * 400 + Math.max(0, DIVISIONS.indexOf(p.division)) * 100 + p.lp;
}

/** The division that starts at a multiple of 100: "G2", or "M" for Master. */
function divisionAt(s: number): { short: string; cls: string } {
  if (s >= APEX) return { short: 'M', cls: 'tier-master' };
  const tier = TIERS[Math.floor(s / 400)];
  return { short: tier[0] + (4 - Math.floor((s % 400) / 100)), cls: tierClass(tier) };
}

function day(at: number): string {
  return new Date(at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** A smooth line through the points that never overshoots them (monotone cubic), as an SVG path. */
function smooth(pts: { x: number; y: number }[]): string {
  const n = pts.length;
  if (n < 3) return pts.map((p, i) => `${i ? 'L' : 'M'}${p.x},${p.y}`).join(' ');
  const slope = pts.slice(1).map((p, i) => (p.y - pts[i].y) / (p.x - pts[i].x));
  const tan = pts.map((_, i) => {
    if (i === 0) return slope[0];
    if (i === n - 1) return slope[n - 2];
    const [a, b] = [slope[i - 1], slope[i]];
    return a * b <= 0 ? 0 : (2 * a * b) / (a + b);
  });
  let d = `M${pts[0].x},${pts[0].y}`;
  for (let i = 0; i < n - 1; i++) {
    const [p, q] = [pts[i], pts[i + 1]];
    const dx = (q.x - p.x) / 3;
    d += ` C${p.x + dx},${p.y + tan[i] * dx} ${q.x - dx},${q.y - tan[i + 1] * dx} ${q.x},${q.y}`;
  }
  return d;
}

/**
 * LP over time for the Profile header. The height always covers at least one
 * division, with faint lines where divisions start, so a couple of games look
 * like a couple of games; with only a few points the line grows in from the
 * right rather than stretching across. Promotions and demotions get a ring.
 * With fewer than two saved ranks it shows how far into the division you are.
 */
@Component({
  selector: 'rl-lp-graph',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (dots().length > 1) {
      <svg [attr.viewBox]="'0 0 ' + w + ' ' + h" [attr.width]="w" [attr.height]="h" role="img" [attr.aria-label]="summary()" [class]="trend()">
        <defs>
          <linearGradient [attr.id]="gid" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" class="fill-top" />
            <stop offset="1" class="fill-bottom" />
          </linearGradient>
        </defs>
        @for (g of grid(); track g.y) {
          <line class="grid" [class]="g.cls" [class.tier-start]="g.tierStart" [attr.x1]="gutter" [attr.x2]="w" [attr.y1]="g.y" [attr.y2]="g.y" />
          @if (g.labeled) {
            <text class="div-label" [class]="g.cls" x="0" [attr.y]="g.y + 3">{{ g.short }}</text>
          }
        }
        <line class="start" [attr.x1]="gutter" [attr.x2]="dots()[0].x" [attr.y1]="dots()[0].y" [attr.y2]="dots()[0].y" />
        <path class="area" [attr.d]="area()" [attr.fill]="'url(#' + gid + ')'" />
        <path class="curve" [attr.d]="curve()" />
        @for (d of dots(); track $index) {
          @if (d.moved) {
            <circle class="moved" [class]="d.cls" [attr.cx]="d.x" [attr.cy]="d.y" r="5.5" />
          }
          @if ((showDots() || d.moved) && !$last) {
            <circle class="dot" [class]="d.cls" [attr.cx]="d.x" [attr.cy]="d.y" r="2.4" />
          }
        }
        <circle class="pulse" [class]="last().cls" [attr.cx]="last().x" [attr.cy]="last().y" r="4" />
        <circle class="dot now" [class]="last().cls" [attr.cx]="last().x" [attr.cy]="last().y" r="4" />
        @for (d of dots(); track $index) {
          <circle class="hit" [attr.cx]="d.x" [attr.cy]="d.y" r="7"><title>{{ d.label }}</title></circle>
        }
      </svg>
      <div class="cap mono">
        <b [class.win]="net() > 0" [class.loss]="net() < 0">{{ net() > 0 ? '+' : net() < 0 ? '−' : '±' }}{{ abs(net()) }} LP</b>
        <span class="faint">{{ span() }}</span>
      </div>
    } @else if (meter(); as m) {
      <div class="meter" role="img" [attr.aria-label]="m.label">
        @for (s of m.segments; track $index) {
          <span class="seg"><span class="fill" [class]="m.cls" [style.width.%]="s"></span></span>
        }
      </div>
      <div class="cap mono">
        <b [class]="m.cls">{{ m.label }}</b>
        <span class="faint">LP graph starts next game</span>
      </div>
    }
  `,
  styles: `
    :host { display: flex; flex-direction: column; gap: 3px; width: ${W}px; }
    svg { display: block; overflow: visible; }
    .grid { stroke: currentColor; stroke-width: 1; opacity: 0.14; stroke-dasharray: 1 3; }
    .grid.tier-start { opacity: 0.35; stroke-dasharray: none; }
    .div-label { fill: currentColor; font-size: 8px; font-weight: 600; opacity: 0.7; font-family: var(--mono, monospace); }
    .start { stroke: var(--text-faint); stroke-width: 1; stroke-dasharray: 2 3; opacity: 0.6; }
    .curve { fill: none; stroke-width: 2; stroke-linejoin: round; stroke-linecap: round; }
    svg.up .curve { stroke: var(--win); }
    svg.down .curve { stroke: var(--loss); }
    svg.flat .curve { stroke: var(--text-dim); }
    .fill-top { stop-opacity: 0.32; }
    .fill-bottom { stop-opacity: 0; }
    svg.up stop { stop-color: var(--win); }
    svg.down stop { stop-color: var(--loss); }
    svg.flat stop { stop-color: var(--text-dim); }
    .dot { fill: currentColor; stroke: var(--bg-raised); stroke-width: 1.2; }
    .moved { fill: none; stroke: currentColor; stroke-width: 1.3; }
    .pulse { fill: currentColor; opacity: 0; transform-box: fill-box; transform-origin: center; animation: pulse 2.4s ease-out infinite; }
    @keyframes pulse { 0% { opacity: 0.55; transform: scale(1); } 100% { opacity: 0; transform: scale(2.8); } }
    @media (prefers-reduced-motion: reduce) { .pulse { animation: none; } }
    .hit { fill: transparent; cursor: help; }
    .cap { font-size: 11px; display: flex; gap: 0 6px; align-items: baseline; flex-wrap: wrap; }
    .cap > * { white-space: nowrap; }
    .cap b { font-weight: 600; }
    .meter { display: flex; gap: 3px; height: 8px; }
    .seg { flex: 1; border-radius: 3px; background: var(--bg-sunken); border: 1px solid var(--line); overflow: hidden; }
    .fill { display: block; height: 100%; background: currentColor; }
  `,
})
export class LpGraph {
  readonly points = input.required<LpPoint[]>();
  /** The current rank, for the division meter shown before there are two points. */
  readonly rank = input<RankLine | null>(null);
  protected readonly w = W;
  protected readonly h = H;
  protected readonly gutter = GUTTER;
  /** Gradient ids are page-wide, and Solo/Duo and Flex can both be on the page. */
  protected readonly gid = `lp-fill-${Math.random().toString(36).slice(2, 8)}`;
  protected readonly abs = Math.abs;

  private readonly shown = computed(() => this.points().slice(-SHOWN));
  private readonly scores = computed(() => this.shown().map(score));
  /** The LP range drawn: the points' range, at least `MIN_SPAN`, centered on them, with a little room. */
  private readonly range = computed(() => {
    const s = this.scores();
    let [lo, hi] = [Math.min(...s), Math.max(...s)];
    if (hi - lo < MIN_SPAN) {
      const mid = (hi + lo) / 2;
      [lo, hi] = [mid - MIN_SPAN / 2, mid + MIN_SPAN / 2];
    }
    const room = (hi - lo) * 0.1;
    return { lo: lo - room, hi: hi + room };
  });
  private y(s: number): number {
    const { lo, hi } = this.range();
    return H - PAD_Y - ((s - lo) / (hi - lo)) * (H - 2 * PAD_Y);
  }

  protected readonly dots = computed(() => {
    const pts = this.shown();
    const scores = this.scores();
    const step = Math.min(MAX_STEP, (W - GUTTER - PAD_X) / Math.max(1, pts.length - 1));
    const x0 = W - PAD_X - step * (pts.length - 1);
    return pts.map((p, i) => {
      const prev = pts[i - 1];
      const moved = !!prev && (prev.tier !== p.tier || prev.division !== p.division);
      const change = prev ? scores[i] - scores[i - 1] : 0;
      const delta = prev && change ? ` (${change > 0 ? '+' : '−'}${Math.abs(change)})` : '';
      return {
        x: x0 + i * step,
        y: this.y(scores[i]),
        cls: tierClass(p.tier),
        moved,
        label: `${formatTier(p.tier, p.division)} ${p.lp} LP${delta} · ${day(p.at)}`,
      };
    });
  });
  protected readonly last = computed(() => this.dots().at(-1)!);
  protected readonly showDots = computed(() => this.dots().length <= DOTS_UP_TO);
  protected readonly curve = computed(() => smooth(this.dots()));
  protected readonly area = computed(() => {
    const d = this.dots();
    return `${this.curve()} L${d.at(-1)!.x},${H} L${d[0].x},${H} Z`;
  });
  /**
   * A line where each division starts, inside the drawn range (Master and up
   * have none above Master's start). When the lines are close together, only
   * the ones where a tier starts get a label.
   */
  protected readonly grid = computed(() => {
    const { lo, hi } = this.range();
    const gap = this.y(0) - this.y(100);
    const out: { y: number; short: string; cls: string; tierStart: boolean; labeled: boolean }[] = [];
    for (let s = Math.ceil(lo / 100) * 100; s <= Math.min(hi, APEX); s += 100) {
      const tierStart = s % 400 === 0;
      if (s > 0) out.push({ y: this.y(s), ...divisionAt(s), tierStart, labeled: gap >= LABEL_GAP || tierStart });
    }
    return out;
  });

  protected readonly net = computed(() => {
    const s = this.scores();
    return s.length > 1 ? s.at(-1)! - s[0] : 0;
  });
  protected readonly trend = computed(() => (this.net() > 0 ? 'up' : this.net() < 0 ? 'down' : 'flat'));
  /** "over 6 games · since Oct 12", the games from the saved win + loss counts when there are any. */
  protected readonly span = computed(() => {
    const pts = this.shown();
    const [a, b] = [pts[0], pts.at(-1)!];
    const games = a.games != null && b.games != null ? b.games - a.games : null;
    const over = games && games > 0 ? `over ${games} ${games === 1 ? 'game' : 'games'} · ` : '';
    return `${over}since ${day(a.at)}`;
  });
  protected readonly summary = computed(() => `LP graph: ${this.net() >= 0 ? 'up' : 'down'} ${Math.abs(this.net())} LP, ${this.span()}`);

  /** Four bars for the divisions of your tier, filled up to your LP (Master and up: one bar per 100 LP, up to 4). */
  protected readonly meter = computed(() => {
    const r = this.rank() ?? this.points().at(-1);
    if (!r) return null;
    const label = `${formatTier(r.tier, r.division)} ${r.lp} LP`;
    const cls = tierClass(r.tier);
    const reached = TIERS.includes(r.tier.toUpperCase()) ? Math.max(0, DIVISIONS.indexOf(r.division)) * 100 + r.lp : Math.min(r.lp, 400);
    const segments = [0, 1, 2, 3].map((i) => Math.max(0, Math.min(100, reached - i * 100)));
    return { label, cls, segments };
  });
}
