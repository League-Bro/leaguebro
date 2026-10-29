import { AfterViewInit, ChangeDetectionStrategy, Component, ElementRef, OnInit, computed, effect, inject, input, output, signal, viewChild } from '@angular/core';
import { RiftService } from '../core/rift.service';
import { championIcon } from '../core/assets';
import { ChampInfo, PlayerHit } from '../core/models';
import { MOD_KEY } from '../core/platform';
import { Loader } from './loader';

const MAX_RESULTS = 8;

/** A row in the results: a champion, or a player (a friend, or a lookup of the typed name with no puuid). */
type Option =
  | { kind: 'champ'; key: string; c: ChampInfo }
  | { kind: 'player'; key: string; puuid: string | null; name: string; friend: boolean };

/** "Kai'Sa" → "kaisa", so searches ignore case, spaces and punctuation. */
function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Jump to any champion's build or guide from any tab: Ctrl+K (Cmd+K on a Mac), the header's search
 * button, or just start typing. Favorites come first; Enter opens the build, Shift+Enter the guide.
 * Players come after the champions: friends and players from games seen this session whose Riot ID
 * matches, then a lookup of the name as typed
 * (with or without its #TAG), which opens their profile.
 */
@Component({
  selector: 'rl-champion-search',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Loader],
  template: `
    <div class="backdrop" (mousedown)="closed.emit()"></div>
    <div class="box card" role="dialog" aria-label="Find a champion or player">
      <div class="field">
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
        <input #field type="text" placeholder="Find a champion or player…" autocomplete="off" spellcheck="false"
               role="combobox" aria-controls="champ-results" [attr.aria-activedescendant]="'champ-opt-' + active()"
               [value]="query()" (input)="setQuery($any($event.target).value)" (keydown)="key($event)" />
        <kbd>Esc</kbd>
      </div>
      <div id="champ-results" class="results" role="listbox">
        @for (o of options(); track o.key; let i = $index) {
          @if (o.kind === 'champ') {
            <div class="opt" role="option" [id]="'champ-opt-' + i" [class.on]="i === active()" [attr.aria-selected]="i === active()"
                 (mousemove)="active.set(i)" (click)="pick(o.c, 'build')">
              <img class="champ-icon sm" [src]="icon(o.c.id)" alt="" />
              <span class="name">{{ o.c.name }}</span>
              @if (o.c.classic) { <span class="tag">League Classic</span> }
              @if (favorites().has(o.c.id)) { <span class="star" title="Favorite">★</span> }
              <span class="spacer"></span>
              <button class="ghost mini" [class.lead]="i === active()" (click)="$event.stopPropagation(); pick(o.c, 'build')">Build</button>
              <button class="ghost mini" (click)="$event.stopPropagation(); pick(o.c, 'guide')">Guide</button>
            </div>
          } @else {
            @if (i === firstPlayer()) { <div class="group faint">Players</div> }
            <div class="opt" role="option" [id]="'champ-opt-' + i" [class.on]="i === active()" [attr.aria-selected]="i === active()"
                 (mousemove)="active.set(i)" (click)="openPlayer(o)">
              <span class="person" aria-hidden="true"><svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8" /></svg></span>
              <span class="name">{{ o.name }}</span>
              <span class="tag">{{ o.friend ? 'Friend' : o.key.startsWith('n') ? 'Player' : o.puuid ? 'From a recent game' : 'Look up player' }}</span>
              <span class="spacer"></span>
              <button class="ghost mini" [class.lead]="i === active()" (click)="$event.stopPropagation(); openPlayer(o)">Profile</button>
            </div>
          }
        } @empty {
          @if (checking()) {
          } @else if (!rift.statics()) {
            <rl-loader [block]="true" class="faint">Loading champions…</rl-loader>
          } @else {
            <p class="faint none">Type a champion or a player's name.</p>
          }
        }
        @if (checking()) { <rl-loader [block]="true" class="faint small">Checking who's called "{{ query().trim() }}"…</rl-loader> }
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
    .group { margin: 6px 8px 2px; font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.08em; }
    .person { display: grid; place-items: center; width: 28px; height: 28px; border-radius: 50%; background: var(--bg-sunken); border: 1px solid var(--line-strong); }
    .person svg { width: 16px; height: 16px; fill: none; stroke: var(--text-dim); stroke-width: 2; stroke-linecap: round; }
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

  /** Players matching the search (friends and players from recent games), for the player rows. */
  private readonly friends = signal<PlayerHit[]>([]);
  private friendSeq = 0;
  /** Accounts called exactly what was typed, under common tags (asked once typing pauses). */
  private readonly named = signal<PlayerHit[]>([]);
  protected readonly checking = signal(false);

  protected readonly results = computed<ChampInfo[]>(() => {
    // A #TAG means a player, not a champion.
    if (this.query().includes('#')) return [];
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

  /** Champions, then players: matching friends, then a lookup of what was typed (2+ characters). */
  protected readonly options = computed<Option[]>(() => {
    const champs: Option[] = this.results().map((c) => ({ kind: 'champ', key: `c${c.id}`, c }));
    const typed = this.query().trim();
    const friends = this.friends();
    const players: Option[] = friends.map((f) => ({ kind: 'player', key: `p${f.puuid}`, puuid: f.puuid, name: f.name, friend: f.friend }));
    for (const n of this.named()) {
      if (!players.some((p) => p.kind === 'player' && p.puuid === n.puuid)) {
        players.push({ kind: 'player', key: `n${n.puuid}`, puuid: n.puuid, name: n.name, friend: false });
      }
    }
    // A lookup of exactly what was typed, unless a row above already is that player.
    const shown = players.some((p) => p.kind === 'player' && p.name.toLowerCase() === typed.toLowerCase());
    if (typed.length >= 2 && !typed.endsWith('#') && !shown && !this.checking()) {
      players.push({ kind: 'player', key: 'lookup', puuid: null, name: typed, friend: false });
    }
    return [...champs, ...players];
  });
  protected readonly firstPlayer = computed(() => this.options().findIndex((o) => o.kind === 'player'));

  constructor() {
    // Players are asked once typing pauses; an answer for an older search is dropped.
    effect((onCleanup) => {
      const q = this.query().trim();
      const seq = ++this.friendSeq;
      if (!q) {
        this.friends.set([]);
        this.named.set([]);
        this.checking.set(false);
        return;
      }
      const timer = setTimeout(async () => {
        const hits = await this.rift.searchPlayers(q).catch(() => []);
        if (seq === this.friendSeq) this.friends.set(hits);
      }, 120);
      // A full name (3+ characters, no #TAG): which tags it exists under.
      const name = q.length >= 3 && !q.includes('#');
      this.named.set([]);
      this.checking.set(name);
      const nameTimer = name
        ? setTimeout(async () => {
            const hits = await this.rift.playersNamed(q).catch(() => []);
            if (seq !== this.friendSeq) return;
            this.named.set(hits);
            this.checking.set(false);
          }, 400)
        : undefined;
      onCleanup(() => {
        clearTimeout(timer);
        clearTimeout(nameTimer);
      });
    });
  }

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
    const n = this.options().length;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (n) this.active.update((i) => (i + (e.key === 'ArrowDown' ? 1 : n - 1)) % n);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const o = this.options()[this.active()];
      if (o?.kind === 'champ') this.pick(o.c, e.shiftKey ? 'guide' : 'build');
      else if (o) this.openPlayer(o);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      this.closed.emit();
    }
  }

  protected openPlayer(p: { puuid: string | null; name: string }): void {
    this.closed.emit();
    this.rift.showPlayer({ puuid: p.puuid, riotId: p.name });
  }

  protected pick(c: ChampInfo, view: 'build' | 'guide'): void {
    this.closed.emit();
    void this.rift.showChampion(c.id, { view });
  }
}
