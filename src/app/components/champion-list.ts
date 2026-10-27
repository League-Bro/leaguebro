import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, computed, effect, inject, output, signal, untracked, viewChild } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { RiftService } from '../core/rift.service';
import { POSITION_LABELS, championIcon, rankCrest } from '../core/assets';
import { TierEntry, TierSource } from '../core/models';
import { Loader } from './loader';

type Lane = 'top' | 'jungle' | 'middle' | 'bottom' | 'utility';
type SortKey = 'tier' | 'name' | 'winRate' | 'pickRate' | 'banRate' | 'games';

const LANES: Lane[] = ['top', 'jungle', 'middle', 'bottom', 'utility'];

/** Lane icons, drawn here so they need no download: the lane's part of the map, bright on a faint map square. */
const LANE_ICONS: Record<Lane | 'all', string> = {
  all: 'M5 5h5v5H5zM14 5h5v5h-5zM5 14h5v5H5zM14 14h5v5h-5z',
  top: 'M5 16V5h11',
  jungle: 'M8 4c.5 5 2 9 4 16M16 4c-.5 5-2 9-4 16M12 4v9',
  middle: 'M6 18 18 6',
  bottom: 'M8 19h11V8',
  utility: 'M12 4l7 3v4.5c0 4-3 7-7 8.5-4-1.5-7-4.5-7-8.5V7z',
};

/**
 * Rank filters, the same for both sources (tierlist.rs `RANKS`). Below
 * `newPatchGames` the patch is too new for stable stats: about a quarter of a
 * normal week's Lolalytics games for that filter (October 2026: Emerald+
 * ~12.5M a week, Master+ ~2.2M; single ranks scaled from the same day's
 * counts). OP.GG counts games differently, so the warning only uses
 * Lolalytics' numbers. Listed in rank order, each "+" right after its rank.
 */
