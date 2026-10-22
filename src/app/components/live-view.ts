import { Component, computed, inject, signal } from '@angular/core';
import { RiftService } from '../core/rift.service';
import { PlayerCard } from './player-card';
import { RecCard } from './rec-card';
import { PostGameView } from './post-game';
import { championIcon, clock, positionLabel } from '../core/assets';

@Component({
  selector: 'rl-live',
  imports: [PlayerCard, RecCard, PostGameView],
  template: `
    @if (!rift.status().connected) {
      <div class="empty card">
        <h2>Waiting for League</h2>
        <p class="muted">Open the League client and League Bro will connect on its own. If it never connects, set your install folder under Settings.</p>
      </div>
    } @else if (rift.champSelect(); as cs) {
      <section class="hero card">
        @if (cs.myChampionId > 0) {
          <img class="big" [src]="icon(cs.myChampionId)" alt="" />
        } @else {
          <div class="big"></div>
        }
        <div class="stack grow">
          <div>
            <h2>{{ rift.champName(cs.myChampionId) || 'No champion yet' }}</h2>
            <div class="muted">
              {{ pos(cs.myPosition) || 'No assigned role' }} ·
              {{ cs.locked ? 'Locked in' : cs.myChampionId ? 'Hovering' : 'Picking' }}
            </div>
          </div>
          <div class="import" [class.bad]="rift.lastImport() && !rift.lastImport()!.ok">
            @if (importMsg()) {
              {{ importMsg() }}
            } @else if (rift.config()?.autoImportRunes) {
              <span class="muted">Runes{{ rift.config()?.setSummonerSpells && rift.config()?.recSource === 'opgg' ? ' and summoner spells' : '' }} import automatically when you lock in.</span>
            } @else {
              <span class="muted">Auto-import is off.</span>
            }
          </div>
        </div>
        <button class="primary" [disabled]="!cs.myChampionId || busy()" (click)="importNow()">Import now</button>
      </section>
      <rl-rec-card />

      <h3 class="section">Your team</h3>
      <div class="stack tight">
        @for (p of cs.allies; track p.cellId; let i = $index) {
          <rl-player
            [name]="p.name" [puuid]="p.isMe ? null : p.puuid" [championId]="p.championId || p.pickIntent"
            [position]="p.position" [isMe]="p.isMe"
            [hiddenLabel]="'Ally ' + (i + 1)" [hiddenNote]="'Hidden in ranked champ select · shown on the loading screen'" />
        }
      </div>

      <div class="row picks">
        <div>
          <h3 class="section">Enemy picks</h3>
          <div class="row">
            @for (e of cs.enemies; track e.cellId) {
              @if (e.championId > 0) {
                <img class="champ-icon" [src]="icon(e.championId)" [title]="rift.champName(e.championId)" alt="" />
              } @else {
                <div class="champ-icon"></div>
              }
            }
          </div>
        </div>
        @if (cs.bans.length) {
          <div>
            <h3 class="section">Bans</h3>
            <div class="row">
              @for (b of cs.bans; track $index) {
                <img class="champ-icon md banned" [src]="icon(b)" [title]="rift.champName(b)" alt="" />
              }
            </div>
          </div>
        }
      </div>
    } @else if (rift.loading(); as l) {
      @if (rift.overlay(); as o) {
        <section class="ingame card row">
          <div class="clock mono">{{ time(o.gameTime) }}</div>
          <div class="mono">{{ o.kills }}/{{ o.deaths }}/{{ o.assists }} <span class="faint">KDA</span></div>
          <div class="spacer"></div>
          @for (t of o.timers; track t.key) {
            <div class="timer"><span class="muted">{{ t.label }}</span> <span class="mono">{{ time(t.spawnAt - o.gameTime) }}</span></div>
          }
        </section>
      }
      <rl-rec-card />
      <div class="row head">
        <h3 class="section">{{ l.queueName || 'Game' }}</h3>
        <div class="spacer"></div>
        <span class="faint">{{ scoutedCount() }} of {{ lookupCount() }} players looked up</span>
      </div>
      <h3 class="section ally">Your team</h3>
      <div class="stack tight">
        @for (p of l.allies; track $index) {
          <rl-player [name]="p.name" [puuid]="p.isMe ? null : p.puuid" [championId]="p.championId" [position]="p.position"
            [isMe]="p.isMe" [hiddenLabel]="'Hidden player'" [hiddenNote]="'This player has streamer mode on'" />
        }
      </div>
      <h3 class="section enemy">Enemy team</h3>
      <div class="stack tight">
        @for (p of l.enemies; track $index) {
          <rl-player [name]="p.name" [puuid]="p.puuid" [championId]="p.championId" [position]="p.position" side="enemy"
            [hiddenLabel]="'Hidden player'" [hiddenNote]="'This player has streamer mode on'" />
        }
      </div>
    } @else if (visiblePostGame(); as pg) {
      <rl-post-game [game]="pg" />
    } @else if (postGamePhase() && !rift.postGame()) {
      <div class="empty card">
        <h2>Game over</h2>
        <p class="muted">Getting your game summary from the League client…</p>
      </div>
    } @else {
      <div class="empty card">
        <h2>{{ rift.status().summoner?.name || 'Connected' }}</h2>
        <p class="muted">Queue up. Champ select and the loading screen will show here, and the overlay appears once you're in game.</p>
        @if (rift.lastImport(); as li) {
          <p class="faint">Last rune import: {{ rift.champName(li.championId) }}: {{ li.message }}</p>
        }
      </div>
    }
  `,
  styles: `
    .empty { max-width: 560px; margin: 60px auto; text-align: center; }
    .empty h2 { font-size: 18px; margin-bottom: 6px; }
    .hero { display: flex; align-items: center; gap: 18px; margin-bottom: 8px; }
    .hero .big { width: 72px; height: 72px; border-radius: 12px; border: 2px solid var(--gold); background: var(--bg-sunken); }
    .hero h2 { font-size: 20px; }
    .grow { flex: 1; gap: 6px; }
    .import { font-size: 13px; color: var(--win); }
    .import.bad { color: var(--loss); }
    .section { margin: 22px 0 10px; }
    .section.ally { color: var(--ally); }
    .section.enemy { color: var(--enemy); }
    .tight { gap: 6px; }
    .picks { align-items: flex-start; gap: 48px; }
    .banned { filter: grayscale(1) brightness(0.6); }
    .ingame { gap: 22px; flex-wrap: wrap; }
    .clock { font-size: 22px; font-weight: 600; color: var(--gold); }
    .timer { font-size: 13px; display: flex; gap: 6px; }
    .head .section { margin-bottom: 0; }
  `,
})
export class LiveView {
  protected readonly rift = inject(RiftService);
  protected readonly busy = signal(false);
  protected readonly manualMsg = signal<string | null>(null);

