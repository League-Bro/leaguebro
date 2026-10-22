import { Component, computed, effect, inject, output, signal, untracked } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { RiftService } from '../core/rift.service';
import { POSITION_LABELS, championIcon } from '../core/assets';
import { TierEntry, TierList, TierSource } from '../core/models';

const LANES = Object.entries(POSITION_LABELS).map(([id, label]) => ({ id, label }));

const SOURCES: { id: TierSource; label: string; hint: string }[] = [
  { id: 'lolalytics', label: 'Lolalytics', hint: 'Most accurate: the biggest sample, current patch' },
  { id: 'opgg', label: 'OP.GG', hint: 'Most popular: the tier list most players look at' },
];

/**
 * Lolalytics rank filters (tierlist.rs `RANKS`). Below `newPatchGames` the
 * patch is too new for stable tiers: about a quarter of a normal week's games
 * for that filter (October 2026: Emerald+ ~12.5M a week, Master+ ~2.2M).
 */
const RANKS = [
  { id: 'all', label: 'All ranks', newPatchGames: 11_600_000 },
  { id: 'gold_plus', label: 'Gold+', newPatchGames: 7_900_000 },
  { id: 'platinum_plus', label: 'Platinum+', newPatchGames: 5_400_000 },
  { id: 'emerald_plus', label: 'Emerald+', newPatchGames: 3_000_000 },
  { id: 'diamond_plus', label: 'Diamond+', newPatchGames: 1_300_000 },
  { id: 'master_plus', label: 'Master+', newPatchGames: 500_000 },
];

const ROWS: TierEntry['tier'][] = ['S', 'A', 'B', 'C', 'D'];

/** The champ select role last used to pick the lane, so it's only applied once. */
let autoLane: string | null = null;

