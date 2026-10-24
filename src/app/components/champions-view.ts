import { ChangeDetectionStrategy, Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { RiftService } from '../core/rift.service';
import { RecCard } from './rec-card';
import { GuideCard } from './guide-card';
import { ChampionList } from './champion-list';
import { championIcon } from '../core/assets';
import { RecChoice, RecState } from '../core/models';
import { rolesLabel } from '../core/why';

const ROLES = [
  { id: 'top', label: 'Top' },
  { id: 'jungle', label: 'Jungle' },
  { id: 'middle', label: 'Mid' },
  { id: 'bottom', label: 'Bot' },
  { id: 'utility', label: 'Support' },
];

/** Browse every champion's ranked stats, then open one for its OP.GG build or a beginner's guide to it. */
@Component({
  selector: 'rl-champions',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RecCard, GuideCard, ChampionList],
  template: `
    @if (pick(); as p) {
      <div class="detail">
        <button class="ghost back" (click)="pick.set(null)">← All champions</button>
        <section class="card head">
          @if (rift.champSplash(p.championId); as splash) {
            <div class="splash"><img [src]="splash" alt="" /></div>
          }
          <img class="big" [src]="icon(p.championId)" alt="" />
          <div class="stack grow">
            <div>
              <h2>
                {{ rift.champName(p.championId) }}@if (isClassic()) { <span class="classic-tag">League Classic</span> }
                <button class="star head-star" [class.on]="isFavorite(p.championId)"
                        [title]="isFavorite(p.championId) ? 'Remove from favorites' : 'Add to favorites'"
                        (click)="toggleFavorite(p.championId)">{{ isFavorite(p.championId) ? '★' : '☆' }}</button>
              </h2>
              @if (roles()) { <div class="muted small">{{ roles() }}</div> }
            </div>
            <div class="row controls">
              <div class="seg view" role="tablist" aria-label="Champion page">
                <button role="tab" [class.on]="view() === 'build'" [attr.aria-selected]="view() === 'build'" (click)="view.set('build')">Build</button>
                <button role="tab" [class.on]="view() === 'guide'" [attr.aria-selected]="view() === 'guide'" (click)="view.set('guide')">Guide</button>
              </div>
              @if (view() === 'build' && !isClassic()) {
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
              }
            </div>
          </div>
        </section>

        @if (view() === 'guide') {
          <rl-guide [championId]="p.championId" />
        } @else if (isClassic()) {
          <section class="card classic-note">
            <p class="muted">OP.GG has no League Classic stats, so there's no recommended build for League Classic champions.</p>
          </section>
        } @else {
          @if (rift.config()?.recSource !== 'opgg') {
            <p class="faint small note">OP.GG recommendations are off (Settings → Recommendations).</p>
          }
          <rl-rec-card [lookup]="recState()" (choiceChange)="pickOption($event)" />
        }
      </div>
    } @else {
      <rl-champion-list (open)="select($event.championId, $event.position)" />
    }
  `,
  styles: `
    .detail { max-width: 1180px; margin: 0 auto; }
    .back { margin: 0 0 10px -6px; }
    .classic-tag {
      margin-left: 10px; vertical-align: middle; font-size: 10.5px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase;
      color: var(--text-dim); background: var(--bg-sunken); border: 1px solid var(--line-strong); border-radius: 999px; padding: 2px 9px;
    }
    .classic-note { margin-top: 16px; }
    .classic-note p { margin: 0; }
    .star { background: none; border-color: transparent; color: var(--text-dim); padding: 2px 6px; font-size: 15px; line-height: 1; }
    .star:hover { color: var(--accent); }
    .star.on { color: var(--accent); }
    .head-star { margin-left: 6px; vertical-align: middle; font-size: 20px; }
    .head { position: relative; display: flex; align-items: center; gap: 18px; padding: 22px; }
    .head > :not(.splash) { position: relative; }
    .head h2 { font-size: 24px; }
    .big { width: 72px; height: 72px; border-radius: 18px; border: 2px solid var(--accent); box-shadow: 0 0 22px var(--accent-glow); }
    .grow { flex: 1; min-width: 0; }
    .head .grow { gap: 8px; }
    .controls { gap: 12px; flex-wrap: wrap; }
    .note { margin: 10px 0 0; }
    .small { font-size: 12.5px; margin: 0; }
  `,
})
export class ChampionsView {
  protected readonly rift = inject(RiftService);
  protected readonly roles_ = ROLES;
  protected readonly recState = signal<RecState | null>(null);

  /** Shows another rune page, spells or build (nothing is imported from here). */
  async pickOption(choice: RecChoice): Promise<void> {
    const s = this.recState();
    if (!s?.rec) return;
    const rec = await this.rift.recWithChoice(s.rec, choice);
    // Ignore it if the champion or role changed meanwhile.
    if (this.recState() === s) this.recState.set({ ...s, rec, choice });
  }
  protected readonly pick = this.rift.championsPick;
  private lookupSeq = 0;

  protected readonly game = this.rift.championsGame;
  protected readonly view = this.rift.championsView;
  private readonly favoriteIds = computed(() => new Set(this.rift.config()?.favoriteChampions ?? []));
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
    const base: RecState = { championId, position, loading: true, rec: null, error: null, choice: { runes: 0, spells: 0, core: 0, boots: 0 } };
    this.recState.set(base);
    try {
      const rec = await this.rift.lookupRec(championId, position, mode);
      if (seq === this.lookupSeq) this.recState.set({ ...base, loading: false, rec });
    } catch (e) {
      if (seq === this.lookupSeq) this.recState.set({ ...base, loading: false, error: String(e) });
    }
  }

  select(championId: number, position?: string): void {
    const classic = this.rift.statics()?.champions.find((c) => c.id === championId)?.classic;
    if (classic !== undefined) this.game.set(classic ? 'classic' : 'league');
    const prev = this.pick();
    this.pick.set({ championId, position: position ?? prev?.position ?? 'middle', mode: prev?.mode ?? 'ranked' });
  }
  isFavorite(championId: number): boolean {
    return this.favoriteIds().has(championId);
  }
  toggleFavorite(championId: number): void {
    void this.rift.updateConfig((c) => ({
      ...c,
      favoriteChampions: c.favoriteChampions.includes(championId)
        ? c.favoriteChampions.filter((id) => id !== championId)
        : [...c.favoriteChampions, championId],
    }));
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
