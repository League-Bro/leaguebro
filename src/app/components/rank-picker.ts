import { ChangeDetectionStrategy, Component, ElementRef, computed, inject, input, output, signal } from '@angular/core';
import { rankCrest } from '../core/assets';

/**
 * Rank filters, the same for both sources (tierlist.rs `RANKS`). Below
 * `newPatchGames` the patch is too new for stable stats: about a quarter of a
 * normal week's Lolalytics games for that filter (October 2026: Emerald+
 * ~12.5M a week, Master+ ~2.2M; single ranks scaled from the same day's
 * counts). OP.GG counts games differently, so the warning only uses
 * Lolalytics' numbers. Listed in rank order, each "+" right after its rank.
 */
export const RANKS = [
  { id: 'all', label: 'All ranks', newPatchGames: 11_600_000 },
  { id: 'iron', label: 'Iron', newPatchGames: 400_000 },
  { id: 'bronze', label: 'Bronze', newPatchGames: 1_300_000 },
  { id: 'silver', label: 'Silver', newPatchGames: 2_000_000 },
  { id: 'gold', label: 'Gold', newPatchGames: 2_500_000 },
  { id: 'gold_plus', label: 'Gold+', newPatchGames: 7_900_000 },
  { id: 'platinum', label: 'Platinum', newPatchGames: 2_400_000 },
  { id: 'platinum_plus', label: 'Platinum+', newPatchGames: 5_400_000 },
  { id: 'emerald', label: 'Emerald', newPatchGames: 1_750_000 },
  { id: 'emerald_plus', label: 'Emerald+', newPatchGames: 3_000_000 },
  { id: 'diamond', label: 'Diamond', newPatchGames: 775_000 },
  { id: 'diamond_plus', label: 'Diamond+', newPatchGames: 1_300_000 },
  { id: 'master', label: 'Master', newPatchGames: 525_000 },
  { id: 'master_plus', label: 'Master+', newPatchGames: 500_000 },
  { id: 'grandmaster', label: 'Grandmaster', newPatchGames: 35_000 },
  { id: 'challenger', label: 'Challenger', newPatchGames: 11_000 },
];

/** A rank filter's name ("gold_plus" -> "Gold+"). */
export function rankName(id: string | null | undefined): string {
  return RANKS.find((r) => r.id === id)?.label ?? id ?? '';
}

/**
 * The rank filter menu: a crest button that opens the list of ranks, each
 * with its crest (Champions tab, champ select's suggestions card). With
 * `auto` set, the list starts with that entry (value '': "Your rank").
 */
@Component({
  selector: 'rl-rank-picker',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(document:click)': 'close($event)', '(keydown.escape)': 'open.set(false)' },
  template: `
    <button class="rank-btn" [class.small]="small()" aria-haspopup="listbox" [attr.aria-expanded]="open()" (click)="open.set(!open())">
      <img [src]="crest(value() || autoRank())" alt="" />
      <span>{{ label() }}</span>
      <span class="caret">▾</span>
    </button>
    @if (open()) {
      <div class="rank-menu" role="listbox">
        @if (auto(); as a) {
          <button role="option" [attr.aria-selected]="!value()" [class.on]="!value()" (click)="pick('')">
            <img [src]="crest(autoRank())" alt="" />
            <span>{{ a }}</span>
          </button>
        }
        @for (r of ranks; track r.id) {
          <button role="option" [attr.aria-selected]="value() === r.id" [class.on]="value() === r.id" (click)="pick(r.id)">
            <img [src]="crest(r.id)" alt="" />
            <span>{{ r.label }}</span>
          </button>
        }
      </div>
    }
  `,
  styles: `
    :host { position: relative; display: inline-block; }
    .rank-btn { display: flex; align-items: center; gap: 8px; padding: 5px 12px 5px 8px; background: var(--bg-sunken); }
    .rank-btn.small { gap: 6px; padding: 3px 10px 3px 6px; font-size: 12.5px; }
    .rank-btn img, .rank-menu img { width: 22px; height: 22px; flex: none; }
    .rank-btn.small img { width: 18px; height: 18px; }
    .caret { color: var(--text-faint); font-size: 11px; }
    .rank-menu {
      position: absolute; top: calc(100% + 6px); left: 0; z-index: 10; min-width: 100%;
      display: flex; flex-direction: column; gap: 1px; padding: 5px;
      max-height: 420px; overflow: auto;
      background: var(--bg-raised); border: 1px solid var(--line-strong); border-radius: var(--radius-sm); box-shadow: var(--shadow);
    }
    :host(.end) .rank-menu { left: auto; right: 0; }
    .rank-menu button { display: flex; align-items: center; gap: 9px; text-align: left; white-space: nowrap; border: none; border-radius: 8px; background: none; padding: 5px 12px 5px 7px; }
    .rank-menu button.on { background: var(--accent-soft); color: var(--accent); font-weight: 600; }
  `,
})
export class RankPicker {
  private readonly host = inject(ElementRef<HTMLElement>);
  /** The chosen filter ('' = the `auto` entry). */
  readonly value = input.required<string>();
  /** The first entry's label ("Your rank (Gold)"); null = no such entry. */
  readonly auto = input<string | null>(null);
  /** The rank the `auto` entry stands for, for its crest. */
  readonly autoRank = input<string | null>(null);
  readonly small = input(false);
  readonly picked = output<string>();

  protected readonly ranks = RANKS;
  protected readonly crest = rankCrest;
  protected readonly open = signal(false);
  protected readonly label = computed(() => (this.value() ? rankName(this.value()) : (this.auto() ?? '')));

  pick(id: string): void {
    this.open.set(false);
    this.picked.emit(id);
  }

  close(event: MouseEvent): void {
    if (this.open() && !this.host.nativeElement.contains(event.target as Node)) this.open.set(false);
  }
}
