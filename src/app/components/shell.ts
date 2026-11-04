import { ChangeDetectionStrategy, Component, ElementRef, OnInit, computed, effect, inject, signal, untracked, viewChild } from '@angular/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { RiftService, inTauri } from '../core/rift.service';
import { UpdateService } from '../core/update.service';
import { IS_MAC, MOD_KEY } from '../core/platform';
import { profileIcon } from '../core/assets';
import { LiveView } from './live-view';
import { ChampionsView } from './champions-view';
import { SettingsView } from './settings-view';
import { PatchView } from './patch-view';
import { ProfileView } from './profile-view';
import { ItemTipPopup } from './item-tip';
import { ChampionSearch, SearchAnchor } from './champion-search';
import { UpdateSplash } from './update-splash';

/** 'profile' isn't in the tab bar; the brand and your name open it. */
type Tab = 'live' | 'champions' | 'patch' | 'settings' | 'profile';

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
  imports: [LiveView, ChampionsView, PatchView, SettingsView, ProfileView, ItemTipPopup, ChampionSearch, UpdateSplash],
  template: `
    <!-- The window has no Windows title bar (tauri.conf.json): the header moves it (double-click maximizes)
         and holds its buttons. A Mac keeps its native title bar, so they're left out there. -->
    <header data-tauri-drag-region [class.mac]="isMac">
      <button class="brand" [class.active]="tab() === 'profile'" title="Your profile and match history" (click)="go('profile')">
        <img src="favicon.png" alt="" />
        <span>League Bro</span>
      </button>
      <nav>
        @for (t of tabs; track t.id) {
          <button [class.active]="tab() === t.id" [class.hot]="t.id === 'live' && !!liveActivity()"
                  [title]="t.label + ' (' + modKey + ($index + 1) + ')' + (t.id === 'live' && liveActivity() ? ': ' + liveActivity() : '')" (click)="go(t.id)">
            @if (t.id === 'live') {
              <!-- Heartbeat line: always there, pink and beating while something is on the Live tab. -->
              <svg class="pulse" viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12h4.5l2.5-7 4.5 14 3-7H22" /></svg>
            }
            <span class="label">{{ t.label }}</span>
            @if (t.id === 'live' && liveActivity() === 'In game') {
              <span class="live-tag">LIVE</span>
            }
          </button>
        }
      </nav>
      <div class="spacer" data-tauri-drag-region></div>
      <!-- Looks like a text field and opens the search right on top of itself (champion-search.ts anchor). -->
      <button #find class="find" [class.open]="!!search()" [title]="'Find a champion, or a player by Name#TAG (' + modKey + 'K, or just start typing)'"
              aria-haspopup="dialog" (click)="openSearch('')">
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
        <span class="hint">Search champions or players</span>
        <kbd>{{ modKey }}K</kbd>
      </button>
      <div class="spacer" data-tauri-drag-region></div>
      <div class="status" [class.on]="rift.status().connected">
        <span class="dot"></span>
        <span class="phase">{{ statusText() }}</span>
        @if (rift.status().summoner; as s) {
          <button class="who" title="Your profile and match history" (click)="go('profile')">
            @if (myIcon(); as url) { <img [src]="url" alt="" /> }
            <span class="name">{{ s.name }}</span>
          </button>
        }
      </div>
      @if (updates.version(); as v) {
        <span class="version" title="League Bro version">v{{ v }}</span>
      }
      @if (!isMac) {
        <div class="win">
          <button class="win-btn" title="Minimize" aria-label="Minimize" (click)="minimize()">
            <svg viewBox="0 0 10 10" aria-hidden="true"><path d="M0 5h10" /></svg>
          </button>
          <button class="win-btn" [title]="maximized() ? 'Restore' : 'Maximize'" [attr.aria-label]="maximized() ? 'Restore' : 'Maximize'" (click)="toggleMaximize()">
            <svg viewBox="0 0 10 10" aria-hidden="true">
              @if (maximized()) { <path d="M2.5 2.5V.5h7v7h-2 M.5 2.5h7v7h-7z" /> } @else { <path d="M.5 .5h9v9h-9z" /> }
            </svg>
          </button>
          <button class="win-btn close" title="Close" aria-label="Close" (click)="close()">
            <svg viewBox="0 0 10 10" aria-hidden="true"><path d="M0 0l10 10M10 0 0 10" /></svg>
          </button>
        </div>
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
        @case ('profile') { <rl-profile /> }
      }
    </main>
    <rl-item-tip />
    <rl-update-splash />
    @if (search(); as s) {
      <rl-champion-search [initial]="s.text" [anchor]="s.anchor" (closed)="search.set(null)" />
    }
  `,
  host: {
    '(document:keydown.alt.arrowleft)': 'back()',
    '(document:mouseup)': 'mouseBack($event)',
    '(document:keydown)': 'tabKey($event)',
  },
  styles: `
    :host { display: flex; flex-direction: column; height: 100vh; }
    /* No backdrop blur: nothing scrolls under the header. */
    /* Neon sign over a dark wall: a pink→teal hairline along the bottom with a soft glow under it. */
    header {
      position: relative;
      display: flex; align-items: center; gap: 22px;
      padding: 0 0 0 20px; height: 64px; flex: none;
      background:
        radial-gradient(420px 90px at 8% 0%, rgba(255, 79, 163, 0.10), transparent 70%),
        radial-gradient(420px 90px at 92% 100%, rgba(47, 212, 196, 0.07), transparent 70%),
        var(--rail);
    }
    header::after {
      content: ''; position: absolute; left: 0; right: 0; bottom: -1px; height: 1px; pointer-events: none;
      background: linear-gradient(90deg, transparent, var(--accent) 18%, rgba(255, 79, 163, 0.35) 50%, var(--accent-2) 82%, transparent);
      box-shadow: 0 0 10px rgba(255, 79, 163, 0.45);
    }
    header.mac { padding-right: 20px; }
    /* Graffiti tag: marker font, pink with a teal misprint offset, a little tilted. */
    .brand {
      display: flex; align-items: center; gap: 10px; white-space: nowrap;
      font: 400 19px/1 var(--marker); letter-spacing: 0.02em;
      background: none; border: none; padding: 4px 12px 4px 6px; margin-left: -6px; color: var(--accent);
    }
    .brand span { display: inline-block; transform: rotate(-3deg) translateY(1px); text-shadow: 2px 2px 0 rgba(47, 212, 196, 0.55), 0 0 14px var(--accent-glow); transition: transform 0.2s var(--ease-out); }
    .brand:hover:not(:disabled), .brand.active { background: none; color: var(--accent); }
    .brand:hover:not(:disabled) span, .brand.active span { transform: rotate(-5deg) translateY(1px) scale(1.04); }
    .brand img { width: 30px; height: 30px; filter: drop-shadow(0 0 8px var(--accent-glow)); transition: transform 0.2s var(--ease-out); }
    .brand:hover:not(:disabled) img { transform: rotate(-8deg); }
    nav { display: flex; gap: 4px; }
    nav button {
      position: relative; isolation: isolate; display: flex; align-items: center; gap: 7px;
      background: none; border: none; padding: 8px 14px; color: var(--text-dim); font-weight: 600; white-space: nowrap; letter-spacing: 0.01em;
    }
    /* Hover: a teal marker scribble underneath. */
    nav button::after {
      content: ''; position: absolute; left: 14px; right: 14px; bottom: 3px; height: 2px; border-radius: 2px;
      background: var(--accent-2); box-shadow: 0 0 8px rgba(47, 212, 196, 0.6);
      transform: scaleX(0) rotate(-1.5deg); transform-origin: left; transition: transform 0.18s var(--ease-out);
    }
    nav button:hover:not(:disabled) { color: var(--text); background: none; }
    nav button:hover:not(:disabled):not(.active)::after { transform: scaleX(1) rotate(-1.5deg); }
    /* Active: a slanted pink marker swipe behind the label, rough at the ends. */
    nav button::before {
      content: ''; position: absolute; inset: 5px 4px; z-index: -1; border-radius: 3px;
      background: linear-gradient(100deg, #ff3d97, var(--accent) 45%, #ff6fb4);
      clip-path: polygon(3% 8%, 98% 0, 100% 86%, 96% 100%, 1% 94%, 0 30%);
      transform: skewX(-12deg) scaleX(0.6); opacity: 0; transition: transform 0.2s var(--ease-out), opacity 0.15s;
      box-shadow: 0 0 18px var(--accent-glow);
    }
    nav button.active, nav button.active:hover:not(:disabled) { color: var(--on-accent); background: none; }
    nav button.active::before { transform: skewX(-12deg) scaleX(1); opacity: 1; }
    /* The Live tab's heartbeat. */
    .pulse { width: 16px; height: 16px; flex: none; fill: none; stroke: currentColor; stroke-width: 2.2; stroke-linecap: round; stroke-linejoin: round; opacity: 0.75; }
    nav button.hot:not(.active) { color: var(--text); }
    nav button.hot:not(.active) .pulse { color: var(--accent); opacity: 1; filter: drop-shadow(0 0 4px var(--accent-glow)); }
    nav button.hot .pulse path { stroke-dasharray: 40; animation: beat 1.6s linear infinite; }
    @keyframes beat { 0% { stroke-dashoffset: 40; } 55%, 100% { stroke-dashoffset: 0; } }
    nav button.active .pulse { opacity: 1; }
    .live-tag {
      font: 700 9.5px/1 var(--mono); letter-spacing: 0.08em; color: var(--on-accent); background: var(--accent-2);
      padding: 3px 5px; border-radius: 4px; box-shadow: 0 0 10px rgba(47, 212, 196, 0.55); animation: blink 1.6s ease-in-out infinite;
    }
    nav button.active .live-tag { background: var(--on-accent); color: var(--accent-2); box-shadow: none; }
    @keyframes blink { 50% { opacity: 0.55; } }
    .spacer { flex: 1; align-self: stretch; }
    .status {
      display: flex; align-items: center; gap: 8px; color: var(--text-dim); font-size: 13px; white-space: nowrap;
      padding: 6px 14px; border: 1px solid var(--line); border-radius: 999px; background: var(--bg-hover);
      transition: border-color 0.2s, box-shadow 0.2s;
    }
    .status.on { border-color: rgba(47, 212, 196, 0.28); box-shadow: inset 0 0 12px rgba(47, 212, 196, 0.06); }
    .status .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--text-faint); }
    .status.on .dot { background: var(--win); box-shadow: 0 0 8px var(--win); }
    .status .who {
      display: flex; align-items: center; gap: 7px;
      color: var(--text); font: inherit; font-weight: 600; padding: 0 0 0 10px;
      border: none; border-left: 1px solid var(--line-strong); border-radius: 0; background: none;
    }
    .status .who img { width: 20px; height: 20px; border-radius: 50%; margin: -4px 0; }
    .status .who:hover:not(:disabled) { color: var(--accent-2); background: none; border-color: var(--line-strong); }
    /* Takes up to 420px of the header's free space; the spacers on both sides stay draggable. */
    .find {
      flex: 0 1 420px; min-width: 0; height: 38px;
      display: flex; align-items: center; gap: 10px; padding: 0 8px 0 14px; border-radius: 12px;
      color: var(--text-faint); background: var(--bg-sunken); border: 1px solid var(--line); font-weight: 400; text-align: left;
      transition: border-color 0.15s, box-shadow 0.15s, color 0.15s;
    }
    .find:hover:not(:disabled), .find.open { color: var(--text-dim); border-color: rgba(255, 79, 163, 0.5); box-shadow: 0 0 0 3px var(--accent-soft), 0 0 16px rgba(255, 79, 163, 0.18); }
    .find svg { width: 16px; height: 16px; flex: none; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; }
    .find .hint { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .find kbd { flex: none; font: 500 11px var(--mono); color: var(--text-dim); border: 1px solid var(--line-strong); border-radius: 5px; padding: 1px 6px; }
    .version { color: var(--text-faint); font: 500 12px var(--mono); margin-left: -12px; }
    /* A narrower window drops the version first, then the brand name, the shortcut and the client phase (the dot still shows it's connected),
       and the search field shrinks to its icon last. */
    @media (max-width: 1280px) { .version { display: none; } }
    @media (max-width: 1180px) {
      header { gap: 14px; }
      .brand span { display: none; }
      nav button { padding: 8px 10px; }
      nav button::after { left: 10px; right: 10px; }
    }
    @media (max-width: 1080px) { .find kbd, .status .phase { display: none; } }
    @media (max-width: 920px) { .find { flex: none; width: 38px; padding: 0; justify-content: center; } .find .hint { display: none; } }
    /* The smallest window (860px, tauri.conf.json): just your icon and the connection dot. */
    @media (max-width: 960px) { .status .who .name { display: none; } .status { padding: 6px 10px; } }
    /* Windows-sized window buttons at the header's right end, full height. */
    .win { align-self: stretch; display: flex; margin-left: -8px; }
    .win-btn {
      width: 46px; height: 100%; display: grid; place-items: center; padding: 0;
      background: none; border: none; border-radius: 0; color: var(--text-dim);
    }
    .win-btn svg { width: 10px; height: 10px; fill: none; stroke: currentColor; stroke-width: 1; shape-rendering: crispEdges; }
    .win-btn.close svg { shape-rendering: geometricPrecision; }
    .win-btn:hover:not(:disabled) { color: var(--text); background: var(--bg-hover); }
    .win-btn.close:hover:not(:disabled) { color: #fff; background: #c42b1c; }
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
  protected readonly tabs: { id: Tab; label: string }[] = [
    { id: 'live', label: 'Live' },
    { id: 'champions', label: 'Champions' },
    { id: 'patch', label: 'Patch Notes' },
    { id: 'settings', label: 'Settings' },
  ];
  ngOnInit(): void {
    this.updates.start();
    this.watchMaximized();
  }

  protected readonly isMac = IS_MAC;

  /** Whether the window is maximized, so the header shows Restore instead of Maximize. */
  protected readonly maximized = signal(false);

  private async watchMaximized(): Promise<void> {
    if (!inTauri()) return;
    const win = getCurrentWindow();
    const check = async () => this.maximized.set(await win.isMaximized());
    // Snapping, double-clicking the header and Win+Up all resize the window, so this catches every way in.
    await win.onResized(check);
    await check();
  }

  protected minimize(): void {
    if (inTauri()) void getCurrentWindow().minimize();
  }

  protected toggleMaximize(): void {
    if (inTauri()) void getCurrentWindow().toggleMaximize();
  }

  /** Same as the Windows title bar's close: quits the app (lib.rs cleans up on CloseRequested). */
  protected close(): void {
    if (inTauri()) void getCurrentWindow().close();
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
  protected readonly search = signal<{ text: string; anchor: SearchAnchor | null } | null>(null);
  private readonly findButton = viewChild<ElementRef<HTMLElement>>('find');

  protected openSearch(text: string): void {
    const r = this.findButton()?.nativeElement.getBoundingClientRect();
    this.search.set({ text, anchor: r?.width ? { left: r.left, top: r.top, width: r.width } : null });
  }

  /** Ctrl+1…4 (Cmd+1…4 on a Mac) switch tabs; Ctrl+K, or typing a letter outside a text field, finds a champion. */
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

  private readonly canGoBack = (): boolean => !!this.backTo() || (this.tab() === 'champions' && !!this.rift.championsPick());

  /** The mouse's back button (button 3) goes back too. */
  protected mouseBack(e: MouseEvent): void {
    if (e.button === 3 && this.canGoBack()) {
      e.preventDefault();
      this.back();
    }
  }

  protected readonly label = (t: Tab): string => t === 'profile' ? 'Profile' : (this.tabs.find((x) => x.id === t)?.label ?? t);

  protected readonly statusText = computed(() => {
    const s = this.rift.status();
    if (!s.connected) return 'League client not found';
    return PHASE_LABELS[s.phase] ?? s.phase ?? 'Connected';
  });
}
