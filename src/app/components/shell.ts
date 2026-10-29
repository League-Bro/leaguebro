import { ChangeDetectionStrategy, Component, OnInit, computed, effect, inject, signal, untracked } from '@angular/core';
import { RiftService } from '../core/rift.service';
import { UpdateService } from '../core/update.service';
import { IS_MAC, MOD_KEY } from '../core/platform';
import { profileIcon } from '../core/assets';
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
    <aside>
      <button class="brand" [class.active]="tab() === 'profile'" title="Your profile and match history" (click)="go('profile')">
        <img src="favicon.png" alt="" />
        <span>League Bro</span>
      </button>
      <button class="find" [title]="'Find a champion, or a player by Name#TAG (' + modKey + 'K, or just start typing)'" (click)="openSearch('')">
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
        <span>Search</span>
        <kbd>{{ modKey }}K</kbd>
      </button>
      <nav>
        @for (t of tabs; track t.id) {
          @if (t.id === 'settings') { <div class="spacer"></div> }
          <button [class.active]="tab() === t.id" [title]="t.label + ' (' + modKey + ($index + 1) + ')'" (click)="go(t.id)">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path [attr.d]="t.icon" /></svg>
            <span class="label">{{ t.label }}</span>
            @if (t.id === 'live' && liveActivity(); as what) {
              <span [class]="what === 'In game' ? 'live-tag' : 'live-dot'" [title]="what">{{ what === 'In game' ? 'LIVE' : '' }}</span>
            }
          </button>
        }
      </nav>
      <button class="me" [class.on]="rift.status().connected" [class.active]="tab() === 'profile'" title="Your profile and match history" (click)="go('profile')">
        <span class="avatar">
          @if (myIcon(); as url) { <img [src]="url" alt="" /> } @else { {{ (rift.status().summoner?.name || '?').charAt(0) }} }
          <span class="dot"></span>
        </span>
        <span class="me-text">
          <b>{{ rift.status().summoner?.name || 'Not signed in' }}</b>
          <small>{{ statusText() }}</small>
        </span>
      </button>
      @if (updates.version(); as v) {
        <span class="version" title="League Bro version">v{{ v }}</span>
      }
    </aside>
    <div class="body">
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
          <button class="ghost icon-btn" (click)="updates.dismiss()" title="Dismiss" aria-label="Dismiss"><svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" /></svg></button>
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
    </div>
  `,
  host: {
    '(document:keydown.alt.arrowleft)': 'back()',
    '(document:mouseup)': 'mouseBack($event)',
    '(document:keydown)': 'tabKey($event)',
  },
  styles: `
    /* A side rail instead of a top bar: the page gets the full window height,
       and the rail shrinks to icons on a narrow window. No backdrop blur: nothing scrolls under it. */
    :host { display: flex; height: 100vh; }
    aside {
      flex: none; width: 216px; display: flex; flex-direction: column; gap: 6px;
      padding: 18px 12px 14px; background: var(--rail); border-right: 1px solid var(--line);
    }
    .body { flex: 1; min-width: 0; display: flex; flex-direction: column; }
    .brand {
      display: flex; align-items: center; gap: 11px; font: 800 16px var(--display); letter-spacing: 0.01em;
      background: none; border: none; padding: 6px 10px; margin-bottom: 10px; color: var(--text); border-radius: 14px;
    }
    .brand:hover:not(:disabled) { background: var(--bg-hover); }
    .brand img { width: 34px; height: 34px; filter: drop-shadow(0 0 10px var(--accent-glow)); }
    .find {
      display: flex; align-items: center; gap: 9px; padding: 8px 8px 8px 12px; border-radius: 12px; margin-bottom: 12px;
      color: var(--text-faint); background: var(--bg-sunken); border: 1px solid var(--line); font-weight: 400;
    }
    .find span { flex: 1; text-align: left; }
    .find:hover:not(:disabled) { color: var(--text); border-color: var(--line-strong); }
    .find svg { width: 15px; height: 15px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; }
    .find kbd { font: 500 10.5px var(--mono); color: var(--text-dim); border: 1px solid var(--line-strong); border-radius: 5px; padding: 0 5px; }
    nav { flex: 1; display: flex; flex-direction: column; gap: 3px; }
    nav button {
      position: relative; display: flex; align-items: center; gap: 12px;
      background: none; border: none; border-radius: 12px; padding: 9px 12px; color: var(--text-dim); font-weight: 500; text-align: left;
    }
    nav svg { width: 19px; height: 19px; flex: none; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
    nav .label { flex: 1; }
    nav button:hover:not(:disabled) { color: var(--text); background: var(--bg-hover); }
    nav button.active, nav button.active:hover:not(:disabled) { color: var(--text); background: var(--accent-soft); font-weight: 600; }
    nav button.active::before {
      content: ''; position: absolute; left: -12px; top: 9px; bottom: 9px; width: 3px; border-radius: 0 3px 3px 0;
      background: var(--accent); box-shadow: 0 0 12px var(--accent-glow);
    }
    nav button.active svg { color: var(--accent); }
    .live-tag {
      font: 700 9.5px var(--mono); letter-spacing: 0.08em; color: var(--on-accent); background: var(--accent);
      padding: 2px 6px; border-radius: 999px; box-shadow: 0 0 10px var(--accent-glow); animation: pulse 1.6s ease-in-out infinite;
    }
    .live-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--accent); box-shadow: 0 0 10px var(--accent-glow); animation: pulse 1.6s ease-in-out infinite; }
    @keyframes pulse { 50% { opacity: 0.55; } }
    .me {
      display: flex; align-items: center; gap: 10px; padding: 8px; margin-top: 8px; text-align: left;
      border-radius: 14px; border: 1px solid var(--line); background: var(--glass), var(--bg-raised);
    }
    .me:hover:not(:disabled), .me.active { border-color: var(--line-strong); }
    .avatar {
      position: relative; flex: none; width: 34px; height: 34px; border-radius: 50%; display: grid; place-items: center;
      font: 700 15px var(--display); color: var(--accent); background: var(--accent-soft); border: 1.5px solid var(--accent);
    }
    .avatar img { width: 100%; height: 100%; border-radius: 50%; object-fit: cover; }
    .avatar .dot { position: absolute; right: -2px; bottom: -2px; width: 11px; height: 11px; border-radius: 50%; background: var(--text-faint); border: 2px solid var(--bg-raised); }
    .me.on .avatar .dot { background: var(--win); }
    .me-text { min-width: 0; display: flex; flex-direction: column; line-height: 1.25; }
    .me-text b { font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .me-text small { color: var(--text-dim); font-size: 12px; }
    .version { color: var(--text-faint); font: 500 11px var(--mono); padding: 6px 12px 0; }
    /* Narrow window: icons only. */
    @media (max-width: 1100px) {
      aside { width: 72px; align-items: center; padding-inline: 10px; }
      .brand span, .find span, .find kbd, nav .label, .me-text, .version { display: none; }
      .brand { padding: 6px; } .find { padding: 10px; } nav button { padding: 11px; }
      nav button.active::before { left: -10px; }
      .live-tag, .live-dot { position: absolute; top: 6px; right: 6px; width: 8px; height: 8px; padding: 0; font-size: 0; }
      .me { padding: 4px; border: none; background: none; }
    }
    .demo-bar { background: var(--gold-soft); color: var(--gold); font-size: 12.5px; padding: 6px 28px; }
    .demo-bar code { font-family: var(--mono); }
    .update-bar {
      display: flex; align-items: center; gap: 12px;
      padding: 8px 20px; font-size: 13px;
      background: var(--accent-soft); color: var(--text);
      border-bottom: 1px solid var(--line);
    }
    .update-bar span:first-child { flex: 1; }
    .update-bar.bad { background: rgba(255, 90, 78, 0.14); }
    main { flex: 1; overflow: auto; padding: 28px 32px; }
    main > * { display: block; max-width: 1360px; margin-inline: auto; animation: rise 0.32s var(--ease-out) both; }
    /* Windows' "Animation effects" off skips the slide-in (the Live radar and dots still move). */
    @media (prefers-reduced-motion: reduce) { main > * { animation: none; } }
    main > button.back { display: flex; width: fit-content; margin-left: max(-6px, calc((100% - 1360px) / 2 - 6px)); }
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
  protected readonly tabs: { id: Tab; label: string; icon: string }[] = [
    { id: 'live', label: 'Live', icon: 'M3 12h4l3-8 4 16 3-8h4' },
    { id: 'champions', label: 'Champions', icon: 'M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6l-8-3Z M9 12l2 2 4-4' },
    { id: 'patch', label: 'Patch Notes', icon: 'M7 3h7l5 5v13H7z M14 3v5h5 M10 13h6 M10 17h6' },
    { id: 'settings', label: 'Settings', icon: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z' },
    { id: 'feedback', label: 'Feedback', icon: 'M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12Z' },
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
    // Links between pages (rift.showChampion, rift.showPlayer): open the tab, and Back returns to this one.
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

  /** Your profile icon, once your profile has loaded (this run or an earlier one). */
  protected readonly myIcon = computed(() => profileIcon(this.rift.myIconId()));

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
    // The header's Profile buttons always open yours.
    if (t === 'profile') this.rift.viewedPlayer.set(null);
  }

  /** Back to where a link came from, else from a champion's page to the champion list. */
  protected back(): void {
    const b = this.backTo();
    // Straight to the tab, so Back to the Profile page keeps the player it showed.
    if (b) {
      this.backTo.set(null);
      this.tab.set(b);
    }
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