const RANKS = [
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

const SOURCES: { id: TierSource; label: string }[] = [
  { id: 'lolalytics', label: 'Lolalytics' },
  { id: 'opgg', label: 'OP.GG' },
];

/** One table row: a champion in one lane, or a champion with no stats for the filters. */
interface Row {
  key: string;
  championId: number;
  name: string;
  lane: Lane | null;
  e: TierEntry | null;
}

interface Highlight {
  title: string;
  row: Row;
  value: string;
  tone: 'win' | 'accent' | 'loss' | 'teal';
}

/** Filters and sort, kept for the whole session so they survive tab switches. */
const prefs = signal({
  lane: 'all' as Lane | 'all',
  rank: 'emerald_plus',
  source: 'lolalytics' as TierSource,
  sort: 'tier' as SortKey,
  desc: false,
  favoritesOnly: false,
});

/**
 * The Champions tab's start page: every champion with this patch's ranked
 * stats from Lolalytics or OP.GG (tier, win, pick and ban rate per lane), plus
 * a few highlights. Clicking a champion opens its build.
 */
@Component({
  selector: 'rl-champion-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(document:click)': 'closeRankMenu($event)' },
  imports: [DecimalPipe, Loader],
  template: `
    <div class="top">
      <div>
        <h1>Champions</h1>
        <div class="faint small">{{ subtitle() }}</div>
      </div>
      <div class="spacer"></div>
      <div class="seg game">
        <button [class.on]="game() === 'league'" (click)="game.set('league')">League</button>
        <button [class.on]="game() === 'classic'" (click)="game.set('classic')">League Classic</button>
      </div>
    </div>

    <div class="controls">
      <div class="search">
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4 4" /></svg>
        <input type="text" placeholder="Search champions…" title="Enter opens the top champion" [value]="query()" (input)="query.set($any($event.target).value)" (keydown.enter)="openFirst()" />
      </div>
      @if (game() === 'league') {
        <div class="seg lanes" role="tablist" aria-label="Lane">
          @for (l of laneTabs; track l.id) {
            <button role="tab" [class.on]="p().lane === l.id" [attr.aria-selected]="p().lane === l.id" [title]="l.label" (click)="set({ lane: l.id })">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                @if (l.id !== 'all') { <rect class="map" x="4" y="4" width="16" height="16" rx="2" /> }
                <path [attr.d]="l.icon" />
              </svg>
              <span class="lane-label">{{ l.label }}</span>
            </button>
          }
        </div>
        <div class="rank-pick" #rankPicker (keydown.escape)="rankOpen.set(false)">
          <button class="rank-btn" aria-haspopup="listbox" [attr.aria-expanded]="rankOpen()" (click)="rankOpen.set(!rankOpen())">
            <img [src]="crest(p().rank)" alt="" />
            <span>{{ rankLabel() }}</span>
            <span class="caret">▾</span>
          </button>
          @if (rankOpen()) {
            <div class="rank-menu" role="listbox">
              @for (r of ranks; track r.id) {
                <button role="option" [attr.aria-selected]="p().rank === r.id" [class.on]="p().rank === r.id" (click)="pickRank(r.id)">
                  <img [src]="crest(r.id)" alt="" />
                  <span>{{ r.label }}</span>
                </button>
              }
            </div>
          }
        </div>
        <div class="seg">
          @for (s of sources; track s.id) {
            <button [class.on]="p().source === s.id" (click)="set({ source: s.id })">{{ s.label }}</button>
          }
        </div>
      }
      <button class="fav-chip" [class.on]="p().favoritesOnly" [attr.aria-pressed]="p().favoritesOnly" (click)="set({ favoritesOnly: !p().favoritesOnly })">
        {{ p().favoritesOnly ? '★' : '☆' }} Favorites
      </button>
    </div>

    @if (game() === 'classic') {
      <p class="faint small">League Classic has no ranked stats, so its champions have the guide only.</p>
      <div class="grid">
        @for (c of classicChamps(); track c.id) {
          <button class="tile" (click)="open.emit({ championId: c.id, position: 'middle' })">
            <img class="champ-icon" [src]="icon(c.id)" alt="" />
            <span>{{ c.name }}</span>
          </button>
        } @empty {
          @if (rift.statics()) {
            <p class="muted">No champion matches.</p>
          } @else {
            <rl-loader [block]="true" class="muted">Loading champions…</rl-loader>
          }
        }
      </div>
    } @else {
      @if (highlights().length) {
        <div class="highlights" [class.stale]="loading()">
          @for (h of highlights(); track h.title) {
            <button class="hl" [class]="'hl tone-' + h.tone" (click)="openRow(h.row)">
              @if (rift.champSplash(h.row.championId); as splash) {
                <div class="splash"><img [src]="splash" alt="" /></div>
              }
              <span class="hl-title">{{ h.title }}</span>
              <span class="hl-name">{{ h.row.name }}</span>
              <span class="hl-foot">
                <span class="hl-value">{{ h.value }}</span>
                @if (h.row.lane) { <span class="faint">{{ laneLabel(h.row.lane) }}</span> }
              </span>
            </button>
          }
        </div>
      }

      @if (error(); as e) {
        <div class="card err"><span class="loss small">Couldn't load champion stats: {{ e }}</span>
          <button (click)="reload()">Try again</button></div>
      }
      @if (newPatch()) {
        <p class="note small">The patch is only a few days old, so these stats are based on fewer games than usual and will shift as more are played.</p>
      }

      <div class="table card" role="table" [class.stale]="loading()" [class.moves]="hasMoves()">
        <div class="thead" role="row">
          <span role="columnheader" class="c-rank">#</span>
          <span role="columnheader" class="c-lane">Lane</span>
          @for (h of headers; track h.key) {
            <button role="columnheader" [class]="'sort c-' + h.key" [class.on]="p().sort === h.key"
                    [attr.aria-sort]="p().sort === h.key ? (p().desc ? 'descending' : 'ascending') : null" (click)="sortBy(h.key)">
              {{ h.label }}@if (p().sort === h.key) { <span class="arrow">{{ arrow() }}</span> }
            </button>
          }
          @if (hasMoves()) { <span role="columnheader" class="c-move" title="Places moved in OP.GG's ranking since its last update">Trend</span> }
        </div>
        @for (r of rows(); track r.key; let i = $index) {
          <div class="trow" role="row" tabindex="0" [class.nostats]="!r.e" (click)="openRow(r)" (keydown.enter)="openRow(r)">
            <span class="c-rank mono faint">{{ r.e ? i + 1 : '' }}</span>
            <span class="c-lane">
              @if (r.lane) {
                <svg viewBox="0 0 24 24" [attr.aria-label]="laneLabel(r.lane)"><rect class="map" x="4" y="4" width="16" height="16" rx="2" /><path [attr.d]="laneIcon(r.lane)" /></svg>
              }
            </span>
            <span class="c-name">
              <img class="champ-icon md" [src]="icon(r.championId)" alt="" />
              <span class="cname">{{ r.name }}</span>
              <button class="star" [class.on]="isFavorite(r.championId)" [title]="isFavorite(r.championId) ? 'Remove from favorites' : 'Add to favorites'"
                      [attr.aria-label]="(isFavorite(r.championId) ? 'Remove ' : 'Add ') + r.name + (isFavorite(r.championId) ? ' from favorites' : ' to favorites')"
                      (click)="toggleFavorite(r.championId, $event)">{{ isFavorite(r.championId) ? '★' : '☆' }}</button>
            </span>
            @if (r.e; as e) {
              <span class="c-tier"><span class="badge" [class]="'badge t-' + e.tier">{{ badge(e) }}</span></span>
              <span class="c-winRate num">
                <span class="mono" [class.win]="e.winRate >= 51.5" [class.loss]="e.winRate < 48.5">{{ e.winRate | number: '1.1-1' }}%</span>
                <span class="bar wr"><i [style.width.%]="wrBar(e.winRate)"></i></span>
              </span>
              <span class="c-pickRate num">
                <span class="mono">{{ e.pickRate | number: '1.1-1' }}%</span>
                <span class="bar pick"><i [style.width.%]="share(e.pickRate, max().pick)"></i></span>
              </span>
              <span class="c-banRate num">
                <span class="mono">{{ e.banRate | number: '1.1-1' }}%</span>
                <span class="bar ban"><i [style.width.%]="share(e.banRate, max().ban)"></i></span>
              </span>
              <span class="c-games num mono muted">{{ e.games | number }}</span>
              @if (hasMoves()) {
                <span class="c-move num mono" [class.win]="(e.rankChange ?? 0) > 0" [class.loss]="(e.rankChange ?? 0) < 0">
                  @if (e.rankChange) { {{ e.rankChange > 0 ? '▲' : '▼' }}{{ abs(e.rankChange) }} } @else { <span class="faint">–</span> }
                </span>
              }
            } @else {
              @if (loading()) {
                <rl-loader [size]="20" class="c-none faint small">Loading stats…</rl-loader>
              } @else {
                <span class="c-none faint small">Not enough games for these filters</span>
              }
            }
          </div>
        } @empty {
          @if (statsLoading()) {
            <rl-loader [size]="44" [block]="true" class="muted">Loading champion stats…</rl-loader>
          } @else {
            <p class="muted empty">{{ emptyText() }}</p>
          }
        }
      </div>
    }
  `,
  styles: `
    :host { display: flex; flex-direction: column; gap: 14px; max-width: 1180px; margin: 0 auto; }
    .top { display: flex; align-items: flex-end; gap: 12px; }
    h1 { font-size: 22px; }
    .small { font-size: 12.5px; margin: 0; }
    .seg.game button { white-space: nowrap; font-size: 12.5px; }
    .controls { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
    .search { position: relative; flex: 1; min-width: 180px; max-width: 280px; }
    .search svg { position: absolute; left: 11px; top: 50%; translate: 0 -50%; width: 16px; height: 16px; fill: none; stroke: var(--text-faint); stroke-width: 2; stroke-linecap: round; }
    .search input { width: 100%; padding-left: 34px; border-radius: 999px; }

    svg path, svg rect { fill: none; stroke: currentColor; stroke-width: 2.2; stroke-linecap: round; stroke-linejoin: round; }
    svg .map { stroke-width: 1.4; opacity: 0.22; }
    .lanes button { display: flex; align-items: center; gap: 6px; padding: 5px 11px; }
    .lanes svg { width: 18px; height: 18px; flex: none; }
    .lanes button:first-child svg path { stroke-width: 1.8; }
    .lane-label { font-size: 12.5px; }

    .rank-pick { position: relative; }
    .rank-btn { display: flex; align-items: center; gap: 8px; padding: 5px 12px 5px 8px; background: var(--bg-sunken); }
    .rank-btn img, .rank-menu img { width: 22px; height: 22px; flex: none; }
    .caret { color: var(--text-faint); font-size: 11px; }
    .note { margin: 0; color: var(--gold); background: var(--gold-soft); border-radius: var(--radius-sm); padding: 8px 12px; }
    .rank-menu {
      position: absolute; top: calc(100% + 6px); left: 0; z-index: 10; min-width: 100%;
      display: flex; flex-direction: column; gap: 1px; padding: 5px;
      max-height: 420px; overflow: auto;
      background: var(--bg-raised); border: 1px solid var(--line-strong); border-radius: var(--radius-sm); box-shadow: var(--shadow);
    }
    .rank-menu button { display: flex; align-items: center; gap: 9px; text-align: left; white-space: nowrap; border: none; border-radius: 8px; background: none; padding: 5px 12px 5px 7px; }
    .rank-menu button.on { background: var(--accent-soft); color: var(--accent); font-weight: 600; }
    .fav-chip { background: var(--bg-sunken); color: var(--text-dim); }
    .fav-chip.on { background: var(--accent-soft); border-color: var(--accent); color: var(--accent); font-weight: 600; }

    .stale { opacity: 0.55; transition: opacity 0.15s; }

    /* Highlight cards: splash art fading into the card, a big name and one stat. */
    .highlights { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px; }
    .hl {
      position: relative; overflow: hidden; display: flex; flex-direction: column; align-items: flex-start; gap: 2px;
      text-align: left; padding: 14px 16px; min-height: 104px; border-radius: var(--radius);
      background: var(--glass), var(--bg-raised); border: 1px solid var(--line);
    }
    .hl > :not(.splash) { position: relative; }
    .hl .splash img { object-position: 60% 18%; opacity: 0.6; }
    .hl .splash::after { background: linear-gradient(90deg, var(--bg-raised) 25%, rgba(24, 21, 31, 0.55) 70%, rgba(24, 21, 31, 0.15)); }
    .hl:hover:not(:disabled) { border-color: var(--hc); box-shadow: 0 0 22px -6px var(--hc); }
    .hl-title { font-size: 10.5px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: var(--hc); }
    .hl-name { font-family: var(--display); font-size: 19px; font-weight: 700; }
    .hl-foot { display: flex; align-items: baseline; gap: 8px; margin-top: auto; font-size: 12px; }
    .hl-value { font-size: 15px; font-weight: 700; color: var(--hc); font-variant-numeric: tabular-nums; }
    .tone-win { --hc: var(--win); }
    .tone-accent { --hc: var(--accent); }
    .tone-loss { --hc: var(--loss); }
    .tone-teal { --hc: var(--accent-2); }

    .err { display: flex; align-items: center; gap: 12px; justify-content: space-between; padding: 12px 16px; }

    /* The stats table: one grid template for the header and every row. */
    .table { padding: 6px; }
    .thead, .trow {
      display: grid; align-items: center; gap: 10px;
      grid-template-columns: 34px 40px minmax(170px, 1.6fr) 56px repeat(3, minmax(80px, 1fr)) minmax(70px, 0.8fr);
      padding: 0 12px;
    }
    .moves .thead, .moves .trow { grid-template-columns: 34px 40px minmax(170px, 1.6fr) 56px repeat(3, minmax(80px, 1fr)) minmax(70px, 0.8fr) 50px; }
    .thead {
      position: sticky; top: 0; z-index: 2; height: 40px; margin-bottom: 2px;
      background: var(--bg-raised); border-bottom: 1px solid var(--line); border-radius: var(--radius-sm) var(--radius-sm) 0 0;
      font-size: 10.5px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: var(--text-faint);
    }
    .thead .sort { border: none; background: none; border-radius: 6px; padding: 4px 0; font: inherit; letter-spacing: inherit; text-transform: inherit; color: inherit; text-align: left; white-space: nowrap; }
    .thead .sort:hover:not(:disabled) { background: none; color: var(--text); }
    .thead .sort.on { color: var(--accent); }
    .arrow { margin-left: 4px; }
    .c-rank { text-align: right; }
    .c-lane { display: flex; justify-content: center; }
    .c-tier { display: flex; justify-content: center; }
    .thead .c-tier { text-align: center; }
    .num, .thead .c-winRate, .thead .c-pickRate, .thead .c-banRate, .thead .c-games, .c-move { text-align: right; justify-self: end; }

    .trow { height: 52px; border-radius: var(--radius-sm); cursor: pointer; transition: background 0.12s; }
    .trow:nth-child(odd) { background: rgba(255, 255, 255, 0.018); }
    .trow:hover { background: var(--accent-soft); }
    .trow:focus-visible { outline: 2px solid var(--accent-2); outline-offset: -2px; }
    .trow .c-rank { font-size: 12px; }
    .trow .c-lane svg { width: 22px; height: 22px; color: var(--text-dim); }
    .c-name { display: flex; align-items: center; gap: 10px; min-width: 0; }
    .cname { font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .trow:hover .cname { color: var(--accent); }
    .star { background: none; border-color: transparent; color: var(--text-dim); padding: 2px 6px; font-size: 15px; line-height: 1; }
    .star:hover:not(:disabled) { color: var(--accent); background: none; border-color: transparent; }
    .star.on { color: var(--accent); }
    .star:not(.on) { visibility: hidden; }
    .trow:hover .star, .star:focus-visible { visibility: visible; }
    .nostats .c-name { opacity: 0.75; }
    .c-none { grid-column: 4 / -1; }

    .badge {
      display: inline-flex; align-items: center; justify-content: center; min-width: 30px; height: 24px; padding: 0 6px;
      border-radius: 8px; background: var(--tc); color: #10131c; font-weight: 800; font-size: 12.5px;
      box-shadow: 0 0 14px -4px var(--tc);
    }
    .t-S { --tc: #ff8a5c; }
    .t-A { --tc: #f2c45a; }
    .t-B { --tc: #7fd18b; }
    .t-C { --tc: #6fb2f0; }
    .t-D { --tc: #9aa3b8; }

    .num { display: flex; flex-direction: column; align-items: flex-end; gap: 5px; font-size: 13px; }
    .num .mono { font-weight: 600; }
    .bar { width: 64px; height: 3px; border-radius: 2px; background: var(--line-strong); overflow: hidden; }
    .bar i { display: block; height: 100%; border-radius: inherit; }
    .bar.wr i { background: var(--accent-2); }
    .bar.pick i { background: var(--accent); }
    .bar.ban i { background: var(--loss); opacity: 0.8; }
    .empty { padding: 16px 12px; margin: 0; }

    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 8px; }
    .tile { display: flex; align-items: center; gap: 10px; text-align: left; border-radius: var(--radius-sm); padding: 8px 10px; background: var(--bg-raised); border-color: var(--line); font-weight: 600; }

    @media (max-width: 980px) {
      .lane-label { display: none; }
      .thead, .trow, .moves .thead, .moves .trow { grid-template-columns: 28px 30px minmax(150px, 1.6fr) 50px repeat(3, minmax(70px, 1fr)); }
      .c-games, .c-move { display: none; }
    }
  `,
})
export class ChampionList {
  protected readonly rift = inject(RiftService);
  /** A champion was clicked; position is its lane in the table (or the one it plays most). */
  readonly open = output<{ championId: number; position: string }>();