/** Per-lane champion tiers from Lolalytics or OP.GG. Clicking a champion opens it in the Champions tab. */
@Component({
  selector: 'rl-tierlist',
  imports: [DecimalPipe],
  template: `
    <div class="top">
      <div>
        <h1>Tier List</h1>
        <div class="faint small">{{ subtitle() }}</div>
      </div>
      <div class="spacer"></div>
      <input type="text" placeholder="Find a champion…" [value]="query()" (input)="query.set($any($event.target).value)" />
    </div>

    <div class="controls">
      <div class="seg">
        @for (l of lanes; track l.id) {
          <button [class.on]="pick().position === l.id" (click)="set({ position: l.id })">{{ l.label }}</button>
        }
      </div>
      <div class="seg">
        @for (s of sources; track s.id) {
          <button [class.on]="pick().source === s.id" [title]="s.hint" (click)="set({ source: s.id })">{{ s.label }}</button>
        }
      </div>
      @if (pick().source === 'lolalytics') {
        <select (change)="set({ rank: $any($event.target).value })">
          @for (r of ranks; track r.id) { <option [value]="r.id" [selected]="pick().rank === r.id">{{ r.label }}</option> }
        </select>
      }
      <span class="faint small hint">{{ sourceHint() }}</span>
    </div>

    @if (error(); as e) {
      <div class="card"><p class="loss small">Couldn't load the tier list: {{ e }}</p>
        <button (click)="reload()">Try again</button></div>
    } @else if (!list()) {
      <p class="muted">Loading tier list…</p>
    } @else {
      @if (newPatch()) {
        <p class="note small">The patch is only a few days old, so this list is based on fewer games than usual and will shift as more are played.</p>
      }
      <div class="rows" [class.stale]="loading()">
        @for (row of rows(); track row.tier) {
          <section class="row">
            <div class="letter" [class]="'letter t-' + row.tier">{{ row.tier }}</div>
            <div class="champs">
              @for (e of row.entries; track e.name) {
                <button class="champ" [class.dim]="!matches(e)" [title]="tooltip(e)" (click)="open(e)" [disabled]="!e.championId">
                  <span class="rank mono faint">{{ e.rank }}</span>
                  @if (e.championId) { <img class="champ-icon sm" [src]="icon(e.championId)" alt="" /> }
                  <span class="info">
                    <span class="name">{{ e.name }}</span>
                    <span class="stats mono">
                      <span [class.win]="e.winRate >= 51.5" [class.loss]="e.winRate < 48.5">{{ e.winRate | number: wrDigits() }}%</span>
                      <span class="faint">· {{ e.pickRate | number: '1.1-1' }}% pick</span>
                    </span>
                  </span>
                  <span class="label" [class]="'label t-' + e.tier">{{ labelText(e) }}</span>
                  @if (e.rankChange) {
                    <span class="move" [class.win]="e.rankChange > 0" [class.loss]="e.rankChange < 0">{{ e.rankChange > 0 ? '▲' : '▼' }}{{ abs(e.rankChange) }}</span>
                  }
                </button>
              }
            </div>
          </section>
        } @empty {
          <p class="muted">No champions in this list.</p>
        }
      </div>
    }
  `,
  styles: `
    :host { display: flex; flex-direction: column; gap: 14px; max-width: 1180px; margin: 0 auto; }
    .top { display: flex; align-items: flex-end; gap: 12px; }
    h1 { font-size: 22px; }
    .small { font-size: 12.5px; margin: 0; }
    .top input { width: 220px; }
    .controls { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
    .hint { flex: 1; min-width: 200px; }
    .seg { display: flex; }
    .seg button { border-radius: 0; padding: 5px 12px; }
    .seg button:first-child { border-radius: 8px 0 0 8px; }
    .seg button:last-child { border-radius: 0 8px 8px 0; }
    .seg button + button { border-left: none; }
    .seg button.on { background: var(--gold-soft); border-color: var(--gold); color: var(--gold); }
    .note { color: var(--gold); background: var(--gold-soft); border-radius: 8px; padding: 8px 12px; }
    .rows { display: flex; flex-direction: column; gap: 8px; transition: opacity 0.15s; }
    .rows.stale { opacity: 0.55; }
    .row { display: flex; gap: 10px; align-items: stretch; background: var(--bg-raised); border: 1px solid var(--line); border-radius: var(--radius); padding: 8px; }
    .letter {
      flex: none; width: 46px; border-radius: 8px; display: flex; align-items: center; justify-content: center;
      font-size: 22px; font-weight: 800; color: #10131c;
    }
    .t-S { --tc: #ff8a5c; }
    .t-A { --tc: #f2c45a; }
    .t-B { --tc: #7fd18b; }
    .t-C { --tc: #6fb2f0; }
    .t-D { --tc: #9aa3b8; }
    .letter { background: var(--tc); }
    .champs { flex: 1; display: grid; grid-template-columns: repeat(auto-fill, minmax(205px, 1fr)); gap: 4px; }
    .champ { display: flex; align-items: center; gap: 8px; text-align: left; padding: 4px 8px; background: var(--bg-sunken); border-color: transparent; }
    .champ:disabled { opacity: 1; }
    .champ.dim { opacity: 0.25; }
    .rank { width: 18px; text-align: right; font-size: 11px; }
    .info { flex: 1; min-width: 0; display: flex; flex-direction: column; line-height: 1.25; }
    .name { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-weight: 600; }
    .stats { font-size: 11px; color: var(--text-dim); white-space: nowrap; }
    .label { font-size: 11px; font-weight: 700; color: var(--tc); border: 1px solid var(--tc); border-radius: 5px; padding: 0 5px; min-width: 24px; text-align: center; }
    .move { font-size: 10px; width: 24px; }
    .win { color: var(--win); }
    .loss { color: var(--loss); }
  `,
})
export class TierListView {
  protected readonly rift = inject(RiftService);
  /** A champion was clicked: open it in the Champions tab for this lane. */
  readonly openChampion = output<{ championId: number; position: string }>();

