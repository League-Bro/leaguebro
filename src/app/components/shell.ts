import { ChangeDetectionStrategy, Component, OnInit, computed, effect, inject, signal, untracked } from '@angular/core';
import { RiftService } from '../core/rift.service';
import { UpdateService } from '../core/update.service';
import { IS_MAC, MOD_KEY } from '../core/platform';
import { LiveView } from './live-view';
import { ChampionsView } from './champions-view';
import { SettingsView } from './settings-view';
import { PatchView } from './patch-view';
import { ProfileView } from './profile-view';
import { FeedbackView } from './feedback-view';
import { ItemTipPopup } from './item-tip';
import { ChampionSearch } from './champion-search';
import { UpdateSplash } from './update-splash';

/** 'profile' isn't in the tab bar; the brand and your name open it. */
type Tab = 'live' | 'champions' | 'patch' | 'settings' | 'feedback' | 'profile';

/** A key press aimed at a text field, which typing-to-search must leave alone. */
function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return !!el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName));
}

const PHASE_LABELS: Record<string, string> = {
  None: 'In client',
  Lobby: 'In lobby',
  Matchmaking: 'In queue',
  ReadyCheck: 'Match found',
  ChampSelect: 'Champ select',
  GameStart: 'Loading',
  InProgress: 'In game',
  Reconnect: 'Reconnecting',
  WaitingForStats: 'Game over',
  PreEndOfGame: 'Game over',
  EndOfGame: 'Game over',
};

/** Client phases from joining a lobby to closing the end-of-game screen. */
const BUSY_PHASES = new Set(Object.keys(PHASE_LABELS).filter((p) => p !== 'None'));

