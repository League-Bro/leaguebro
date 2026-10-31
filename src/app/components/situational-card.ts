import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal } from '@angular/core';
import { RiftService } from '../core/rift.service';
import { ItemSet, SituationalState, SituationTag } from '../core/models';
import { SITUATION_LABEL, SITUATION_WHEN, pct } from '../core/why';
import { ItemTip } from './item-tip';

/** Other options shown before "Show more". */
const OTHERS_SHOWN = 3;
/** Whether the list was left open (localStorage). */
const OPEN_KEY = 'leaguebro.situationalOpen';

function readOpen(): boolean {
  try { return localStorage.getItem(OPEN_KEY) === '1'; } catch { return false; }
}

/**
 * Situational items: OP.GG's 4th–6th item options, ranked against the enemy
 * team when there is one (`state`, from champ select picks or the live
 * scoreboard), each with when it's worth buying.
 */
@Component({
  selector: 'rl-situational',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ItemTip],
  template: `
    @if (picks().length || others().length) {
      <section class="panel">
        <!-- Closed until clicked: the header is the dropdown. -->
        <button class="ghost toggle" [attr.aria-expanded]="open()" (click)="open.set(!open())">
          <svg class="chev" [class.up]="open()" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" /></svg>
          <h4>Situational items</h4>
          @if (!open()) {
            <span class="hint">{{ summary() }}</span>
          } @else if (state(); as s) {
            <span class="hint">{{ s.live ? 'From the scoreboard, updated as enemies buy items' : 'From the enemy picks' }}</span>
          } @else {
            <span class="hint">OP.GG's 4th–6th item options, and when each is worth buying</span>
          }
        </button>
        @if (open()) {

        @if (state(); as s) {
          @if (s.threats.length) {
            <div class="threats" aria-label="What the enemy team brings">
              @for (t of s.threats; track t.tag) {
                <span class="threat" [title]="t.detail">
                  {{ t.label }}
                  <span class="dots" aria-hidden="true">@for (d of dots(t.level); track $index) {<i></i>}</span>
                </span>
              }
            </div>
          }
          @for (p of picks(); track p.id) {
            <div class="pick">
              @if (rift.itemIcon(p.id); as url) { <img [src]="url" alt="" [rlItemTip]="p.id" (error)="rift.hideImg($event)" /> }
              <div class="body">
                <div class="title">
                  <span class="strong">{{ p.name }}</span>
                  <span class="tag">{{ p.label }}</span>
                  @if (p.started) { <span class="tag started">Started</span> }
                </div>
                <div class="small">{{ p.reason }}</div>
                <div class="faint small">
                  @if (p.offPool) {
                    Not one of OP.GG's usual picks for {{ champName() }}, but nothing else on the list answers this.
                  } @else {
                    {{ pct(p.winRate) }} win in {{ p.games.toLocaleString() }} games as a 4th–6th item
                  }
                </div>
              </div>
            </div>
          } @empty {
            <p class="faint small">
              @if (s.live) { Nothing on the enemy team calls for a situational item right now. }
              @else if (!s.threats.length) { Picks for this team show up as enemies lock in. }
              @else { Nothing in {{ champName() }}'s usual options answers this team better than the core build. }
            </p>
          }
        }

        @if (others().length) {
          @if (state()) { <div class="sub">Other options</div> }
          @for (o of shownOthers(); track o.id) {
            <div class="pick other">
              @if (rift.itemIcon(o.id); as url) { <img [src]="url" alt="" [rlItemTip]="o.id" (error)="rift.hideImg($event)" /> }
              <div class="body">
                <div class="title">
                  <span class="strong">{{ o.name }}</span>
                  @for (t of o.tags; track t) { <span class="tag">{{ label(t) }}</span> }
                </div>
                @for (t of o.tags; track t) { <div class="muted small">{{ when(t) }}</div> }
                <div class="faint small">{{ pct(o.set.winRate) }} win in {{ o.set.games.toLocaleString() }} games</div>
              </div>
            </div>
          }
          @if (others().length > othersShown) {
            <button class="ghost more" (click)="expanded.set(!expanded())">
              {{ expanded() ? 'Show fewer' : 'Show ' + (others().length - othersShown) + ' more counter' + (others().length - othersShown === 1 ? '' : 's') }}
            </button>
          }
        }
        }
      </section>
    }
  `,
  styles: `
    /* Same titled panel as the rec card's Runes / Items panels. */
    .panel {
      display: flex; flex-direction: column; gap: 10px; min-width: 0;
      padding: 14px 16px 16px; border-radius: var(--radius-sm); background: var(--bg-hover); border: 1px solid var(--line);
    }
    /* Inside another panel (the rec card's items): no panel of its own. */
    :host(.bare) .panel { padding: 0; background: none; border: 0; border-radius: 0; }
    .toggle { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; padding: 2px 0; margin: 0; background: none; border: 0; text-align: left; color: var(--text-dim); cursor: pointer; }
    .toggle { align-self: flex-start; }
    .toggle:hover, .toggle:focus { background: none; color: var(--text); }
    .chev { flex: none; transition: transform 0.15s ease; }
    .chev.up { transform: rotate(180deg); }
    .panel h4 { margin: 0; font-size: 14px; font-weight: 600; color: var(--text); }
    .hint { font-size: 12px; color: var(--text-faint); }
    .sub { font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--text-faint); margin-top: 6px; }    .small { font-size: 12.5px; margin: 0; line-height: 1.4; }
    .strong { font-weight: 600; }
    .threats { display: flex; flex-wrap: wrap; gap: 4px; }
    .threat {
      display: inline-flex; align-items: center; gap: 6px; padding: 2px 9px; border-radius: 999px;
      background: var(--bg-sunken); border: 1px solid var(--line); font-size: 12px; cursor: default;
    }
    .dots { display: inline-flex; gap: 2px; }
    .dots i { width: 5px; height: 5px; border-radius: 50%; background: var(--accent); }
    .pick { display: flex; gap: 10px; align-items: flex-start; }
    .pick img { width: 30px; height: 30px; border-radius: 6px; border: 1px solid var(--line-strong); flex: none; margin-top: 2px; }
    .pick:not(.other) img { border-color: var(--accent); }
    .body { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
    .title { display: flex; align-items: baseline; gap: 6px; flex-wrap: wrap; }
    .tag {
      font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.06em;
      color: var(--text-dim); background: var(--bg-sunken); border-radius: 999px; padding: 1px 8px;
    }
    .pick:not(.other) .tag:not(.started) { color: var(--accent); background: var(--accent-soft); }
    .tag.started { color: var(--win); }
    .more { align-self: flex-start; font-size: 12.5px; color: var(--accent); }
  `,
})
export class SituationalCard {
  protected readonly rift = inject(RiftService);
  /** OP.GG's 4th–6th item options for the champion. */
  readonly pool = input.required<ItemSet[]>();
  /** Item ids already in the core build or boots. */
  readonly core = input<number[]>([]);
  /** Ranked against the enemy team; null outside a game (the Champions tab). */
  readonly state = input<SituationalState | null>(null);
  readonly championId = input(0);

