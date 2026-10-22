import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { RiftService } from '../core/rift.service';
import { RecCard } from './rec-card';
import { assetUrl, championIcon } from '../core/assets';
import { ItemInfo, RecState, RunePage } from '../core/models';
import { rolesLabel } from '../core/why';

const ROLES = [
  { id: 'top', label: 'Top' },
  { id: 'jungle', label: 'Jungle' },
  { id: 'middle', label: 'Mid' },
  { id: 'bottom', label: 'Bot' },
  { id: 'utility', label: 'Support' },
];

/** Look up any champion's OP.GG build, and set your own rune page and item order for them. */
@Component({
  selector: 'rl-champions',
  imports: [RecCard],
  template: `
    <div class="layout">
      <aside class="card">
        <div class="seg game">
          <button [class.on]="game() === 'league'" (click)="game.set('league')">League</button>
          <button [class.on]="game() === 'classic'" (click)="game.set('classic')">League Classic</button>
        </div>
        <input type="text" class="filter" placeholder="Search champions…" [value]="query()" (input)="query.set($any($event.target).value)" />
        <div class="list">
          @for (c of list(); track c.id) {
            <button class="champ" [class.active]="c.id === pick()?.championId" (click)="select(c.id)">
              <img class="champ-icon sm" [src]="icon(c.id)" alt="" />
              <span class="cname">{{ c.name }}</span>
              @if (hasPage(c.id)) { <span class="mark" title="Your own rune page is saved">R</span> }
              @if (hasBuild(c.id)) { <span class="mark" title="Your own build is saved">B</span> }
            </button>
          } @empty {
            <p class="faint small">{{ rift.statics() ? 'No champion matches.' : 'Champions load once the League client is open.' }}</p>
          }
        </div>
      </aside>

      <div class="main">
        @if (pick(); as p) {
          <section class="card head">
            <img class="big" [src]="icon(p.championId)" alt="" />
            <div class="stack grow">
              <div>
                <h2>{{ rift.champName(p.championId) }}@if (isClassic()) { <span class="classic-tag">League Classic</span> }</h2>
                @if (roles()) { <div class="muted small">{{ roles() }}</div> }
              </div>
              @if (!isClassic()) {
              <div class="row controls">
                <div class="seg">
                  <button [class.on]="p.mode === 'ranked'" (click)="setMode('ranked')">Ranked</button>
                  <button [class.on]="p.mode === 'aram'" (click)="setMode('aram')">ARAM</button>
                </div>
                @if (p.mode === 'ranked') {
                  <div class="seg">
                    @for (r of roles_; track r.id) {
                      <button [class.on]="p.position === r.id" (click)="setRole(r.id)">{{ r.label }}</button>
                    }
                  </div>
                }
              </div>
              }
            </div>
          </section>

          @if (isClassic()) {
            <section class="card classic-note">
              <p class="muted">OP.GG has no League Classic stats, so there's no recommended build for League Classic champions.</p>
            </section>
          } @else {
          @if (rift.config()?.recSource !== 'opgg') {
            <p class="faint small note">OP.GG recommendations are off (Settings → Recommendations), so only your own page and build are used.</p>
          }
          <rl-rec-card [lookup]="recState()" />

          <div class="grid">
            <section class="card stack">
              <h3>Your rune page</h3>
              @if (savedPage(); as page) {
                <p class="muted small">Used instead of OP.GG's page whenever you lock in {{ rift.champName(p.championId) }}.</p>
                <div class="row saved">
                  <div class="grow">
                    <div class="strong">{{ page.name || 'Untitled page' }}</div>
                    <div class="faint small">{{ styleName(page.primaryStyleId) }} / {{ styleName(page.subStyleId) }}</div>
                    <div class="perks">
                      @for (id of page.selectedPerkIds; track $index) {
                        @if (perkIcon(id); as url) { <img [src]="url" [title]="perkName(id)" alt="" /> }
                      }
                    </div>
                  </div>
                  <button class="ghost" (click)="removePage(p.championId)">Remove</button>
                </div>
              } @else {
                <p class="muted small">None saved, so League Buddy imports OP.GG's page. To use your own, select it in the client's rune editor, then save it here.</p>
              }
              <div>
                <button [disabled]="!rift.status().connected" (click)="savePage(p.championId)">
                  {{ savedPage() ? 'Replace with the selected page' : 'Save the page selected in the client' }}
                </button>
              </div>
              @if (pageMsg(); as m) { <p class="small" [class.loss]="m.bad" [class.win]="!m.bad">{{ m.text }}</p> }
            </section>

            <section class="card stack">
              <h3>Your build</h3>
              <p class="muted small">
                @if (build().length) {
                  The overlay shows the next two items from this list instead of OP.GG's build.
                } @else {
                  None saved, so the overlay uses OP.GG's build. Add items to use your own order.
                }
              </p>
              <ol class="items">
                @for (id of build(); track $index; let i = $index; let last = $last) {
                  <li>
                    <span class="idx mono faint">{{ i + 1 }}</span>
                    @if (item(id); as it) {
                      <img [src]="itemIcon(it)" alt="" />
                      <span class="grow">{{ it.name }}</span>
                      <span class="mono faint">{{ it.priceTotal }}g</span>
                    } @else {
                      <span class="grow faint">Item {{ id }}</span>
                    }
                    <button class="ghost" [disabled]="i === 0" (click)="move(i, -1)" title="Move up">▲</button>
                    <button class="ghost" [disabled]="last" (click)="move(i, 1)" title="Move down">▼</button>
                    <button class="ghost" (click)="removeAt(i)" title="Remove">✕</button>
                  </li>
                }
              </ol>
              <div class="add">
                <input type="text" placeholder="Add an item…" [value]="itemQuery()" (input)="itemQuery.set($any($event.target).value)" />
                @if (matches().length) {
                  <div class="results">
                    @for (it of matches(); track it.id) {
                      <button (click)="add(it.id)">
                        <img [src]="itemIcon(it)" alt="" />
                        <span class="grow">{{ it.name }}</span>
                        <span class="mono faint">{{ it.priceTotal }}g</span>
                      </button>
                    }
                  </div>
                }
              </div>
            </section>
          </div>
          }
        } @else {
          <section class="card empty">
            <h2>Pick a champion</h2>
            <p class="muted">See OP.GG's runes, spells, skill order and build for any champion and role, without being in champ select. You can also save your own rune page and item order for them here.</p>
          </section>
        }
      </div>
    </div>
  `,
  styles: `
    .layout { display: grid; grid-template-columns: 240px 1fr; gap: 16px; align-items: start; }
    aside { position: sticky; top: 0; display: flex; flex-direction: column; gap: 8px; max-height: calc(100vh - 140px); }
    .filter { width: 100%; }
    .seg.game button { flex: 1; padding: 5px 6px; white-space: nowrap; font-size: 12.5px; }
    .classic-tag {
      margin-left: 10px; vertical-align: middle; font-size: 10.5px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase;
      color: var(--text-dim); background: var(--bg-sunken); border: 1px solid var(--line-strong); border-radius: 5px; padding: 2px 7px;
    }
    .classic-note { margin-top: 16px; }
    .classic-note p { margin: 0; }
    .list { display: flex; flex-direction: column; gap: 1px; overflow: auto; margin: 0 -6px; padding: 0 6px; }
    .champ { display: flex; align-items: center; gap: 9px; background: none; border-color: transparent; text-align: left; padding: 4px 6px; }
    .champ:hover { background: var(--bg-sunken); }
    .champ.active { background: var(--gold-soft); border-color: var(--gold); }
    .cname { flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .mark { font-size: 10px; font-weight: 700; color: var(--gold); background: var(--gold-soft); border-radius: 4px; padding: 0 4px; }
    .main { min-width: 0; }
    .head { display: flex; align-items: center; gap: 16px; }
    .big { width: 64px; height: 64px; border-radius: 12px; border: 2px solid var(--gold); }
    .grow { flex: 1; min-width: 0; }
    .head .grow { gap: 8px; }
    .controls { gap: 12px; flex-wrap: wrap; }
    .seg { display: flex; }
    .seg button { border-radius: 0; padding: 5px 12px; }
    .seg button:first-child { border-radius: 8px 0 0 8px; }
    .seg button:last-child { border-radius: 0 8px 8px 0; }
    .seg button + button { border-left: none; }
    .seg button.on { background: var(--gold-soft); border-color: var(--gold); color: var(--gold); }
    .note { margin: 10px 0 0; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-top: 16px; align-items: start; }
    .card.stack { gap: 8px; }
    h3 { margin: 0; }
    .small { font-size: 12.5px; margin: 0; }
    .strong { font-weight: 600; }
    .saved { align-items: flex-start; }
    .perks { display: flex; gap: 3px; margin-top: 6px; flex-wrap: wrap; }
    .perks img { width: 22px; height: 22px; }
    .items { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 4px; }
    .items li { display: flex; align-items: center; gap: 10px; padding: 5px 8px; background: var(--bg-sunken); border-radius: 8px; }
    .items img, .results img { width: 28px; height: 28px; border-radius: 6px; border: 1px solid var(--line-strong); }
    .idx { width: 16px; text-align: right; }
    .add input { width: 100%; }
    .results { display: flex; flex-direction: column; gap: 2px; margin-top: 6px; max-height: 260px; overflow: auto; }
    .results button { display: flex; align-items: center; gap: 10px; text-align: left; background: none; border-color: transparent; }
    .results button:hover { background: var(--bg-sunken); }
    .empty { max-width: 560px; margin: 40px auto; text-align: center; }
    @media (max-width: 1000px) { .grid { grid-template-columns: 1fr; } }
  `,
})
export class ChampionsView {
  protected readonly rift = inject(RiftService);
  protected readonly roles_ = ROLES;
  protected readonly query = signal('');
  protected readonly itemQuery = signal('');
  protected readonly recState = signal<RecState | null>(null);
  protected readonly pageMsg = signal<{ text: string; bad: boolean } | null>(null);
  protected readonly pick = this.rift.championsPick;
  private lookupSeq = 0;

