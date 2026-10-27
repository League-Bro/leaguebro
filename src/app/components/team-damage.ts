import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { RiftService } from '../core/rift.service';
import { championSplit, damageTip, DamageSplit, teamSplit } from '../core/damage';
import { clock } from '../core/assets';

/**
 * Your team vs the enemy team: a damage profile chart (AD / AP / true) and, in game,
 * a graph of the team gold lead (item value) over time.
 */
@Component({
  selector: 'rl-team-damage',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DecimalPipe],
  template: `
    @if (ours() || theirs()) {
      <section class="card tvt" [class.two]="!!gold()">
        <figure class="chart">
          <figcaption class="row">
            <span class="title">Damage profile</span>
            <div class="spacer"></div>
            <span class="legend">
              <span><i class="sw ad"></i>AD</span>
              <span><i class="sw ap"></i>AP</span>
              <span><i class="sw tr"></i>True</span>
            </span>
          </figcaption>
          <div class="plot">
            @for (t of sides(); track t.key) {
              <div class="who" [class.enemy]="t.key === 'enemy'">
                {{ t.label }}
                @if (t.split && t.split.counted < 5) { <span class="faint">{{ t.split.counted }}/5</span> }
              </div>
              <div class="track">
                <i class="gl" style="left: 25%"></i><i class="gl" style="left: 50%"></i><i class="gl" style="left: 75%"></i>
                @if (t.split; as s) {
                  @for (seg of segments(s); track seg.key) {
                    <span [class]="'part ' + seg.key" [class.first]="$first" [class.last]="$last" [style.width.%]="seg.value" [title]="t.label + ': ' + seg.value + '% ' + seg.name">
                      @if (seg.value >= 14) { <b class="mono">{{ seg.value }}%</b> }
                    </span>
                  }
                } @else {
                  <span class="none faint">No picks yet</span>
                }
              </div>
            }
            <div></div>
            <div class="axis mono faint"><span>0</span><span>25</span><span>50</span><span>75</span><span>100%</span></div>
          </div>
          @for (t of sides(); track t.key) {
            @if (t.split && tip(t.split, t.key === 'enemy'); as tip) {
              <div class="tip muted"><b [class.enemy]="t.key === 'enemy'">{{ t.label }}</b> {{ tip }}</div>
            }
          }
        </figure>

        @if (gold(); as g) {
          <figure class="chart">
            <figcaption class="row">
              <span class="title">Gold lead</span>
              <span class="faint">item value</span>
              <div class="spacer"></div>
              <b class="mono now" [class.win]="g.lead > 0" [class.loss]="g.lead < 0">{{ signed(g.lead) }}</b>
            </figcaption>
            <div class="graph">
              <div class="yaxis mono faint"><span>+{{ short(g.max) }}</span><span>0</span><span>−{{ short(g.max) }}</span></div>
              <div class="area" (mousemove)="hover($event, g.points.length)" (mouseleave)="hoverIdx.set(null)">
                <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-label="Team gold lead over time">
                  <defs>
                    <clipPath id="tvt-up"><rect x="0" y="0" width="100" height="50" /></clipPath>
                    <clipPath id="tvt-down"><rect x="0" y="50" width="100" height="50" /></clipPath>
                  </defs>
                  <line class="mid" x1="0" y1="50" x2="100" y2="50" />
                  <path class="fill up" [attr.d]="g.area" clip-path="url(#tvt-up)" />
                  <path class="fill down" [attr.d]="g.area" clip-path="url(#tvt-down)" />
                  <path class="line up" [attr.d]="g.line" clip-path="url(#tvt-up)" />
                  <path class="line down" [attr.d]="g.line" clip-path="url(#tvt-down)" />
                </svg>
                <span class="side-tag ahead faint">Ahead</span>
                <span class="side-tag behind faint">Behind</span>
                <span class="dot" [class.down]="g.lead < 0" [style.left.%]="g.points.at(-1)!.x" [style.top.%]="g.points.at(-1)!.y"></span>
                @if (hoverIdx() !== null && g.points[hoverIdx()!]; as p) {
                  <span class="cross" [style.left.%]="p.x"></span>
                  <span class="dot hov" [class.down]="p.lead < 0" [style.left.%]="p.x" [style.top.%]="p.y"></span>
                  <span class="tt" [style.left.%]="p.x" [class.flip]="p.x > 70">
                    <span class="faint mono">{{ time(p.t) }}</span>
                    <b class="mono">{{ signed(p.lead) }}</b>
                  </span>
                }
              </div>
              <div></div>
              <div class="xaxis mono faint"><span>0:00</span><span>{{ time(g.end / 2) }}</span><span>{{ time(g.end) }}</span></div>
            </div>
            <div class="stats row">
              <span class="stat"><span class="faint">Team</span><span class="mono">{{ g.ours | number }}</span><span class="faint">vs</span><span class="mono">{{ g.theirs | number }}</span></span>
              @if (g.lane; as ln) {
                <span class="stat">
                  <span class="faint">You vs {{ ln.opponent }}</span>
                  <b class="mono" [class.win]="ln.mine > ln.theirs" [class.loss]="ln.mine < ln.theirs">{{ signed(ln.mine - ln.theirs) }}</b>
                </span>
              }
            </div>
          </figure>
        }
      </section>
    }
  `,
  styles: `
    .tvt { display: grid; grid-template-columns: 1fr; gap: 28px; padding: 18px 22px; margin-top: 8px; }
    .tvt.two { grid-template-columns: 1.1fr 1fr; }
    @media (max-width: 860px) { .tvt.two { grid-template-columns: 1fr; } }
    .chart { margin: 0; min-width: 0; }
    figcaption { align-items: baseline; gap: 8px; margin-bottom: 12px; }
    .title { font-weight: 600; font-size: 13px; letter-spacing: 0.04em; text-transform: uppercase; color: var(--text-dim); }
    .legend { display: flex; gap: 12px; font-size: 12px; color: var(--text-dim); }
    .legend span { display: flex; align-items: center; gap: 5px; }
    .sw { width: 10px; height: 10px; border-radius: 3px; display: inline-block; }
    .ad { --c: #f26b3a; }
    .ap { --c: #8f7dff; }
    .tr { --c: #d8d2e6; }
    .sw { background: var(--c); }

    .plot { display: grid; grid-template-columns: 92px 1fr; column-gap: 12px; row-gap: 10px; align-items: center; }
    .who { font-size: 13px; font-weight: 600; color: var(--ally); white-space: nowrap; }
    .who.enemy { color: var(--enemy); }
    .who .faint { font-weight: 400; margin-left: 4px; }
    .track { position: relative; display: flex; gap: 2px; height: 26px; }
    .gl { position: absolute; top: -4px; bottom: -4px; width: 1px; background: var(--line); pointer-events: none; }
    .part { position: relative; display: flex; align-items: center; padding: 0 8px; min-width: 3px; background: var(--c); transition: width 0.4s ease; }
    .part.first { border-top-left-radius: 4px; border-bottom-left-radius: 4px; }
    .part.last { border-top-right-radius: 4px; border-bottom-right-radius: 4px; }
    .part b { font-size: 12px; color: #17131d; }
    .none { align-self: center; font-size: 12px; }
    .axis { display: flex; justify-content: space-between; font-size: 11px; margin-top: -2px; }
    .tip { font-size: 12px; margin-top: 10px; }
    .tip b { color: var(--ally); font-weight: 600; margin-right: 4px; }
    .tip b.enemy { color: var(--enemy); }

    .now { font-size: 18px; }
    .graph { display: grid; grid-template-columns: 40px 1fr; column-gap: 8px; row-gap: 4px; }
    .yaxis { display: flex; flex-direction: column; justify-content: space-between; align-items: flex-end; font-size: 11px; height: 120px; }
    .area { position: relative; height: 120px; cursor: crosshair; border-left: 1px solid var(--line); border-bottom: 1px solid var(--line); }
    svg { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; }
    .mid { stroke: var(--line-strong); stroke-width: 1; stroke-dasharray: 3 3; vector-effect: non-scaling-stroke; }
    .fill.up { fill: rgba(78, 164, 255, 0.16); }
    .fill.down { fill: rgba(255, 90, 78, 0.16); }
    .line { fill: none; stroke-width: 2; stroke-linejoin: round; vector-effect: non-scaling-stroke; }
    .line.up { stroke: var(--ally); }
    .line.down { stroke: var(--enemy); }
    .side-tag { position: absolute; right: 6px; font-size: 11px; pointer-events: none; }
    .ahead { top: 4px; }
    .behind { bottom: 4px; }
    .dot { position: absolute; width: 9px; height: 9px; margin: -4.5px 0 0 -4.5px; border-radius: 50%; background: var(--ally); box-shadow: 0 0 0 2px var(--bg-raised); pointer-events: none; }
    .dot.down { background: var(--enemy); }
    .cross { position: absolute; top: 0; bottom: 0; width: 1px; background: var(--line-strong); pointer-events: none; }
    .tt { position: absolute; top: -6px; transform: translate(8px, -100%); display: flex; gap: 8px; padding: 4px 8px; border-radius: 8px; background: var(--bg-sunken); border: 1px solid var(--line-strong); font-size: 12px; white-space: nowrap; pointer-events: none; }
    .tt.flip { transform: translate(calc(-100% - 8px), -100%); }
    .xaxis { display: flex; justify-content: space-between; font-size: 11px; }
    .stat { display: inline-flex; gap: 5px; align-items: baseline; }
    .stats { gap: 18px; flex-wrap: wrap; font-size: 13px; margin-top: 10px; }
  `,
})
export class TeamDamage {
  private readonly rift = inject(RiftService);
  /** Champion ids, 0 for "not picked yet". */
  readonly allies = input.required<number[]>();
  readonly enemies = input.required<number[]>();
  /** Show the gold graph (in game only). */
  readonly showGold = input(false);
  protected readonly hoverIdx = signal<number | null>(null);

