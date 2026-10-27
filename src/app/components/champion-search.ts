import { AfterViewInit, ChangeDetectionStrategy, Component, ElementRef, OnInit, computed, inject, input, output, signal, viewChild } from '@angular/core';
import { RiftService } from '../core/rift.service';
import { championIcon } from '../core/assets';
import { ChampInfo } from '../core/models';
import { MOD_KEY } from '../core/platform';
import { Loader } from './loader';

const MAX_RESULTS = 8;

/** "Kai'Sa" → "kaisa", so searches ignore case, spaces and punctuation. */
function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Jump to any champion's build or guide from any tab: Ctrl+K (Cmd+K on a Mac), the header's search
 * button, or just start typing. Favorites come first; Enter opens the build, Shift+Enter the guide.
 */
@Component({
  selector: 'rl-champion-search',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Loader],
  template: `
    <div class="backdrop" (mousedown)="closed.emit()"></div>
    <div class="box card" role="dialog" aria-label="Find a champion">
      <div class="field">
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
        <input #field type="text" placeholder="Find a champion…" autocomplete="off" spellcheck="false"
               role="combobox" aria-controls="champ-results" [attr.aria-activedescendant]="'champ-opt-' + active()"
               [value]="query()" (input)="setQuery($any($event.target).value)" (keydown)="key($event)" />
        <kbd>Esc</kbd>
      </div>
      <div id="champ-results" class="results" role="listbox">
        @for (c of results(); track c.id; let i = $index) {
          <div class="opt" role="option" [id]="'champ-opt-' + i" [class.on]="i === active()" [attr.aria-selected]="i === active()"
               (mousemove)="active.set(i)" (click)="pick(c, 'build')">
            <img class="champ-icon sm" [src]="icon(c.id)" alt="" />
            <span class="name">{{ c.name }}</span>
            @if (c.classic) { <span class="tag">League Classic</span> }
            @if (favorites().has(c.id)) { <span class="star" title="Favorite">★</span> }
            <span class="spacer"></span>
            <button class="ghost mini" [class.lead]="i === active()" (click)="$event.stopPropagation(); pick(c, 'build')">Build</button>
            <button class="ghost mini" (click)="$event.stopPropagation(); pick(c, 'guide')">Guide</button>
          </div>
        } @empty {
          @if (rift.statics()) {
            <p class="faint none">No champion matches "{{ query() }}".</p>
          } @else {
            <rl-loader [block]="true" class="faint">Loading champions…</rl-loader>
          }
        }
      </div>
      <div class="foot faint"><kbd>↑</kbd><kbd>↓</kbd> choose · <kbd>Enter</kbd> build · <kbd>Shift+Enter</kbd> guide · <kbd>{{ modKey }}K</kbd> from any tab</div>
    </div>
  `,
  styles: `
    :host { position: fixed; inset: 0; z-index: 50; display: flex; justify-content: center; align-items: flex-start; padding-top: 12vh; }
    .backdrop { position: absolute; inset: 0; background: rgba(8, 7, 12, 0.55); backdrop-filter: blur(2px); }
    .box { position: relative; width: min(520px, calc(100vw - 32px)); padding: 0; overflow: hidden; box-shadow: 0 24px 60px rgba(0, 0, 0, 0.5); }
    .field { display: flex; align-items: center; gap: 10px; padding: 12px 14px; border-bottom: 1px solid var(--line); }
    .field svg { width: 18px; height: 18px; flex: none; fill: none; stroke: var(--text-faint); stroke-width: 2; stroke-linecap: round; }
    .field input { flex: 1; min-width: 0; background: none; border: none; outline: none; box-shadow: none; padding: 4px 0; font-size: 16px; color: var(--text); }
    .results { max-height: 360px; overflow: auto; padding: 6px; }
    .opt { display: flex; align-items: center; gap: 10px; padding: 6px 8px; border-radius: var(--radius-sm); cursor: pointer; }
    .opt.on { background: var(--accent-soft); }
    .opt .name { font-weight: 600; }
    .opt .spacer { flex: 1; }
    .tag { font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-dim); }
    .star { color: var(--accent); }
    .mini { padding: 2px 10px; font-size: 12px; }
    .mini.lead { color: var(--accent); border-color: var(--accent); }
    .none { margin: 10px 8px; font-size: 13px; }
    .foot { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; padding: 8px 14px; border-top: 1px solid var(--line); font-size: 12px; }
    kbd { font: 500 11px var(--mono); color: var(--text-dim); background: var(--bg-sunken); border: 1px solid var(--line-strong); border-radius: 5px; padding: 1px 5px; }
  `,
})
export class ChampionSearch implements OnInit, AfterViewInit {
  protected readonly rift = inject(RiftService);
  /** What was typed to open it (typing on a page starts the search with that letter). */
  readonly initial = input('');
  readonly closed = output<void>();

  protected readonly modKey = MOD_KEY;
  protected readonly icon = championIcon;
  protected readonly query = signal('');
  protected readonly active = signal(0);
  private readonly field = viewChild.required<ElementRef<HTMLInputElement>>('field');

  protected readonly favorites = computed(() => new Set(this.rift.config()?.favoriteChampions ?? []));

  protected readonly results = computed<ChampInfo[]>(() => {
    const q = norm(this.query());
    const favs = this.favorites();
    // Favorites, then names starting with the search, then the rest; League Classic copies after the normal ones.
    const score = (c: ChampInfo) => {
      const name = norm(c.name);
      const alias = norm(c.alias);
      if (q && !name.includes(q) && !alias.includes(q)) return -1;
      return (favs.has(c.id) ? 4 : 0) + (q && (name.startsWith(q) || alias.startsWith(q)) ? 2 : 0) + (c.classic ? 0 : 1);
    };
    return (this.rift.statics()?.champions ?? [])
      .filter((c) => q || !c.classic)
      .map((c) => ({ c, s: score(c) }))
      .filter((x) => x.s >= 0)
      .sort((a, b) => b.s - a.s || a.c.name.localeCompare(b.c.name))
      .slice(0, MAX_RESULTS)
      .map((x) => x.c);
  });

  ngOnInit(): void {
    this.query.set(this.initial());
    // Start finding champions' main lanes now, so opening a build doesn't wait for it.
    void this.rift.mainLane(0);
  }

  ngAfterViewInit(): void {
    this.field().nativeElement.focus();
  }

  protected setQuery(q: string): void {
    this.query.set(q);
    this.active.set(0);
  }

  protected key(e: KeyboardEvent): void {
    const n = this.results().length;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (n) this.active.update((i) => (i + (e.key === 'ArrowDown' ? 1 : n - 1)) % n);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const c = this.results()[this.active()];
      if (c) this.pick(c, e.shiftKey ? 'guide' : 'build');
    } else if (e.key === 'Escape') {
      e.preventDefault();
      this.closed.emit();
    }
  }

  protected pick(c: ChampInfo, view: 'build' | 'guide'): void {
    this.closed.emit();
    void this.rift.showChampion(c.id, { view });
  }
}
