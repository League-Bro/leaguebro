import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { RiftService } from '../core/rift.service';
import { UpdateService } from '../core/update.service';
import { LiveView } from './live-view';
import { ChampionsView } from './champions-view';
import { SettingsView } from './settings-view';
import { PatchView } from './patch-view';
import { ProfileView } from './profile-view';
import { TierListView } from './tierlist-view';
import { FeedbackView } from './feedback-view';
import { ItemTipPopup } from './item-tip';

/** 'profile' isn't in the tab bar; the brand and your name open it. */
type Tab = 'live' | 'champions' | 'tiers' | 'patch' | 'settings' | 'feedback' | 'profile';

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

@Component({
  selector: 'rl-shell',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [LiveView, ChampionsView, TierListView, PatchView, SettingsView, FeedbackView, ProfileView, ItemTipPopup],
  template: `
    <header>
      <button class="brand" [class.active]="tab() === 'profile'" title="Your profile and match history" (click)="go('profile')">
        <img src="favicon.png" alt="" />
        <span>League Bro</span>
      </button>
      <nav>
        @for (t of tabs; track t.id) {
          <button [class.active]="tab() === t.id" (click)="go(t.id)">{{ t.label }}</button>
        }
      </nav>
      <div class="spacer"></div>
      <div class="status" [class.on]="rift.status().connected">
        <span class="dot"></span>
        <span>{{ statusText() }}</span>
        @if (rift.status().summoner; as s) {
          <button class="who" title="Your profile and match history" (click)="go('profile')">{{ s.name }}</button>
        }
      </div>
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
      @case ('downloading') {
        <div class="update-bar">
          Downloading {{ $any(updates.state()).version }}…
          @if ($any(updates.state()).percent !== null) { {{ $any(updates.state()).percent }}% }
        </div>
      }
      @case ('installing') {
        <div class="update-bar">Installing {{ $any(updates.state()).version }}. League Bro will restart in a moment.</div>
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
        @case ('live') { <rl-live /> }
        @case ('champions') { <rl-champions /> }
        @case ('tiers') { <rl-tierlist (openChampion)="openChampion($event)" /> }
        @case ('patch') { <rl-patch /> }
        @case ('settings') { <rl-settings /> }
        @case ('feedback') { <rl-feedback /> }
        @case ('profile') { <rl-profile /> }
      }
    </main>
    <rl-item-tip />
  `,
  host: {
    '(document:keydown.alt.arrowleft)': 'back()',
    '(document:mouseup)': 'mouseBack($event)',
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
    nav button { background: none; border: none; padding: 6px 16px; color: var(--text-dim); font-weight: 500; }
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
  protected readonly tab = signal<Tab>('live');
  protected readonly tabs: { id: Tab; label: string }[] = [
    { id: 'live', label: 'Live' },
    { id: 'champions', label: 'Champions' },
    { id: 'tiers', label: 'Tier List' },
    { id: 'patch', label: 'Patch Notes' },
    { id: 'settings', label: 'Settings' },
    { id: 'feedback', label: 'Feedback' },
  ];
  ngOnInit(): void {
    this.updates.start();
  }

  /** The screen a link brought you here from, for the Back button. Cleared when you pick a tab yourself. */
  protected readonly backTo = signal<Tab | null>(null);

  protected go(t: Tab): void {
    this.backTo.set(null);
    this.tab.set(t);
  }

  protected back(): void {
    const b = this.backTo();
    if (b) this.go(b);
  }

  /** The mouse's back button (button 3) goes back too. */
  protected mouseBack(e: MouseEvent): void {
    if (e.button === 3 && this.backTo()) {
      e.preventDefault();
      this.back();
    }
  }

  protected label(t: Tab): string {
    return t === 'profile' ? 'Profile' : (this.tabs.find((x) => x.id === t)?.label ?? t);
  }

  /** From the Tier List: show that champion's ranked build for the lane. */
  protected openChampion(e: { championId: number; position: string }): void {
    this.rift.championsGame.set('league');
    this.rift.championsPick.set({ championId: e.championId, position: e.position, mode: 'ranked' });
    this.backTo.set(this.tab());
    this.tab.set('champions');
  }

  protected readonly statusText = computed(() => {
    const s = this.rift.status();
    if (!s.connected) return 'League client not found';
    return PHASE_LABELS[s.phase] ?? s.phase ?? 'Connected';
  });
}