  protected readonly game = this.rift.championsGame;
  protected readonly list = computed(() => {
    const q = this.query().trim().toLowerCase();
    const classic = this.game() === 'classic';
    return [...(this.rift.statics()?.champions ?? [])]
      .filter((c) => c.classic === classic)
      .filter((c) => !q || c.name.toLowerCase().includes(q) || c.alias.toLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name));
  });
  protected readonly isClassic = computed(() => {
    const id = this.pick()?.championId;
    return this.rift.statics()?.champions.find((c) => c.id === id)?.classic ?? false;
  });
  /** Separate from config() so saving a page or build doesn't refetch. */
  private readonly opggOn = computed(() => this.rift.config()?.recSource === 'opgg');
  protected readonly roles = computed(() => {
    const id = this.pick()?.championId;
    return rolesLabel(this.rift.statics()?.champions.find((c) => c.id === id));
  });
  protected readonly savedPage = computed<RunePage | null>(() => {
    const id = this.pick()?.championId;
    return (id && this.rift.config()?.runeOverrides[String(id)]) || null;
  });
  protected readonly build = computed(() => {
    const id = this.pick()?.championId;
    return (id && this.rift.config()?.builds[String(id)]) || [];
  });
  protected readonly matches = computed(() => {
    const q = this.itemQuery().trim().toLowerCase();
    if (q.length < 2) return [];
    return (this.rift.statics()?.items ?? []).filter((i) => i.name.toLowerCase().includes(q)).slice(0, 12);
  });

  protected icon = championIcon;

  constructor() {
    // Start on your champ select pick if there is one.
    const cs = this.rift.champSelect();
    if (!this.pick() && cs?.myChampionId) this.select(cs.myChampionId);
    effect(() => {
      const p = this.pick();
      if (p && this.opggOn() && !this.isClassic()) untracked(() => this.load(p.championId, p.position, p.mode));
      else this.recState.set(null);
    });
  }

  private async load(championId: number, position: string, mode: 'ranked' | 'aram'): Promise<void> {
    const seq = ++this.lookupSeq;
    const base: RecState = { championId, position, loading: true, rec: null, error: null };
    this.recState.set(base);
    try {
      const rec = await this.rift.lookupRec(championId, position, mode);
      if (seq === this.lookupSeq) this.recState.set({ ...base, loading: false, rec });
    } catch (e) {
      if (seq === this.lookupSeq) this.recState.set({ ...base, loading: false, error: String(e) });
    }
  }

  select(championId: number): void {
    const classic = this.rift.statics()?.champions.find((c) => c.id === championId)?.classic;
    if (classic !== undefined) this.game.set(classic ? 'classic' : 'league');
    const prev = this.pick();
    this.pick.set({ championId, position: prev?.position ?? 'middle', mode: prev?.mode ?? 'ranked' });
    this.itemQuery.set('');
    this.pageMsg.set(null);
  }
  setRole(position: string): void {
    const p = this.pick();
    if (p) this.pick.set({ ...p, position });
  }
  setMode(mode: 'ranked' | 'aram'): void {
    const p = this.pick();
    if (p) this.pick.set({ ...p, mode });
  }

  hasPage(id: number): boolean {
    return !!this.rift.config()?.runeOverrides[String(id)];
  }
  hasBuild(id: number): boolean {
    return (this.rift.config()?.builds[String(id)] ?? []).length > 0;
  }
  styleName(id: number): string {
    return this.rift.styleById().get(id)?.name ?? `#${id}`;
  }
  perkName(id: number): string {
    return this.rift.perkById().get(id)?.name ?? '';
  }
  perkIcon(id: number): string {
    return assetUrl(this.rift.perkById().get(id)?.iconPath);
  }
  item(id: number): ItemInfo | undefined {
    return this.rift.itemById().get(id);
  }
  itemIcon(it: ItemInfo): string {
    return assetUrl(it.iconPath);
  }

  async savePage(championId: number): Promise<void> {
    try {
      const page = await this.rift.saveCurrentPageFor(championId);
      this.pageMsg.set({ text: `Saved "${page.name}" for ${this.rift.champName(championId)}.`, bad: false });
    } catch (e) {
      this.pageMsg.set({ text: String(e), bad: true });
    }
  }
  removePage(championId: number): void {
    this.pageMsg.set(null);
    this.rift.updateConfig((c) => {
      delete c.runeOverrides[String(championId)];
      return c;
    });
  }

  private editBuild(fn: (b: number[]) => number[]): void {
    const id = this.pick()?.championId;
    if (!id) return;
    this.rift.updateConfig((c) => {
      const next = fn([...(c.builds[String(id)] ?? [])]);
      if (next.length) c.builds[String(id)] = next;
      else delete c.builds[String(id)];
      return c;
    });
  }
  add(itemId: number): void {
    this.editBuild((b) => [...b, itemId]);
    this.itemQuery.set('');
  }
  removeAt(i: number): void {
    this.editBuild((b) => b.filter((_, j) => j !== i));
  }
  move(i: number, d: number): void {
    this.editBuild((b) => {
      const j = i + d;
      [b[i], b[j]] = [b[j], b[i]];
      return b;
    });
  }
}
