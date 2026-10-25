import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { RiftService } from '../core/rift.service';
import { championSplit, damageTip, DamageSplit, teamSplit } from '../core/damage';

/** Your team vs the enemy team as AD / AP / true damage bars (champ select and loading screen / in game). */
@Component({
  selector: 'rl-team-damage',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (ours() || theirs()) {
      <section class="card dmg">
        @for (t of sides(); track t.key) {
          <div class="side" [class.enemy]="t.key === 'enemy'">
            <div class="row top">
              <span class="label">{{ t.label }}</span>
              @if (t.split; as s) {
                @if (s.counted < 5) { <span class="faint">{{ s.counted }} of 5 picked</span> }
                <div class="spacer"></div>
                <span class="mono nums">
                  <b class="ad">{{ s.ad }}% AD</b>
                  <b class="ap">{{ s.ap }}% AP</b>
                  @if (s.true > 0) { <b class="tr">{{ s.true }}% true</b> }
                </span>
              }
            </div>
            @if (t.split; as s) {
              <div class="bar" [title]="s.ad + '% physical · ' + s.ap + '% magic · ' + s.true + '% true (rough, by champion)'">
                <span class="ad" [style.flex-grow]="s.ad"></span>
                <span class="ap" [style.flex-grow]="s.ap"></span>
                @if (s.true > 0) { <span class="tr" [style.flex-grow]="s.true"></span> }
              </div>
              @if (tip(s, t.key === 'enemy'); as tip) { <div class="tip muted">{{ tip }}</div> }
            } @else {
              <div class="bar empty"></div>
              <div class="tip faint">No picks yet</div>
            }
          </div>
        }
      </section>
    }
  `,
  styles: `
    .dmg { display: grid; grid-template-columns: 1fr 1fr; gap: 28px; padding: 16px 20px; margin-top: 8px; }
    @media (max-width: 720px) { .dmg { grid-template-columns: 1fr; gap: 16px; } }
    .top { align-items: baseline; gap: 10px; margin-bottom: 8px; }
    .label { font-weight: 600; color: var(--ally); }
    .enemy .label { color: var(--enemy); }
    .nums { display: flex; gap: 10px; font-size: 13px; }
    .nums .ad { color: #ff8a5c; }
    .nums .ap { color: #9d8cff; }
    .nums .tr { color: var(--text); }
    .bar { display: flex; gap: 3px; height: 10px; border-radius: 99px; overflow: hidden; background: var(--bg-sunken); }
    .bar span { min-width: 4px; transition: flex-grow 0.4s ease; }
    .bar .ad { background: linear-gradient(90deg, #ff6b4a, #ff9b62); }
    .bar .ap { background: linear-gradient(90deg, #7d6bff, #b49cff); }
    .bar .tr { background: #e9e6f0; }
    .tip { font-size: 12px; margin-top: 7px; min-height: 16px; }
  `,
})
export class TeamDamage {
  private readonly rift = inject(RiftService);
  /** Champion ids, 0 for "not picked yet". */
  readonly allies = input.required<number[]>();
  readonly enemies = input.required<number[]>();

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
  protected tip = damageTip;
}
