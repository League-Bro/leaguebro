import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { RiftService } from '../core/rift.service';
import { assetUrl, championIcon } from '../core/assets';
import { PatchEntry, PatchInfo, PatchNotes, PatchSection, PatchVerdict } from '../core/models';
import { Loader } from './loader';

type Filter = 'all' | 'buff' | 'nerf' | 'adjusted' | 'new';

const VERDICT_LABELS: Record<string, string> = {
  buff: 'Buff',
  nerf: 'Nerf',
  adjusted: 'Adjusted',
  new: 'New',
  removed: 'Removed',
};

/** Patch notes summary: every change from Riot's notes, sorted into buffs, nerfs and adjustments. */
@Component({
  selector: 'rl-patch',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, Loader],
  template: `
    <div class="top">
      <div>
        <h1>
          Patch {{ notes()?.info?.version || selected()?.version || '' }}
          @if (isLatest()) { <span class="latest">Latest</span> }
        </h1>
        @if (notes()?.info?.published || selected()?.published; as d) {
          <div class="faint small">Released {{ d | date: 'MMMM d, y' }} · from leagueoflegends.com</div>
        }
      </div>
      <div class="spacer"></div>
      @if (patches().length) {
        <select [value]="selected()?.url ?? ''" (change)="pick($any($event.target).value)">
          @for (p of patches(); track p.url) {
            <option [value]="p.url">Patch {{ p.version || p.title }}</option>
          }
        </select>
      }
    </div>

    @if (error()) {
      <div class="card"><p class="loss small">Couldn't load patch notes: {{ error() }}</p>
        <button (click)="reload()">Try again</button></div>
    } @else if (loading()) {
      <rl-loader [size]="44" [block]="true" class="muted">Loading patch notes…</rl-loader>
    } @else if (notes(); as n) {
      <div class="tiles">
        @for (t of tiles(); track t.id) {
          <button class="tile" [class]="'tile ' + t.id" [class.active]="filter() === t.id" (click)="toggle(t.id)">
            <span class="count">{{ t.count }}</span>
            <span class="tlabel">{{ t.label }}</span>
          </button>
        }
      </div>

      <div class="tools">
        <input type="text" placeholder="Search champions, items, augments…" [value]="query()" (input)="query.set($any($event.target).value)" />
        <label class="check"><input type="checkbox" [checked]="showContext()" (change)="showContext.set(!showContext())" /> Show Riot's reasons</label>
        @if (filter() !== 'all' || query()) {
          <button class="ghost" (click)="filter.set('all'); query.set('')">Clear filters</button>
        }
      </div>

      @for (s of visible(); track s.title) {
        <section>
          <div class="sec-head">
            <h2>{{ s.title }}</h2>
            @if (s.entries.length) {
              <span class="faint small">{{ s.entries.length }} {{ s.entries.length === 1 ? 'change' : 'changes' }}</span>
            }
          </div>
          @if (s.notes.length && filter() === 'all' && !query()) {
            <div class="notes">
              @for (note of s.notes; track $index) { <p>{{ note }}</p> }
            </div>
          }
          <div class="entries">
            @for (e of s.entries; track $index) {
              <article class="entry" [class]="'entry v-' + (e.verdict || 'none')">
                <header>
                  @if (champFor(s, e); as id) {
                    <button class="champ-link" [title]="'Open the build for ' + e.name" (click)="rift.showChampion(id)">
                      <img class="icon" [src]="iconFor(s, e)" alt="" />
                      <span class="name">{{ e.name }}</span>
                    </button>
                  } @else {
                    @if (iconFor(s, e); as url) { <img class="icon" [src]="url" alt="" /> }
                    <span class="name">{{ e.name }}</span>
                  }
                  <span class="spacer"></span>
                  @if (e.verdict) { <span class="badge" [class]="'badge ' + e.verdict">{{ verdictLabel(e.verdict) }}</span> }
                </header>
                @if (showContext() && e.context) { <p class="context">{{ e.context }}</p> }
                @for (g of e.groups; track $index) {
                  <div class="group">
                    @if (g.title) { <div class="gtitle">{{ abilityTitle(g.title) }}</div> }
                    <ul>
                      @for (l of g.lines; track $index) {
                        <li [class]="'line ' + l.effect">
                          @if (l.after) {
                            <span class="label">{{ l.label }}</span>
                            <span class="change"><span class="before">{{ l.before }}</span> <span class="arrow">→</span> <span class="after">{{ l.after }}</span></span>
                          } @else {
                            <span class="plain">{{ l.text }}</span>
                          }
                        </li>
                      }
                    </ul>
                  </div>
                }
              </article>
            }
          </div>
        </section>
      } @empty {
        <p class="muted">Nothing matches those filters.</p>
      }
    }
  `,
  styles: `
    :host { display: flex; flex-direction: column; gap: 16px; max-width: 1180px; margin: 0 auto; }
    .top { display: flex; align-items: flex-end; gap: 12px; }
    h1 { font-size: 22px; display: flex; align-items: center; gap: 10px; }
    .latest { font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--accent); background: var(--accent-soft); padding: 2px 8px; border-radius: 10px; }
    .small { font-size: 12.5px; }
    .tiles { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; }
    .tile {
      display: flex; flex-direction: column; align-items: flex-start; gap: 2px;
      padding: 14px 16px; border-radius: var(--radius); background: var(--glass), var(--bg-raised); border: 1px solid var(--line);
      text-align: left;
    }
    .tile .count { font: 800 28px var(--display); line-height: 1.1; font-variant-numeric: tabular-nums; }
    .tile .tlabel { color: var(--text-dim); font-size: 12.5px; }
    .tile.buff .count { color: var(--win); }
    .tile.nerf .count { color: var(--loss); }
    .tile.adjusted .count { color: var(--gold); }
    .tile.new .count { color: var(--ally); }
    .tile.active { border-color: var(--accent); background: var(--accent-soft); }
    .tools { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }
    .tools input[type='text'] { flex: 1; min-width: 220px; max-width: 420px; }
    .check { display: flex; align-items: center; gap: 6px; color: var(--text-dim); font-size: 13px; cursor: pointer; }
    section { display: flex; flex-direction: column; gap: 10px; }
    .sec-head { display: flex; align-items: baseline; gap: 10px; border-bottom: 1px solid var(--line); padding-bottom: 6px; margin-top: 6px; }
    .sec-head h2 { font-size: 16px; }
    .notes { color: var(--text-dim); font-size: 13px; line-height: 1.5; user-select: text; }
    .notes p { margin: 0 0 6px; white-space: pre-line; }
    .entries { display: grid; grid-template-columns: repeat(auto-fill, minmax(340px, 1fr)); gap: 10px; align-items: start; }
    .entry {
      background: var(--glass), var(--bg-raised); border: 1px solid var(--line); border-left: 3px solid var(--line-strong);
      border-radius: var(--radius); padding: 10px 12px; display: flex; flex-direction: column; gap: 6px; user-select: text;
    }
    .entry.v-buff { border-left-color: var(--win); }
    .entry.v-nerf { border-left-color: var(--loss); }
    .entry.v-adjusted { border-left-color: var(--gold); }
    .entry.v-new { border-left-color: var(--ally); }
    .entry header { display: flex; align-items: center; gap: 9px; }
    .champ-link { display: flex; align-items: center; gap: 9px; padding: 2px 8px 2px 2px; margin: -2px 0 -2px -2px; background: none; border: none; color: var(--text); }
    .champ-link:hover:not(:disabled) { background: var(--accent-soft); color: var(--accent); }
    .icon { width: 30px; height: 30px; border-radius: 6px; border: 1px solid var(--line-strong); object-fit: cover; }
    .name { font-weight: 600; }
    .badge { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; padding: 2px 8px; border-radius: 10px; }
    .badge.buff { color: var(--win); background: rgba(79, 194, 139, 0.14); }
    .badge.nerf { color: var(--loss); background: rgba(255, 90, 78, 0.14); }
    .badge.adjusted { color: var(--gold); background: var(--gold-soft); }
    .badge.new { color: var(--ally); background: rgba(75, 157, 240, 0.14); }
    .badge.removed { color: var(--text-dim); background: var(--bg-sunken); }
    .context { margin: 0; font-size: 12.5px; line-height: 1.45; color: var(--text-dim); font-style: italic; white-space: pre-line; }
    .group { display: flex; flex-direction: column; gap: 3px; }
    .gtitle { font-size: 11.5px; color: var(--text-faint); text-transform: uppercase; letter-spacing: 0.05em; }
    ul { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 3px; }
    .line { font-size: 13px; line-height: 1.4; display: flex; flex-direction: column; padding-left: 10px; border-left: 2px solid transparent; }
    .line.buff { border-left-color: var(--win); }
    .line.nerf { border-left-color: var(--loss); }
    .line .label { color: var(--text-dim); font-size: 12px; }
    .before { color: var(--text-faint); }
    .arrow { color: var(--text-faint); margin: 0 6px; }
    .line.buff .after { color: var(--win); }
    .line.nerf .after { color: var(--loss); }
    .line:not(.buff):not(.nerf) .after { color: var(--text); }
    .plain { color: var(--text-dim); }
    @media (max-width: 760px) { .tiles { grid-template-columns: repeat(2, 1fr); } }
  `,
})
export class PatchView implements OnInit {
  protected readonly rift = inject(RiftService);
  protected readonly patches = signal<PatchInfo[]>([]);
  protected readonly selected = signal<PatchInfo | null>(null);
  protected readonly notes = signal<PatchNotes | null>(null);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly filter = signal<Filter>('all');
  protected readonly query = signal('');
  protected readonly showContext = signal(true);

