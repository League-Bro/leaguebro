import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { RiftService } from '../core/rift.service';
import { signed } from '../core/format';
import { damageTip, teamSplit } from '../core/damage';
import { TRAIT_FOR_US, TRAIT_TITLES, TRAIT_VS_THEM, enemyTraits } from '../core/comp';
import { DamageBar, DamageLegend } from './damage-bar';
import { GoldGraph } from './gold-graph';

/**
 * Your team vs the enemy team: a damage profile chart (AD / AP / true), what each
 * comp is built around (`comp.ts`) and, in game, a graph of the team gold lead
 * (item value) over time. Shown from champ select to the end of the game.
 */
@Component({
  selector: 'rl-team-damage',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DecimalPipe, DamageBar, DamageLegend, GoldGraph],
  template: `
    @if (ours() || theirs()) {
      <section class="card tvt" [class.two]="!!gold()">
        <figure class="chart">
          <figcaption class="row">
            <span class="title">Damage profile</span>
            <div class="spacer"></div>
            <rl-damage-legend />
          </figcaption>
          <div class="plot">
            @for (t of sides(); track t.key) {
              <div class="who" [class.enemy]="t.key === 'enemy'">
                {{ t.label }}
                @if (t.split && t.split.counted < 5) { <span class="faint">{{ t.split.counted }}/5</span> }
              </div>
              <rl-damage-bar [split]="t.split" [label]="t.label" [grid]="true" />
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

    .plot { display: grid; grid-template-columns: 92px 1fr; column-gap: 12px; row-gap: 10px; align-items: center; }
    .who { font-size: 13px; font-weight: 600; color: var(--ally); white-space: nowrap; }
    .who.enemy { color: var(--enemy); }
    .who .faint { font-weight: 400; margin-left: 4px; }
    rl-damage-bar { --bar-h: 26px; }
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

  private readonly allyChamps = computed(() => this.rift.champs(this.allies()));
  private readonly enemyChamps = computed(() => this.rift.champs(this.enemies()));
  protected readonly ours = computed(() => teamSplit(this.allyChamps()));
  protected readonly theirs = computed(() => teamSplit(this.enemyChamps()));
  protected readonly sides = computed(() => [
    { key: 'ally', label: 'Your team', split: this.ours() },
    { key: 'enemy', label: 'Enemy team', split: this.theirs() },
  ]);

  /** What each team is built around (2+ tanks, divers or poke, or no tank at all), one line per trait. */
  protected readonly comps = computed(() => [
    ...enemyTraits(this.allyChamps()).map((t) => ({ key: 'ally', label: 'Your team', trait: t.trait, title: TRAIT_TITLES[t.trait](t.count), text: TRAIT_FOR_US[t.trait] })),
    ...enemyTraits(this.enemyChamps()).map((t) => ({ key: 'enemy', label: 'Enemy team', trait: t.trait, title: TRAIT_TITLES[t.trait](t.count), text: TRAIT_VS_THEM[t.trait] })),
  ]);

  protected readonly gold = computed(() => {
    const o = this.rift.overlay();
    if (!this.showGold() || !o?.team) return null;
    const lead = o.team.ours - o.team.theirs;
    const raw = this.rift.goldHistory().slice();
    if (!raw.length || raw.at(-1)!.t < o.gameTime) raw.push({ t: o.gameTime, lead });
    return { lead, ours: o.team.ours, theirs: o.team.theirs, lane: o.lane, raw };
  });

  protected tip = damageTip;
  protected signed = signed;
}