  protected readonly importMsg = computed(() => {
    const m = this.manualMsg();
    if (m) return m;
    const li = this.rift.lastImport();
    const cs = this.rift.champSelect();
    if (li && cs && li.championId === cs.myChampionId) return li.message;
    return null;
  });
  protected readonly visiblePostGame = computed(() => {
    const pg = this.rift.postGame();
    return pg && pg.gameId !== this.rift.closedPostGame() ? pg : null;
  });
  protected readonly postGamePhase = computed(() =>
    ['WaitingForStats', 'PreEndOfGame', 'EndOfGame'].includes(this.rift.status().phase),
  );
  protected readonly lookupCount = computed(() => {
    const l = this.rift.loading();
    if (!l) return 0;
    return [...l.allies, ...l.enemies].filter((p) => p.puuid && !p.isMe).length;
  });
  protected readonly scoutedCount = computed(() => {
    const l = this.rift.loading();
    const profiles = this.rift.profiles();
    if (!l) return 0;
    return [...l.allies, ...l.enemies].filter((p) => p.puuid && !p.isMe && profiles[p.puuid]).length;
  });

  protected icon = championIcon;
  protected pos = positionLabel;
  protected time = clock;

  async importNow(): Promise<void> {
    this.busy.set(true);
    try {
      this.manualMsg.set(await this.rift.importRunesNow());
    } catch (e) {
      this.manualMsg.set(String(e));
    } finally {
      this.busy.set(false);
      setTimeout(() => this.manualMsg.set(null), 8000);
    }
  }
}
