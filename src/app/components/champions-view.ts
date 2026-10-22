import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { RiftService } from '../core/rift.service';
import { RecCard } from './rec-card';
import { championIcon } from '../core/assets';
import { RecState } from '../core/models';
import { rolesLabel } from '../core/why';

const ROLES = [
  { id: 'top', label: 'Top' },
  { id: 'jungle', label: 'Jungle' },
  { id: 'middle', label: 'Mid' },
  { id: 'bottom', label: 'Bot' },
  { id: 'utility', label: 'Support' },
];

/** Look up any champion's OP.GG build. */
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
            </button>
          } @empty {
            <p class="faint small">{{ rift.statics() ? 'No champion matches.' : 'Champions load once the League client is open.' }}</p>
          }
        </div>
      </aside>

      <div class="main">
        @if (pick(); as p) {
          <section class="card head">
            @if (rift.champSplash(p.championId); as splash) {
              <div class="splash"><img [src]="splash" alt="" /></div>
            }
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
            <p class="faint small note">OP.GG recommendations are off (Settings → Recommendations).</p>
          }
          <rl-rec-card [lookup]="recState()" />
          }
        } @else {
          <section class="card empty">
            <h2>Pick a champion</h2>
            <p class="muted">See OP.GG's runes, spells, skill order and build for any champion and role, without being in champ select.</p>
          </section>
        }
      </div>
    </div>
  `,
  styles: `
    .layout { display: grid; grid-template-columns: 240px 1fr; gap: 16px; align-items: start; }
    aside { position: sticky; top: 0; display: flex; flex-direction: column; gap: 8px; max-height: calc(100vh - 140px); }
    .filter { width: 100%; }
    .seg.game { display: flex; }
    .seg.game button { flex: 1; padding: 5px 6px; white-space: nowrap; font-size: 12.5px; }
    .classic-tag {
      margin-left: 10px; vertical-align: middle; font-size: 10.5px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase;
      color: var(--text-dim); background: var(--bg-sunken); border: 1px solid var(--line-strong); border-radius: 999px; padding: 2px 9px;
    }
    .classic-note { margin-top: 16px; }
    .classic-note p { margin: 0; }
    .list { display: flex; flex-direction: column; gap: 1px; overflow: auto; margin: 0 -6px; padding: 0 6px; }
    .champ { display: flex; align-items: center; gap: 9px; background: none; border-color: transparent; text-align: left; padding: 4px 6px; }
    .champ:hover { background: var(--bg-sunken); }
    .champ.active { background: var(--accent-soft); border-color: transparent; color: var(--accent); font-weight: 600; }
    .cname { flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .main { min-width: 0; }
    .head { position: relative; display: flex; align-items: center; gap: 18px; padding: 22px; }
    .head > :not(.splash) { position: relative; }
    .head h2 { font-size: 24px; }
    .big { width: 72px; height: 72px; border-radius: 18px; border: 2px solid var(--accent); box-shadow: 0 0 22px var(--accent-glow); }
    .grow { flex: 1; min-width: 0; }
    .head .grow { gap: 8px; }
    .controls { gap: 12px; flex-wrap: wrap; }
    .note { margin: 10px 0 0; }
    .small { font-size: 12.5px; margin: 0; }
    .empty { max-width: 560px; margin: 40px auto; text-align: center; }
  `,
})
export class ChampionsView {
  protected readonly rift = inject(RiftService);
  protected readonly roles_ = ROLES;
  protected readonly query = signal('');
  protected readonly recState = signal<RecState | null>(null);
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
  /** Separate from config() so changing another setting doesn't refetch. */
  private readonly opggOn = computed(() => this.rift.config()?.recSource === 'opgg');
  protected readonly roles = computed(() => {
    const id = this.pick()?.championId;
    return rolesLabel(this.rift.statics()?.champions.find((c) => c.id === id));
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
  }
  setRole(position: string): void {
    const p = this.pick();
    if (p) this.pick.set({ ...p, position });
  }
  setMode(mode: 'ranked' | 'aram'): void {
    const p = this.pick();
    if (p) this.pick.set({ ...p, mode });
  }
}