  private readonly champs = computed(() => new Map((this.rift.statics()?.champions ?? []).map((c) => [c.id, c])));
  private split(ids: number[]): DamageSplit | null {
    const m = this.champs();
    return teamSplit(ids.flatMap((id) => {
      const c = m.get(id);
      return c ? [championSplit(c.alias, c.roles)] : [];
    }));
  }
  protected readonly ours = computed(() => this.split(this.allies()));
  protected readonly theirs = computed(() => this.split(this.enemies()));
  protected readonly sides = computed(() => [
    { key: 'ally', label: 'Your team', split: this.ours() },
    { key: 'enemy', label: 'Enemy team', split: this.theirs() },
  ]);

  protected readonly gold = computed(() => {
    const o = this.rift.overlay();
    if (!this.showGold() || !o?.team) return null;
    const lead = o.team.ours - o.team.theirs;
    const raw = this.rift.goldHistory().slice();
    if (!raw.length || raw.at(-1)!.t < o.gameTime) raw.push({ t: o.gameTime, lead });
    if (raw.length === 1) raw.unshift({ t: 0, lead: 0 });
    const end = Math.max(raw.at(-1)!.t, 60);
    const max = niceMax(Math.max(...raw.map((p) => Math.abs(p.lead))));
    const points = raw.map((p) => ({ ...p, x: (p.t / end) * 100, y: 50 - (p.lead / max) * 50 }));
    const line = points.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(' ');
    const area = `${line} L${points.at(-1)!.x.toFixed(2)} 50 L${points[0].x.toFixed(2)} 50 Z`;
    return { lead, ours: o.team.ours, theirs: o.team.theirs, lane: o.lane, end, max, points, line, area };
  });

  protected segments(s: DamageSplit) {
    return [
      { key: 'ad', name: 'physical', value: s.ad },
      { key: 'ap', name: 'magic', value: s.ap },
      { key: 'tr', name: 'true', value: s.true },
    ].filter((x) => x.value > 0);
  }

  protected hover(e: MouseEvent, count: number): void {
    const g = this.gold();
    const el = e.currentTarget as HTMLElement;
    if (!g || !count) return;
    const x = ((e.clientX - el.getBoundingClientRect().left) / el.clientWidth) * 100;
    let best = 0;
    g.points.forEach((p, i) => {
      if (Math.abs(p.x - x) < Math.abs(g.points[best].x - x)) best = i;
    });
    this.hoverIdx.set(best);
  }

  protected tip = damageTip;
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