  protected readonly p = prefs;
  protected readonly game = this.rift.championsGame;
  protected readonly ranks = RANKS;
  protected readonly sources = SOURCES;
  protected readonly laneTabs = (['all', ...LANES] as const).map((id) => ({
    id,
    label: id === 'all' ? 'All' : POSITION_LABELS[id],
    icon: LANE_ICONS[id],
  }));
  protected readonly headers: { key: SortKey; label: string }[] = [
    { key: 'name', label: 'Champion' },
    { key: 'tier', label: 'Tier' },
    { key: 'winRate', label: 'Win rate' },
    { key: 'pickRate', label: 'Pick rate' },
    { key: 'banRate', label: 'Ban rate' },
    { key: 'games', label: 'Games' },
  ];
  protected readonly query = signal('');
  protected readonly rankOpen = signal(false);
  private readonly rankPicker = viewChild<ElementRef<HTMLElement>>('rankPicker');
  protected readonly rankLabel = computed(() => RANKS.find((r) => r.id === this.p().rank)?.label ?? this.p().rank);

  /** Loaded lanes for the current source and rank. */
  private readonly lanes = signal<{ lane: Lane; entries: TierEntry[] }[]>([]);
  private readonly meta = signal<{ source: TierSource; rank: string; patch: string | null; games: number; fetchedAt: number } | null>(null);
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);
  private seq = 0;
  /** Ticks every 30 s so "updated N min ago" keeps up. */
  private readonly now = signal(Date.now());

  private readonly favoriteIds = computed(() => new Set(this.rift.config()?.favoriteChampions ?? []));
  private readonly champs = computed(() => (this.rift.statics()?.champions ?? []).filter((c) => !c.classic));

  /** Every champion-lane with stats, before search and sorting. */
  private readonly statRows = computed<Row[]>(() =>
    this.lanes().flatMap(({ lane, entries }) =>
      entries.filter((e) => e.championId).map((e) => ({ key: `${e.championId}-${lane}`, championId: e.championId, name: e.name, lane, e })),
    ),
  );

  protected readonly rows = computed<Row[]>(() => {
    const q = this.query().trim().toLowerCase();
    const favs = this.favoriteIds();
    const { sort, desc, favoritesOnly, lane } = this.p();
    const keep = (id: number, name: string, alias = '') =>
      (!favoritesOnly || favs.has(id)) && (!q || name.toLowerCase().includes(q) || alias.toLowerCase().includes(q));
    const alias = new Map(this.champs().map((c) => [c.id, c.alias]));
    const stats = this.statRows().filter((r) => keep(r.championId, r.name, alias.get(r.championId)));
    stats.sort((a, b) => compare(a, b, sort) * (desc ? -1 : 1) || compare(a, b, 'tier'));
    // With All lanes (or a search) every champion is listed: ones without
    // stats for these filters go at the bottom, so the table is the full roster.
    if (lane !== 'all' && !q) return stats;
    const seen = new Set(this.statRows().map((r) => r.championId));
    const rest = this.champs()
      .filter((c) => !seen.has(c.id) && keep(c.id, c.name, c.alias))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((c) => ({ key: `${c.id}`, championId: c.id, name: c.name, lane: null, e: null }));
    return [...stats, ...rest];
  });

  protected readonly max = computed(() => {
    const es = this.statRows().map((r) => r.e!);
    return { pick: Math.max(1, ...es.map((e) => e.pickRate)), ban: Math.max(1, ...es.map((e) => e.banRate)) };
  });

  /** Only OP.GG reports ranking moves; the Trend column shows when the list has them. */
  protected readonly hasMoves = computed(() => this.statRows().some((r) => r.e?.rankChange != null));

  protected readonly highlights = computed<Highlight[]>(() => {
    // Over the lanes in view, ignoring rare picks so a 30-game fluke can't top the list.
    const rows = this.statRows();
    if (!rows.length) return [];
    const picks = rows.map((r) => r.e!.pickRate).sort((a, b) => a - b);
    const median = picks[Math.floor(picks.length / 2)];
    const common = rows.filter((r) => r.e!.pickRate >= Math.min(1, median));
    // Each card shows a different champion, so one dominant pick doesn't fill the row.
    const used = new Set<number>();
    const best = (list: Row[], f: (e: TierEntry) => number): Row | null => {
      const left = list.filter((r) => !used.has(r.championId));
      const r = left.length ? left.reduce((a, b) => (f(b.e!) > f(a.e!) ? b : a)) : null;
      if (r) used.add(r.championId);
      return r;
    };
    const out: Highlight[] = [];
    const top = best(common, (e) => e.winRate);
    if (top) out.push({ title: 'Best win rate', row: top, value: `${top.e!.winRate.toFixed(1)}% win`, tone: 'win' });
    const picked = best(rows, (e) => e.pickRate);
    if (picked) out.push({ title: 'Most picked', row: picked, value: `${picked.e!.pickRate.toFixed(1)}% pick`, tone: 'accent' });
    const banned = best(rows, (e) => e.banRate);
    if (banned) out.push({ title: 'Most banned', row: banned, value: `${banned.e!.banRate.toFixed(1)}% ban`, tone: 'loss' });
    const climbers = rows.filter((r) => (r.e!.rankChange ?? 0) > 0);
    const climber = best(climbers, (e) => e.rankChange ?? 0);
    if (climber) {
      out.push({ title: 'Climbing fastest', row: climber, value: `▲${climber.e!.rankChange} places`, tone: 'teal' });
    } else {
      // A strong pick few people play: best win rate below the median pick rate.
      const gem = best(rows.filter((r) => r.e!.pickRate < median), (e) => e.winRate);
      if (gem) out.push({ title: 'Hidden gem', row: gem, value: `${gem.e!.winRate.toFixed(1)}% win · ${gem.e!.pickRate.toFixed(1)}% pick`, tone: 'teal' });
    }
    return out;
  });

  protected readonly classicChamps = computed(() => {
    const q = this.query().trim().toLowerCase();
    const favs = this.favoriteIds();
    return (this.rift.statics()?.champions ?? [])
      .filter((c) => c.classic && (!this.p().favoritesOnly || favs.has(c.id)))
      .filter((c) => !q || c.name.toLowerCase().includes(q) || c.alias.toLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name));
  });

  protected readonly subtitle = computed(() => {
    if (this.game() === 'classic') return 'League Classic champions';
    const m = this.meta();
    const p = this.p();
    const parts = [`${SOURCES.find((s) => s.id === p.source)?.label} ranked solo`, this.rankLabel()];
    if (m) {
      parts.push(m.patch ? `patch ${m.patch}` : 'current patch');
      if (m.games) parts.push(`${compact(m.games)} games`);
      parts.push(`updated ${ago(m.fetchedAt, this.now())}`);
    }
    return parts.join(' · ');
  });

  /** A Lolalytics list with too few games for this rank yet: the patch just came out. */
  protected readonly newPatch = computed(() => {
    const m = this.meta();
    const min = RANKS.find((r) => r.id === m?.rank)?.newPatchGames;
    return m?.source === 'lolalytics' && !!m.games && min != null && m.games < min;
  });

  /** First load of the stats, with nothing to show yet. */
  protected readonly statsLoading = computed(() => this.loading() && !this.statRows().length);

  protected readonly emptyText = computed(() => {
    if (this.p().favoritesOnly && !this.query()) return 'No favorites here yet. Star a champion to pin it to this filter.';
    if (this.query()) return 'No champion matches.';
    return 'Too few games at this rank to rate champions in this lane. Try a wider rank filter.';
  });

  protected readonly arrow = computed(() => (this.p().desc ? '▼' : '▲'));
  protected icon = championIcon;
  protected crest = rankCrest;
  protected abs = Math.abs;

  constructor() {
    effect(() => {
      const { source, rank, lane } = this.p();
      untracked(() => this.load(source, rank, lane));
    });
    const timer = setInterval(() => this.now.set(Date.now()), 30_000);
    inject(DestroyRef).onDestroy(() => clearInterval(timer));
  }

  set(change: Partial<ReturnType<typeof prefs>>): void {
    prefs.update((p) => ({ ...p, ...change }));
  }

  sortBy(key: SortKey): void {
    const p = this.p();
    // Numbers start high-to-low, tier and name start at the top of the alphabet.
    if (p.sort === key) this.set({ desc: !p.desc });
    else this.set({ sort: key, desc: key !== 'tier' && key !== 'name' });
  }

  pickRank(rank: string): void {
    this.rankOpen.set(false);
    this.set({ rank });
  }

  closeRankMenu(event: MouseEvent): void {
    if (this.rankOpen() && !this.rankPicker()?.nativeElement.contains(event.target as Node)) this.rankOpen.set(false);
  }

  reload(): void {
    const { source, rank, lane } = this.p();
    this.load(source, rank, lane);
  }

  /** Loads the lane, or all five for All (the backend caches each list, so switching back is instant). */
  private async load(source: TierSource, rank: string, lane: Lane | 'all'): Promise<void> {
    const seq = ++this.seq;
    this.loading.set(true);
    this.error.set(null);
    const want = lane === 'all' ? LANES : [lane];
    const results = await Promise.allSettled(want.map((l) => this.rift.getTierList(source, l, rank)));
    if (seq !== this.seq) return;
    const lists = results.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []));
    const failed = results.find((r): r is PromiseRejectedResult => r.status === 'rejected');
    this.lanes.set(lists.map((l) => ({ lane: l.position as Lane, entries: l.entries })));
    this.meta.set(
      lists.length
        ? {
            source,
            rank,
            patch: lists[0].patch,
            // Every lane list counts the same games, so this is not a sum.
            games: lists[0].gamesAnalysed ?? 0,
            fetchedAt: Math.min(...lists.map((l) => l.fetchedAt)),
          }
        : null,
    );
    if (failed) this.error.set(lists.length ? `some lanes are missing (${failed.reason})` : String(failed.reason));
    this.loading.set(false);
  }

  /** Enter in the search box: the top champion in the list. */
  protected openFirst(): void {
    if (!this.query().trim()) return;
    if (this.game() === 'classic') {
      const c = this.classicChamps()[0];
      if (c) this.open.emit({ championId: c.id, position: 'middle' });
    } else {
      const r = this.rows()[0];
      if (r) this.openRow(r);
    }
  }

  openRow(r: Row): void {
    this.open.emit({ championId: r.championId, position: r.lane ?? this.mainLane(r.championId) });
  }

  /** The lane a champion is picked most in, for one without a lane in the table. */
  private mainLane(championId: number): string {
    let best: { lane: Lane; pick: number } | null = null;
    for (const r of this.statRows()) {
      if (r.championId === championId && r.lane && (!best || r.e!.pickRate > best.pick)) best = { lane: r.lane, pick: r.e!.pickRate };
    }
    return best?.lane ?? 'middle';
  }

  isFavorite(id: number): boolean {
    return this.favoriteIds().has(id);
  }

  toggleFavorite(id: number, event: Event): void {
    event.stopPropagation();
    void this.rift.updateConfig((c) => ({
      ...c,
      favoriteChampions: c.favoriteChampions.includes(id) ? c.favoriteChampions.filter((x) => x !== id) : [...c.favoriteChampions, id],
    }));
  }

  badge(e: TierEntry): string {
    // Lolalytics labels are "S+" … "D-"; OP.GG's are "OP" or 1–5, shown as the tier letter.
    return e.label === 'OP' || /^[SABCD][+-]?$/.test(e.label) ? e.label : e.tier;
  }

  laneLabel(lane: Lane): string {
    return POSITION_LABELS[lane];
  }

  laneIcon(lane: Lane): string {
    return LANE_ICONS[lane];
  }

  /** 44% → empty bar, 58% → full. */
  wrBar(wr: number): number {
    return Math.max(4, Math.min(100, ((wr - 44) / 14) * 100));
  }

  share(v: number, max: number): number {
    return Math.max(3, Math.min(100, (v / max) * 100));
  }
}

const TIER_ORDER = 'SABCD';

/** Ascending order for a column; tier ties go to the higher win rate. */
function compare(a: Row, b: Row, key: SortKey): number {
  const x = a.e!;
  const y = b.e!;
  switch (key) {
    case 'name':
      return a.name.localeCompare(b.name);
    case 'tier':
      return TIER_ORDER.indexOf(x.tier) - TIER_ORDER.indexOf(y.tier) || sub(x.label) - sub(y.label) || y.winRate - x.winRate;
    default:
      return x[key] - y[key];
  }
}

/** Order within a tier letter: OP and "+" first, "-" last. */
function sub(label: string): number {
  return label === 'OP' ? -1 : label.endsWith('+') ? 0 : label.endsWith('-') ? 2 : 1;
}

function compact(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${Math.round(n / 1e3)}k`;
  return String(n);
}

function ago(secs: number, nowMs: number): string {
  const mins = Math.max(0, Math.round((nowMs / 1000 - secs) / 60));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  return `${Math.round(mins / 60)} h ago`;
}
