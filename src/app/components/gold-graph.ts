import { ChangeDetectionStrategy, Component, computed, input, signal } from '@angular/core';
import { clock } from '../core/assets';
import { GoldPoint } from '../core/models';

let nextId = 0;

/**
 * A team gold lead over game time: above the dashed zero line is your team ahead,
 * below is behind. Hover for the lead at any point. Used on the Live tab (item
 * value, sampled while playing) and in match history (gold earned, per minute).
 * The two sides' colors come from `--gg-up` / `--gg-down` (default: ally / enemy).
 */
@Component({
  selector: 'rl-gold-graph',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (g(); as g) {
      <div class="graph">
        <div class="yaxis mono faint"><span>+{{ short(g.max) }}</span><span>0</span><span>−{{ short(g.max) }}</span></div>
        <div class="area" (mousemove)="hover($event)" (mouseleave)="hoverIdx.set(null)">
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" [attr.aria-label]="label()">
            <defs>
              <clipPath [id]="id + '-up'"><rect x="0" y="0" width="100" height="50" /></clipPath>
              <clipPath [id]="id + '-down'"><rect x="0" y="50" width="100" height="50" /></clipPath>
            </defs>
            <line class="mid" x1="0" y1="50" x2="100" y2="50" />
            <path class="fill up" [attr.d]="g.area" [attr.clip-path]="clip('up')" />
            <path class="fill down" [attr.d]="g.area" [attr.clip-path]="clip('down')" />
            <path class="line up" [attr.d]="g.line" [attr.clip-path]="clip('up')" />
            <path class="line down" [attr.d]="g.line" [attr.clip-path]="clip('down')" />
          </svg>
          <span class="side-tag ahead faint">Ahead</span>
          <span class="side-tag behind faint">Behind</span>
          <span class="dot" [class.down]="g.points.at(-1)!.lead < 0" [style.left.%]="g.points.at(-1)!.x" [style.top.%]="g.points.at(-1)!.y"></span>
          @if (hoverIdx() !== null && g.points[hoverIdx()!]; as p) {
            <span class="cross" [style.left.%]="p.x"></span>
            <span class="dot" [class.down]="p.lead < 0" [style.left.%]="p.x" [style.top.%]="p.y"></span>
            <span class="tt" [style.left.%]="p.x" [class.flip]="p.x > 70">
              <span class="faint mono">{{ time(p.t) }}</span>
              <b class="mono">{{ signed(p.lead) }}</b>
            </span>
          }
        </div>
        <div></div>
        <div class="xaxis mono faint"><span>0:00</span><span>{{ time(g.end / 2) }}</span><span>{{ time(g.end) }}</span></div>
      </div>
    }
  `,
  styles: `
    :host { display: block; --gg-up-c: var(--gg-up, var(--ally)); --gg-down-c: var(--gg-down, var(--enemy)); }
    .graph { display: grid; grid-template-columns: 40px 1fr; column-gap: 8px; row-gap: 4px; }
    .yaxis { display: flex; flex-direction: column; justify-content: space-between; align-items: flex-end; font-size: 11px; height: 120px; }
    .area { position: relative; height: 120px; cursor: crosshair; border-left: 1px solid var(--line); border-bottom: 1px solid var(--line); }
    svg { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; }
    .mid { stroke: var(--line-strong); stroke-width: 1; stroke-dasharray: 3 3; vector-effect: non-scaling-stroke; }
    .fill { opacity: 0.16; }
    .fill.up { fill: var(--gg-up-c); }
    .fill.down { fill: var(--gg-down-c); }
    .line { fill: none; stroke-width: 2; stroke-linejoin: round; vector-effect: non-scaling-stroke; }
    .line.up { stroke: var(--gg-up-c); }
    .line.down { stroke: var(--gg-down-c); }
    .side-tag { position: absolute; right: 6px; font-size: 11px; pointer-events: none; }
    .ahead { top: 4px; }
    .behind { bottom: 4px; }
    .dot { position: absolute; width: 9px; height: 9px; margin: -4.5px 0 0 -4.5px; border-radius: 50%; background: var(--gg-up-c); box-shadow: 0 0 0 2px var(--bg-raised); pointer-events: none; }
    .dot.down { background: var(--gg-down-c); }
    .cross { position: absolute; top: 0; bottom: 0; width: 1px; background: var(--line-strong); pointer-events: none; }
    .tt { position: absolute; top: -6px; transform: translate(8px, -100%); display: flex; gap: 8px; padding: 4px 8px; border-radius: 8px; background: var(--bg-sunken); border: 1px solid var(--line-strong); font-size: 12px; white-space: nowrap; pointer-events: none; z-index: 1; }
    .tt.flip { transform: translate(calc(-100% - 8px), -100%); }
    .xaxis { display: flex; justify-content: space-between; font-size: 11px; }
  `,
})
export class GoldGraph {
  /** Lead by game time (seconds), oldest first. */
  readonly points = input.required<GoldPoint[]>();
  readonly label = input('Team gold lead over time');
  protected readonly hoverIdx = signal<number | null>(null);
  /** Each graph needs its own clip path ids. */
  protected readonly id = `gold-graph-${nextId++}`;

  protected readonly g = computed(() => {
    const raw = this.points().slice();
    if (!raw.length) return null;
    if (raw.length === 1) raw.unshift({ t: 0, lead: 0 });
    const end = Math.max(raw.at(-1)!.t, 60);
    const max = niceMax(Math.max(...raw.map((p) => Math.abs(p.lead))));
    const points = raw.map((p) => ({ ...p, x: (p.t / end) * 100, y: 50 - (p.lead / max) * 50 }));
    const line = points.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(' ');
    const area = `${line} L${points.at(-1)!.x.toFixed(2)} 50 L${points[0].x.toFixed(2)} 50 Z`;
    return { end, max, points, line, area };
  });

  protected clip(side: 'up' | 'down'): string {
    return `url(#${this.id}-${side})`;
  }

  protected hover(e: MouseEvent): void {
    const g = this.g();
    const el = e.currentTarget as HTMLElement;
    if (!g) return;
    const x = ((e.clientX - el.getBoundingClientRect().left) / el.clientWidth) * 100;
    let best = 0;
    g.points.forEach((p, i) => {
      if (Math.abs(p.x - x) < Math.abs(g.points[best].x - x)) best = i;
    });
    this.hoverIdx.set(best);
  }

  protected time = clock;
  protected signed(n: number): string {
    return (n > 0 ? '+' : n < 0 ? '−' : '±') + Math.abs(n).toLocaleString('en-US');
  }
  protected short(n: number): string {
    return n >= 1000 ? `${+(n / 1000).toFixed(1)}k` : `${n}`;
  }
}

/** A round top for the gold axis, at least 500. */
function niceMax(v: number): number {
  for (const step of [500, 1000, 2000, 2500, 5000, 7500, 10000, 15000, 20000]) if (v <= step) return step;
  return Math.ceil(v / 10000) * 10000;
}