@Component({
  selector: 'rl-shell',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [LiveView, ChampionsView, PatchView, SettingsView, FeedbackView, ProfileView, ItemTipPopup, ChampionSearch, UpdateSplash],
  template: `
    <header>
      <button class="brand" [class.active]="tab() === 'profile'" title="Your profile and match history" (click)="go('profile')">
        <img src="favicon.png" alt="" />
        <span>League Bro</span>
      </button>
      <nav>
        @for (t of tabs; track t.id) {
          <button [class.active]="tab() === t.id" [title]="t.label + ' (' + modKey + ($index + 1) + ')'" (click)="go(t.id)">
            {{ t.label }}
            @if (t.id === 'live' && tab() !== 'live' && liveActivity(); as what) {
              <span class="live-dot" [title]="what"></span>
            }
          </button>
        }
      </nav>
      <div class="spacer"></div>
      <button class="find" [title]="'Find a champion (' + modKey + 'K, or just start typing)'" (click)="openSearch('')">
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
        <span>Find a champion</span>
        <kbd>{{ modKey }}K</kbd>
      </button>
      <div class="status" [class.on]="rift.status().connected">
        <span class="dot"></span>
        <span>{{ statusText() }}</span>
        @if (rift.status().summoner; as s) {
          <button class="who" title="Your profile and match history" (click)="go('profile')">{{ s.name }}</button>
        }
      </div>
      @if (updates.version(); as v) {
        <span class="version" title="League Bro version">v{{ v }}</span>
      }
    </header>
    @if (rift.demo) {
      <div class="demo-bar">Demo data: this is the browser preview. Run it with <code>npm run tauri dev</code> to connect to League.</div>
    }
    @switch (updates.state().kind) {
      @case ('available') {
        <div class="update-bar">
          <span>League Bro {{ $any(updates.state()).version }} is available.</span>
          <button class="primary" (click)="updates.install()">Update and restart</button>
          <button class="ghost" (click)="updates.dismiss()">Later</button>
        </div>
      }
      @case ('error') {
        <div class="update-bar bad">
          <span>Update failed: {{ $any(updates.state()).message }}</span>
          <button class="ghost" (click)="updates.dismiss()">Dismiss</button>
        </div>
      }
    }
    <main>
      @if (backTo(); as b) {
        <button class="back" title="Back (Alt+←)" (click)="back()">← Back to {{ label(b) }}</button>
      }
      @switch (tab()) {
        @case ('live') { <rl-live (open)="go($event)" /> }
        @case ('champions') { <rl-champions /> }
        @case ('patch') { <rl-patch /> }
        @case ('settings') { <rl-settings /> }
        @case ('feedback') { <rl-feedback /> }
        @case ('profile') { <rl-profile /> }
      }
    </main>
    <rl-item-tip />
    <rl-update-splash />
    @if (search(); as s) {
      <rl-champion-search [initial]="s.text" (closed)="search.set(null)" />
    }
  `,
  host: {
    '(document:keydown.alt.arrowleft)': 'back()',
    '(document:mouseup)': 'mouseBack($event)',
    '(document:keydown)': 'tabKey($event)',
  },
  styles: `
    :host { display: flex; flex-direction: column; height: 100vh; }
    header {
      display: flex; align-items: center; gap: 22px;
      padding: 0 20px; height: 64px; flex: none;
      border-bottom: 1px solid var(--line);
      background: rgba(15, 13, 20, 0.7);
      backdrop-filter: blur(14px);
    }
    .brand {
      display: flex; align-items: center; gap: 10px; font: 800 15px var(--display); letter-spacing: 0.01em;
      background: none; border: none; padding: 4px 12px 4px 6px; margin-left: -6px; color: var(--text);
    }
    .brand:hover:not(:disabled), .brand.active { background: var(--accent-soft); color: var(--accent); }
    .brand img { width: 28px; height: 28px; filter: drop-shadow(0 0 8px var(--accent-glow)); }
    nav {
      display: flex; gap: 2px; padding: 4px;
      background: var(--bg-sunken); border: 1px solid var(--line); border-radius: 999px;
    }
    nav button { position: relative; background: none; border: none; padding: 6px 16px; color: var(--text-dim); font-weight: 500; }
    .live-dot {
      position: absolute; top: 5px; right: 7px; width: 7px; height: 7px; border-radius: 50%;
      background: var(--accent); box-shadow: 0 0 8px var(--accent-glow); animation: pulse 1.4s ease-in-out infinite;
    }
    @keyframes pulse { 50% { opacity: 0.35; } }
    nav button:hover:not(:disabled) { color: var(--text); background: var(--bg-hover); }
    nav button.active, nav button.active:hover:not(:disabled) {
      color: var(--on-accent); background: var(--accent); font-weight: 600; box-shadow: 0 2px 14px var(--accent-glow);
    }
    .status {
      display: flex; align-items: center; gap: 8px; color: var(--text-dim); font-size: 13px;
      padding: 6px 14px; border: 1px solid var(--line); border-radius: 999px; background: var(--bg-hover);
    }
    .status .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--text-faint); }
    .status.on .dot { background: var(--win); box-shadow: 0 0 8px var(--win); }
    .status .who {
      color: var(--text); font: inherit; font-weight: 600; padding: 0 0 0 10px;
      border: none; border-left: 1px solid var(--line-strong); border-radius: 0; background: none;
    }
    .status .who:hover:not(:disabled) { color: var(--accent-2); background: none; border-color: var(--line-strong); }
    .find {
      display: flex; align-items: center; gap: 8px; padding: 6px 8px 6px 12px; border-radius: 999px;
      color: var(--text-faint); background: var(--bg-sunken); border: 1px solid var(--line); font-weight: 400;
    }
    .find:hover:not(:disabled) { color: var(--text); border-color: var(--line-strong); }
    .find svg { width: 15px; height: 15px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; }
    .find kbd { font: 500 11px var(--mono); color: var(--text-dim); border: 1px solid var(--line-strong); border-radius: 5px; padding: 0 5px; }
    @media (max-width: 1180px) { .find span { display: none; } }
    @media (max-width: 980px) { .find kbd { display: none; } .find { padding: 7px; } }
    .version { color: var(--text-faint); font: 500 12px var(--mono); margin-left: -12px; }
    .demo-bar { background: var(--gold-soft); color: var(--gold); font-size: 12.5px; padding: 6px 20px; }
    .demo-bar code { font-family: var(--mono); }
    .update-bar {
      display: flex; align-items: center; gap: 12px;
      padding: 8px 20px; font-size: 13px;
      background: var(--accent-soft); color: var(--text);
      border-bottom: 1px solid var(--line);
    }
    .update-bar span:first-child { flex: 1; }
    .update-bar.bad { background: rgba(255, 90, 78, 0.14); }
    main { flex: 1; overflow: auto; padding: 24px; }
    .back {
      display: inline-flex; align-items: center; gap: 6px; margin: -8px 0 14px;
      background: none; border: none; padding: 4px 10px 4px 6px; color: var(--text-dim); font-weight: 500;
    }
    .back:hover:not(:disabled) { color: var(--accent); background: var(--accent-soft); }
  `,
})
export class Shell implements OnInit {
  protected readonly rift = inject(RiftService);
  protected readonly updates = inject(UpdateService);
  /** The app opens on your profile; champ select and games pull you to Live and going idle sends you back (see the constructor). */
  protected readonly tab = signal<Tab>('profile');
  protected readonly tabs: { id: Tab; label: string }[] = [
    { id: 'live', label: 'Live' },
    { id: 'champions', label: 'Champions' },
    { id: 'patch', label: 'Patch Notes' },
    { id: 'settings', label: 'Settings' },
    { id: 'feedback', label: 'Feedback' },
  ];
  ngOnInit(): void {
    this.updates.start();
  }