  protected readonly othersShown = OTHERS_SHOWN;
  protected readonly expanded = signal(false);
  /** Closed by default; your last choice is remembered. */
  protected readonly open = signal(readOpen());
  private readonly saveOpen = effect(() => {
    try { localStorage.setItem(OPEN_KEY, this.open() ? '1' : '0'); } catch { /* storage off: just don't remember */ }
  });
  /** What's inside while it's closed, e.g. "3 picks for this team". */
  protected readonly summary = computed(() => {
    const n = this.picks().length;
    if (n) return `${n} ${n === 1 ? 'pick' : 'picks'} for this team`;
    const o = this.others().length;
    return `${o} ${o === 1 ? 'option' : 'options'}`;
  });
  protected readonly pct = (x: number) => pct(x, 0);

  protected readonly champName = computed(() => this.rift.champName(this.championId()) || 'this champion');
  protected readonly picks = computed(() => this.state()?.items ?? []);

  /** Pool items that are situational at all, minus the core and the picks above. */
  protected readonly others = computed(() => {
    const items = this.rift.itemById();
    const skip = new Set([...this.core(), ...this.picks().map((p) => p.id)]);
    return this.pool()
      .filter((s) => s.ids.length === 1 && !skip.has(s.ids[0]))
      .map((set) => {
        const info = items.get(set.ids[0]);
        return { id: set.ids[0], name: info?.name ?? set.names[0] ?? `Item ${set.ids[0]}`, tags: info?.situations ?? [], set };
      })
      .filter((o) => o.tags.length);
  });
  protected readonly shownOthers = computed(() => (this.expanded() ? this.others() : this.others().slice(0, OTHERS_SHOWN)));

  label(t: SituationTag): string {
    return SITUATION_LABEL[t];
  }
  when(t: SituationTag): string {
    const w = SITUATION_WHEN[t];
    return w.charAt(0).toUpperCase() + w.slice(1);
  }
  /** One to three dots for how much of a threat it is. */
  dots(level: number): number[] {
    return Array.from({ length: Math.min(3, Math.max(1, Math.round(level))) });
  }
}
