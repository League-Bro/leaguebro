import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { DamageSplit } from '../core/damage';

/** The three damage colours, shared by the bar and its legend. */
const COLORS = `
  .ad { --c: #f26b3a; }
  .ap { --c: #8f7dff; }
  .tr { --c: #d8d2e6; }
`;

/** One team's damage profile as a stacked AD / AP / true bar (champ select's team card, the Live tab). Set `--bar-h` for its height. */
@Component({
  selector: 'rl-damage-bar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (grid()) {
      <i class="gl" style="left: 25%"></i><i class="gl" style="left: 50%"></i><i class="gl" style="left: 75%"></i>
    }
    @for (seg of segments(); track seg.key) {
      <span [class]="'part ' + seg.key" [class.first]="$first" [class.last]="$last" [style.width.%]="seg.value" [title]="label() + ': ' + seg.value + '% ' + seg.name">
        @if (seg.value >= 14) { <b class="mono">{{ seg.value }}%</b> }
      </span>
    } @empty {
      <span class="none faint">No picks yet</span>
    }
  `,
  styles: [COLORS, `
    :host { position: relative; display: flex; gap: 2px; height: var(--bar-h, 22px); }
    .gl { position: absolute; top: -4px; bottom: -4px; width: 1px; background: var(--line); pointer-events: none; }
    .part { position: relative; display: flex; align-items: center; padding: 0 7px; min-width: 3px; background: var(--c); transition: width 0.4s ease; }
    .part.first { border-top-left-radius: 4px; border-bottom-left-radius: 4px; }
    .part.last { border-top-right-radius: 4px; border-bottom-right-radius: 4px; }
    .part b { font-size: 11.5px; color: #17131d; }
    .none { align-self: center; font-size: 12px; }
  `],
})
export class DamageBar {
  readonly split = input<DamageSplit | null>(null);
  /** Whose bar it is, for the hover text ("Your team: 60% physical"). */
  readonly label = input('');
  /** Quarter gridlines, for a chart with an axis under it. */
  readonly grid = input(false);

  protected readonly segments = computed(() => {
    const s = this.split();
    if (!s) return [];
    return [
      { key: 'ad', name: 'physical', value: s.ad },
      { key: 'ap', name: 'magic', value: s.ap },
      { key: 'tr', name: 'true', value: s.true },
    ].filter((x) => x.value > 0);
  });
}

/** The bar's colour key: AD, AP, True. */
@Component({
  selector: 'rl-damage-legend',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span><i class="ad"></i>AD</span>
    <span><i class="ap"></i>AP</span>
    <span><i class="tr"></i>True</span>
  `,
  styles: [COLORS, `
    :host { display: flex; gap: 12px; font-size: 12px; color: var(--text-dim); }
    span { display: flex; align-items: center; gap: 5px; }
    i { width: 10px; height: 10px; border-radius: 3px; display: inline-block; background: var(--c); }
  `],
})
export class DamageLegend {}