  protected readonly lanes = LANES;
  protected readonly sources = SOURCES;
  protected readonly ranks = RANKS;
  protected readonly pick = this.rift.tierPick;
  protected readonly query = signal('');
  protected readonly list = signal<TierList | null>(null);
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);
  private seq = 0;

  protected readonly rows = computed(() => {
    const entries = this.list()?.entries ?? [];
    return ROWS.map((tier) => ({ tier, entries: entries.filter((e) => e.tier === tier) })).filter((r) => r.entries.length);
  });
  protected readonly newPatch = computed(() => {
    const l = this.list();
    const min = RANKS.find((r) => r.id === l?.rank)?.newPatchGames;
    return l?.gamesAnalysed != null && min != null && l.gamesAnalysed < min;
  });
  /** OP.GG rounds win rates to whole percents. */
  protected readonly wrDigits = computed(() => (this.list()?.source === 'opgg' ? '1.0-0' : '1.1-1'));
  protected readonly sourceHint = computed(() => SOURCES.find((s) => s.id === this.pick().source)?.hint ?? '');
  protected readonly subtitle = computed(() => {
    const l = this.list();
    if (!l) return '';
    const parts = [l.source === 'opgg' ? 'OP.GG ranked solo' : 'Lolalytics ranked solo'];
    if (l.rank) parts.push(RANKS.find((r) => r.id === l.rank)?.label ?? l.rank);
    parts.push('current patch');
    if (l.gamesAnalysed) parts.push(`${compact(l.gamesAnalysed)} games`);
    parts.push(`updated ${ago(l.fetchedAt)}`);
    return parts.join(' · ');
  });

  protected icon = championIcon;
  protected abs = Math.abs;

  constructor() {
    // Start on your champ select role if you have one (once, so a lane you
    // pick afterwards sticks when you come back to the tab).
    const pos = this.rift.champSelect()?.myPosition?.toLowerCase();
    if (pos && pos !== autoLane && LANES.some((l) => l.id === pos)) {
      autoLane = pos;
      this.set({ position: pos });
    }
    effect(() => {
      const p = this.pick();
      untracked(() => this.load(p.source, p.position, p.rank));
    });
  }

  set(change: Partial<{ source: TierSource; position: string; rank: string }>): void {
    this.pick.update((p) => ({ ...p, ...change }));
  }

  reload(): void {
    const p = this.pick();
    this.load(p.source, p.position, p.rank);
  }

  private async load(source: TierSource, position: string, rank: string): Promise<void> {
    const seq = ++this.seq;
    this.loading.set(true);
    this.error.set(null);
    try {
      const list = await this.rift.getTierList(source, position, rank);
      if (seq === this.seq) this.list.set(list);
    } catch (e) {
      if (seq === this.seq) this.error.set(String(e));
    } finally {
      if (seq === this.seq) this.loading.set(false);
    }
  }

  matches(e: TierEntry): boolean {
    const q = this.query().trim().toLowerCase();
    return !q || e.name.toLowerCase().includes(q);
  }

  labelText(e: TierEntry): string {
    return this.list()?.source === 'opgg' ? `T${e.label}` : e.label;
  }

  tooltip(e: TierEntry): string {
    const lines = [
      `${e.name}: #${e.rank} in the lane, tier ${this.labelText(e)}`,
      `Win ${e.winRate.toFixed(this.list()?.source === 'opgg' ? 0 : 2)}% · pick ${e.pickRate.toFixed(1)}% · ban ${e.banRate.toFixed(1)}%`,
      `${e.games.toLocaleString()} games`,
    ];
    if (e.championId) lines.push('Click to see the build in Champions');
    return lines.join('\n');
  }

  open(e: TierEntry): void {
    // The shown list's lane: while another lane loads, the previous list is still on screen.
    const position = this.list()?.position ?? this.pick().position;
    if (e.championId) this.openChampion.emit({ championId: e.championId, position });
  }
}

function compact(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${Math.round(n / 1e3)}k`;
  return String(n);
}

function ago(secs: number): string {
  const mins = Math.max(0, Math.round((Date.now() / 1000 - secs) / 60));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  return `${Math.round(mins / 60)} h ago`;
}
