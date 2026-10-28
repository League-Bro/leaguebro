import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { formatTier } from '../core/assets';
import { LpChange } from '../core/models';

/** "+21 LP" / "−18 LP" for a ranked game, with "Promoted"/"Demoted" when it moved your division. Hover for the rank it left you at. */
@Component({
  selector: 'rl-lp-change',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let c = change();
    <span class="lp mono" [class.gain]="c.delta > 0" [class.loss]="c.delta < 0" [title]="title()">{{ label() }}</span>
    @if (c.moved) {
      <span class="moved" [class.gain]="c.moved === 'up'" [class.loss]="c.moved === 'down'">{{ c.moved === 'up' ? 'Promoted' : 'Demoted' }}</span>
    }
  `,
  styles: `
    :host { display: inline-flex; align-items: baseline; gap: 6px; }
    .lp { font-weight: 600; color: var(--text-dim); cursor: help; white-space: nowrap; }
    .moved { font-size: 0.85em; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; white-space: nowrap; }
    .gain { color: var(--win); }
    .loss { color: var(--loss); }
  `,
})
export class LpChangeTag {
  readonly change = input.required<LpChange>();

  protected readonly label = computed(() => {
    const d = this.change().delta;
    return `${d > 0 ? '+' : d < 0 ? '−' : '±'}${Math.abs(d)} LP`;
  });

  protected readonly title = computed(() => {
    const c = this.change();
    return `Now ${formatTier(c.tier, c.division)} ${c.lp} LP`;
  });
}