  protected readonly isLatest = computed(() => {
    const s = this.selected();
    return !!s && this.patches()[0]?.url === s.url;
  });

  private readonly champIds = computed(() => {
    const m = new Map<string, number>();
    // League Classic copies share the name; patch notes are about the normal champion.
    for (const c of this.rift.statics()?.champions ?? []) if (!c.classic) m.set(norm(c.name), c.id);
    return m;
  });
  /** "Q - Sonic Wave" with the player's own key in place of Q. */
  abilityTitle(title: string): string {
    return title.replace(/^([QWER])(?=\s*[-–:])/, (k) => this.rift.abilityKey(k));
  }

  private readonly itemPaths = computed(() => {
    const m = new Map<string, string>();
    // Arena and other modes reuse names under ids ≥ 10000; prefer the normal item.
    for (const i of this.rift.statics()?.items ?? []) {
      if (!m.has(norm(i.name)) || i.id < 10000) m.set(norm(i.name), i.iconPath);
    }
    return m;
  });
  private readonly perkPaths = computed(() => {
    const m = new Map<string, string>();
    for (const p of this.rift.statics()?.perks ?? []) m.set(norm(p.name), p.iconPath);
    return m;
  });

  protected readonly tiles = computed(() => {
    const all = (this.notes()?.sections ?? []).flatMap((s) => s.entries);
    const count = (v: PatchVerdict) => all.filter((e) => e.verdict === v).length;
    const tiles: { id: Filter; label: string; count: number }[] = [
      { id: 'buff', label: 'Buffs', count: count('buff') },
      { id: 'nerf', label: 'Nerfs', count: count('nerf') },
      { id: 'adjusted', label: 'Adjusted', count: count('adjusted') },
      { id: 'new', label: 'New', count: count('new') },
    ];
    return tiles;
  });

