import { ChangeDetectionStrategy, Component, inject, input, output, signal } from '@angular/core';
import { RiftService } from '../core/rift.service';
import { championIcon } from '../core/assets';

/** "Who's in your lane?": the enemy champions as buttons, plus None. Picking one tells League Bro (`choose_lane_opponent`). */
@Component({
  selector: 'rl-opponent-picker',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (ids().length) {
      <span class="faint small">{{ current() ? 'Not them?' : 'Who\\'s in your lane?' }}</span>
      <div class="pick" role="radiogroup" aria-label="Your lane opponent">
        @for (id of ids(); track id) {
          <button class="ghost who" role="radio" [class.on]="id === current()" [attr.aria-checked]="id === current()"
            [disabled]="busy()" [title]="rift.champName(id)" (click)="choose(id)">
            <img [src]="icon(id)" alt="" />
          </button>
        }
        @if (current()) {
          <button class="ghost none" [disabled]="busy()" (click)="choose(0)" [title]="noneTitle()">None</button>
        }
      </div>
    }
  `,
  styles: `
    :host { display: contents; }
    .pick { display: flex; gap: 4px; align-items: center; }
    .who { padding: 2px; border-radius: 10px; border: 1px solid transparent; line-height: 0; }
    .who img { width: 28px; height: 28px; border-radius: 8px; opacity: 0.6; }
    .who:hover img, .who.on img { opacity: 1; }
    .who.on { border-color: var(--accent); background: var(--accent-soft); }
    .none { font-size: 12px; padding: 4px 8px; }
  `,
})
export class OpponentPicker {
  protected readonly rift = inject(RiftService);
  protected readonly icon = championIcon;
  readonly ids = input.required<number[]>();
  /** The opponent now, 0 for none. */
  readonly current = input(0);
  readonly noneTitle = input('');
  readonly chosen = output<number>();
  protected readonly busy = signal(false);

  async choose(id: number): Promise<void> {
    if (this.busy() || id === this.current()) return;
    this.chosen.emit(id);
    this.busy.set(true);
    try {
      await this.rift.chooseLaneOpponent(id);
    } finally {
      this.busy.set(false);
    }
  }
}
