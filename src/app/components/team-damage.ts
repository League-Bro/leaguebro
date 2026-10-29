import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { RiftService } from '../core/rift.service';
import { championSplit, damageTip, DamageSplit, teamSplit } from '../core/damage';
import { EnemyTrait, enemyTraits } from '../core/comp';
import { GoldGraph } from './gold-graph';

const TRAIT_TITLES: Record<EnemyTrait, (n: number) => string> = {
  tanks: (n) => `${n} tanks.`,
  dive: (n) => `${n} divers.`,
  poke: (n) => `${n} poke champions.`,
  squishy: () => 'No tank.',
};
/** What a trait means for your own team. */
const FOR_US: Record<EnemyTrait, string> = {
  tanks: 'You can take long fights and front line for your carries.',
  dive: 'Built to jump their backline: go in together.',
  poke: 'Wear them down before objectives instead of forcing fights.',
  squishy: 'Avoid long fights; pick your moments.',
};
/** How to play into an enemy trait. */
const VS_THEM: Record<EnemyTrait, string> = {
  tanks: 'Armor or magic pen and % health damage pay off.',
  dive: 'Stay near whoever can peel you; a defensive item helps.',
  poke: 'Engage or flank fast instead of sitting in their range.',
  squishy: 'Catching one of them out of position wins fights.',
};

/**
 * Your team vs the enemy team: a damage profile chart (AD / AP / true), what each
 * comp is built around (`comp.ts`) and, in game, a graph of the team gold lead
 * (item value) over time. Shown from champ select to the end of the game.
 */
@Component({
  selector: 'rl-team-damage',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DecimalPipe, GoldGraph],
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
          <!-- What each comp is built around, in the same style as the damage tips above. -->
          @for (c of comps(); track c.key + c.trait) {
            <div class="tip muted"><b [class.enemy]="c.key === 'enemy'">{{ c.label }}</b> <span class="trait" [class.enemy]="c.key === 'enemy'">{{ c.title }}</span> {{ c.text }}</div>
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
            <rl-gold-graph [points]="g.raw" label="Team gold lead over time" />
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

    .trait { font-weight: 600; color: var(--text); margin-right: 2px; }

    .now { font-size: 18px; }
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

  /** What each team is built around (2+ tanks, divers or poke, or no tank at all), one line per trait. */
  protected readonly comps = computed(() => {
    const m = this.champs();
    const traits = (ids: number[]) => enemyTraits(ids.flatMap((id) => (m.has(id) ? [m.get(id)!] : [])));
    return [
      ...traits(this.allies()).map((t) => ({ key: 'ally', label: 'Your team', trait: t.trait, title: TRAIT_TITLES[t.trait](t.count), text: FOR_US[t.trait] })),
      ...traits(this.enemies()).map((t) => ({ key: 'enemy', label: 'Enemy team', trait: t.trait, title: TRAIT_TITLES[t.trait](t.count), text: VS_THEM[t.trait] })),
    ];
  });

  protected readonly gold = computed(() => {
    const o = this.rift.overlay();
    if (!this.showGold() || !o?.team) return null;
    const lead = o.team.ours - o.team.theirs;
    const raw = this.rift.goldHistory().slice();
    if (!raw.length || raw.at(-1)!.t < o.gameTime) raw.push({ t: o.gameTime, lead });
    return { lead, ours: o.team.ours, theirs: o.team.theirs, lane: o.lane, raw };
  });

  protected segments(s: DamageSplit) {
    return [
      { key: 'ad', name: 'physical', value: s.ad },
      { key: 'ap', name: 'magic', value: s.ap },
      { key: 'tr', name: 'true', value: s.true },
    ].filter((x) => x.value > 0);
  }

  protected tip = damageTip;
  protected signed(n: number): string {
    return (n > 0 ? '+' : n < 0 ? '−' : '±') + Math.abs(n).toLocaleString('en-US');
  }
}