  protected readonly visible = computed<PatchSection[]>(() => {
    const f = this.filter();
    const q = norm(this.query());
    return (this.notes()?.sections ?? [])
      .map((s) => ({
        ...s,
        entries: s.entries.filter((e) => (f === 'all' || e.verdict === f) && (!q || matches(e, q))),
      }))
      .filter((s) => s.entries.length || (f === 'all' && !q && s.notes.length));
  });

  async ngOnInit(): Promise<void> {
    await this.reload();
  }

  async reload(): Promise<void> {
    this.error.set(null);
    this.loading.set(true);
    try {
      const list = await this.rift.listPatches();
      this.patches.set(list);
      const first = this.selected() ?? list[0] ?? null;
      if (first) await this.load(first);
      else this.loading.set(false);
    } catch (e) {
      this.error.set(String(e));
      this.loading.set(false);
    }
  }

  async pick(url: string): Promise<void> {
    const p = this.patches().find((x) => x.url === url);
    if (p) await this.load(p);
  }

  private async load(p: PatchInfo): Promise<void> {
    this.selected.set(p);
    this.error.set(null);
    this.loading.set(true);
    try {
      const n = await this.rift.getPatch(p.url);
      // Ignore a slow answer for a patch you've since switched away from.
      if (this.selected()?.url === p.url) this.notes.set(n);
    } catch (e) {
      this.error.set(String(e));
    } finally {
      if (this.selected()?.url === p.url) this.loading.set(false);
    }
  }

  toggle(f: Filter): void {
    this.filter.set(this.filter() === f ? 'all' : f);
  }

  verdictLabel(v: string): string {
    return VERDICT_LABELS[v] ?? v;
  }

  /** The champion an entry is about (0 for items, runes and the rest), for the link to its page. */
  champFor(s: PatchSection, e: PatchEntry): number {
    return s.kind === 'item' ? 0 : (this.champIds().get(norm(e.name)) ?? 0);
  }

  iconFor(s: PatchSection, e: PatchEntry): string {
    const key = norm(e.name);
    const champ = this.champIds().get(key);
    if (champ && s.kind !== 'item') return championIcon(champ);
    if (s.kind === 'champion') return '';
    return assetUrl(this.itemPaths().get(key) ?? this.perkPaths().get(key));
  }
}

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function matches(e: PatchEntry, q: string): boolean {
  if (norm(e.name).includes(q)) return true;
  return e.groups.some((g) => norm(g.title).includes(q));
}