  /**
   * What's on the Live tab right now: champ select, the game, a post-game summary not yet closed,
   * or a Swiftplay lobby (its champions' runes and builds are picked there).
   */
  protected readonly liveActivity = computed(() => {
    if (this.rift.champSelect()) return 'Champ select';
    if (this.rift.loading()) return 'In game';
    const pg = this.rift.postGame();
    if (pg && pg.gameId !== this.rift.closedPostGame()) return 'Game summary';
    return this.rift.swiftplay().length ? 'Swiftplay' : null;
  });

  /** Not in a lobby, queue or game, and nothing left on the Live tab (an open game summary counts). */
  private readonly quiet = computed(() => {
    const s = this.rift.status();
    return !this.liveActivity() && (!s.connected || !BUSY_PHASES.has(s.phase));
  });

  constructor() {
    // Champ select, the loading screen, the post-game summary and a Swiftplay lobby each pull you to the Live tab once
    // when they start (Back returns you); switching away afterwards is left alone.
    effect(() => {
      if (!this.liveActivity()) return;
      untracked(() => {
        const t = this.tab();
        if (t === 'live') return;
        this.backTo.set(t);
        this.tab.set('live');
      });
    });
    // When the client goes quiet (you left the lobby, the game ended and its summary is closed, League
    // closed), the Live tab has nothing to show, so it hands you back to your profile. Only on that
    // change: browsing Live while idle is left alone, and so is any other tab.
    let wasQuiet = true;
    effect(() => {
      const quiet = this.quiet();
      if (quiet && !wasQuiet) {
        untracked(() => {
          if (this.tab() === 'live') this.go('profile');
        });
      }
      wasQuiet = quiet;
    });
    // Links between pages (rift.showChampion): open the tab, and Back returns to this one.
    effect(() => {
      const to = this.rift.navTo();
      if (!to) return;
      untracked(() => {
        this.rift.navTo.set(null);
        const t = this.tab();
        if (t !== to) {
          this.backTo.set(t);
          this.tab.set(to);
        }
      });
    });
  }

  protected readonly modKey = MOD_KEY;

  /** The champion search, with what was typed to open it. */
  protected readonly search = signal<{ text: string } | null>(null);

  protected openSearch(text: string): void {
    this.search.set({ text });
  }

  /** Ctrl+1…5 (Cmd+1…5 on a Mac) switch tabs; Ctrl+K, or typing a letter outside a text field, finds a champion. */
  protected tabKey(e: KeyboardEvent): void {
    if (this.search()) return;
    const mod = IS_MAC ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
    if (mod && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      this.openSearch('');
      return;
    }
    if (!mod && !e.ctrlKey && !e.metaKey && !e.altKey && /^[a-z]$/i.test(e.key) && !isTyping(e.target)) {
      e.preventDefault();
      this.openSearch(e.key);
      return;
    }
    if (!mod || e.altKey || e.shiftKey) return;
    const t = this.tabs[Number(e.key) - 1];
    if (!t) return;
    e.preventDefault();
    this.go(t.id);
  }

  /** The screen a link brought you here from, for the Back button. Cleared when you pick a tab yourself. */
  protected readonly backTo = signal<Tab | null>(null);

  protected go(t: Tab): void {
    this.backTo.set(null);
    this.tab.set(t);
  }

  /** Back to where a link came from, else from a champion's page to the champion list. */
  protected back(): void {
    const b = this.backTo();
    if (b) this.go(b);
    else if (this.tab() === 'champions') this.rift.championsPick.set(null);
  }

  private canGoBack(): boolean {
    return !!this.backTo() || (this.tab() === 'champions' && !!this.rift.championsPick());
  }

  /** The mouse's back button (button 3) goes back too. */
  protected mouseBack(e: MouseEvent): void {
    if (e.button === 3 && this.canGoBack()) {
      e.preventDefault();
      this.back();
    }
  }

  protected label(t: Tab): string {
    return t === 'profile' ? 'Profile' : (this.tabs.find((x) => x.id === t)?.label ?? t);
  }

  protected readonly statusText = computed(() => {
    const s = this.rift.status();
    if (!s.connected) return 'League client not found';
    return PHASE_LABELS[s.phase] ?? s.phase ?? 'Connected';
  });
}
