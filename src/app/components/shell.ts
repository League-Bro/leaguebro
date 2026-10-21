import { Component, computed, inject, signal } from '@angular/core';
import { RiftService } from '../core/rift.service';
import { LiveView } from './live-view';
import { RunesView } from './runes-view';
import { BuildsView } from './builds-view';
import { SettingsView } from './settings-view';

type Tab = 'live' | 'runes' | 'builds' | 'settings';

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
  imports: [LiveView, RunesView, BuildsView, SettingsView],
  template: `
    <header>
      <div class="brand">
        <img src="favicon.png" alt="" />
        <span>Riftlight</span>
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
    <main>
      @switch (tab()) {
        @case ('live') { <rl-live /> }
        @case ('runes') { <rl-runes /> }
        @case ('builds') { <rl-builds /> }
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
    main { flex: 1; overflow: auto; padding: 20px; }
  `,
})
export class Shell {
  protected readonly rift = inject(RiftService);
  protected readonly tab = signal<Tab>('live');
  protected readonly tabs: { id: Tab; label: string }[] = [
    { id: 'live', label: 'Live' },
    { id: 'runes', label: 'Runes' },
    { id: 'builds', label: 'Builds' },
    { id: 'settings', label: 'Settings' },
  ];
  protected readonly statusText = computed(() => {
    const s = this.rift.status();
    if (!s.connected) return 'League client not found';
    return PHASE_LABELS[s.phase] ?? s.phase ?? 'Connected';
  });
}
