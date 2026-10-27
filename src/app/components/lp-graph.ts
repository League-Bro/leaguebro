import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { formatTier, tierClass } from '../core/assets';
import { LpPoint } from '../core/models';

const TIERS = ['IRON', 'BRONZE', 'SILVER', 'GOLD', 'PLATINUM', 'EMERALD', 'DIAMOND'];
const DIVISIONS = ['IV', 'III', 'II', 'I'];
/** Points shown; older ones scroll off the left. */
const SHOWN = 20;
const W = 220;
const H = 52;
const PAD = 6;

/** One number per rank, so ranks can be drawn on one axis: 100 per division, Master and up stacked on top of Diamond I. */
function score(p: LpPoint): number {
  const t = TIERS.indexOf(p.tier.toUpperCase());
  if (t < 0) return TIERS.length * 400 + p.lp;
  return t * 400 + Math.max(0, DIVISIONS.indexOf(p.division)) * 100 + p.lp;
}

/** A small LP-over-time line for the Profile header: dots colored by tier, newest on the right. Needs 2+ points. */
@Component({
  selector: 'rl-lp-graph',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (dots().length > 1) {
      <svg [attr.viewBox]="'0 0 ' + w + ' ' + h" [attr.width]="w" [attr.height]="h" role="img" [attr.aria-label]="summary()">
        <line class="now" [attr.x1]="last().x" [attr.x2]="last().x" y1="0" [attr.y2]="h" />
        <polyline [attr.points]="line()" />
        @for (d of dots(); track $index) {
          <circle [class]="d.cls" [attr.cx]="d.x" [attr.cy]="d.y" [attr.r]="$last ? 4.2 : 3"><title>{{ d.label }}</title></circle>
        }
      </svg>
      <div class="cap mono" [class.win]="net() > 0" [class.loss]="net() < 0">
        {{ net() > 0 ? '+' : '' }}{{ net() }} LP <span class="faint">since {{ since() }}</span>
      </div>
    }
  `,
  styles: `
    :host { display: flex; flex-direction: column; gap: 1px; }
    svg { display: block; overflow: visible; }
    polyline { fill: none; stroke: var(--text-faint); stroke-width: 1.5; stroke-linejoin: round; opacity: 0.7; }
    circle { fill: currentColor; stroke: var(--bg-raised); stroke-width: 1; }
    .now { stroke: var(--text-faint); stroke-width: 1; stroke-dasharray: 2 3; opacity: 0.6; }
    .cap { font-size: 11px; }
  `,
})
export class LpGraph {
  readonly points = input.required<LpPoint[]>();
  protected readonly w = W;
  protected readonly h = H;

  private readonly shown = computed(() => this.points().slice(-SHOWN));
  protected readonly dots = computed(() => {
    const pts = this.shown();
    const scores = pts.map(score);
    const lo = Math.min(...scores);
    const span = Math.max(...scores) - lo;
    const step = (W - 2 * PAD) / Math.max(1, pts.length - 1);
    return pts.map((p, i) => ({
      x: PAD + i * step,
      // A flat line sits in the middle.
      y: span ? H - PAD - ((scores[i] - lo) / span) * (H - 2 * PAD) : H / 2,
      cls: tierClass(p.tier),
      label: `${formatTier(p.tier, p.division)} ${p.lp} LP · ${new Date(p.at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`,
    }));
  });
  protected readonly last = computed(() => this.dots().at(-1)!);
  protected readonly line = computed(() => this.dots().map((d) => `${d.x},${d.y}`).join(' '));
  protected readonly net = computed(() => {
    const pts = this.shown();
    return pts.length > 1 ? score(pts.at(-1)!) - score(pts[0]) : 0;
  });
  protected readonly since = computed(() => new Date(this.shown()[0]?.at ?? 0).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }));
  protected readonly summary = computed(() => `LP graph: ${this.net() >= 0 ? 'up' : 'down'} ${Math.abs(this.net())} LP since ${this.since()}`);
}
