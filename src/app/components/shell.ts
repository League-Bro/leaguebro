import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { RiftService } from '../core/rift.service';
import { UpdateService } from '../core/update.service';
import { LiveView } from './live-view';
import { ChampionsView } from './champions-view';
import { SettingsView } from './settings-view';
import { PatchView } from './patch-view';

type Tab = 'live' | 'champions' | 'patch' | 'settings';

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
  imports: [LiveView, ChampionsView, PatchView, SettingsView],
  template: `
    <header>
      <div class="brand">
        <img src="favicon.png" alt="" />
        <span>League Buddy</span>
      </div>
      <nav>
        @for (t of tabs; track t.id) {
          <button [class.active]="tab() === t.id" (click)="tab.set(t.id)">{{ t.label }}</button>
        }
      </nav>
      <div class="spacer"></div>
      <div class="status" [class.on]="rift.status().connected">
        <span class="dot"></span>
        <span>{{ statusText() }}</span>
        @if (rift.status().summoner; as s) {
          <span class="who">{{ s.name }}</span>
        }
      </div>
    </header>
    @if (rift.demo) {
      <div class="demo-bar">Demo data: this is the browser preview. Run it with <code>npm run tauri dev</code> to connect to League.</div>
    }
    @switch (updates.state().kind) {
      @case ('available') {
        <div class="update-bar">
          <span>League Buddy {{ $any(updates.state()).version }} is available.</span>
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
        <div class="update-bar">Installing {{ $any(updates.state()).version }}. League Buddy will restart in a moment.</div>
      }
      @case ('error') {
        <div class="update-bar bad">
          <span>Update failed: {{ $any(updates.state()).message }}</span>
          <button class="ghost" (click)="updates.dismiss()">Dismiss</button>
        </div>
      }
    }
    <main>
      @switch (tab()) {
        @case ('live') { <rl-live /> }
        @case ('champions') { <rl-champions /> }
        @case ('patch') { <rl-patch /> }
        @case ('settings') { <rl-settings /> }
      }
    </main>
  `,
  styles: `
    :host { display: flex; flex-direction: column; height: 100vh; }
    header {
      display: flex; align-items: center; gap: 22px;
      padding: 0 20px; height: 56px; flex: none;
      border-bottom: 1px solid var(--line);
      background: linear-gradient(180deg, #0f1523, var(--bg));
    }
    .brand { display: flex; align-items: center; gap: 9px; font-weight: 700; letter-spacing: 0.04em; }
    .brand img { width: 22px; height: 22px; }
    nav { display: flex; gap: 2px; height: 100%; }
    nav button {
      background: none; border: none; border-radius: 0; height: 100%;
      padding: 0 14px; color: var(--text-dim); border-bottom: 2px solid transparent;
    }
    nav button:hover { color: var(--text); }
    nav button.active { color: var(--text); border-bottom-color: var(--gold); }
    .status { display: flex; align-items: center; gap: 8px; color: var(--text-dim); font-size: 13px; }
    .status .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--text-faint); }
    .status.on .dot { background: var(--win); box-shadow: 0 0 8px var(--win); }
    .status .who { color: var(--text); padding-left: 10px; border-left: 1px solid var(--line-strong); }
    .demo-bar { background: var(--gold-soft); color: var(--gold); font-size: 12.5px; padding: 6px 20px; }
    .demo-bar code { font-family: var(--mono); }
    .update-bar {
      display: flex; align-items: center; gap: 12px;
      padding: 8px 20px; font-size: 13px;
      background: var(--gold-soft); color: var(--text);
      border-bottom: 1px solid var(--line);
    }
    .update-bar span:first-child { flex: 1; }
    .update-bar.bad { background: rgba(224, 100, 108, 0.14); }
    main { flex: 1; overflow: auto; padding: 20px; }
  `,
})
export class Shell implements OnInit {
  protected readonly rift = inject(RiftService);
  protected readonly updates = inject(UpdateService);
  protected readonly tab = signal<Tab>('live');
  protected readonly tabs: { id: Tab; label: string }[] = [
    { id: 'live', label: 'Live' },
    { id: 'champions', label: 'Champions' },
    { id: 'patch', label: 'Patch Notes' },
    { id: 'settings', label: 'Settings' },
  ];
  ngOnInit(): void {
    this.updates.start();
  }

  protected readonly statusText = computed(() => {
    const s = this.rift.status();
    if (!s.connected) return 'League client not found';
    return PHASE_LABELS[s.phase] ?? s.phase ?? 'Connected';
  });
}
