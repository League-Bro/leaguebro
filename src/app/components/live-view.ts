import { ChangeDetectionStrategy, Component, computed, inject, output, signal } from '@angular/core';
import { RiftService } from '../core/rift.service';
import { PlayerCard } from './player-card';
import { RecCard } from './rec-card';
import { MatchupCard } from './matchup-card';
import { PostGameView } from './post-game';
import { FullscreenHint } from './fullscreen-hint';
import { TeamDamage } from './team-damage';
import { championIcon, clock, positionLabel } from '../core/assets';
import { ImportEvent } from '../core/models';

@Component({
  selector: 'rl-live',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [PlayerCard, RecCard, MatchupCard, PostGameView, FullscreenHint, TeamDamage],
  template: `
    @if (rift.fullscreenHint()) {
      <rl-fullscreen-hint class="top-hint" />
    }
    @if (!rift.status().connected) {
      <div class="empty card">
        <h2>Waiting for League</h2>
        <p class="muted">Open the League client and League Bro will connect on its own. If it never connects, set your install folder under Settings.</p>
        <p class="faint">These work without the client:</p>
        <div class="row links">
          <button (click)="open.emit('champions')">Champion builds</button>
          <button (click)="open.emit('patch')">Patch notes</button>
          <button (click)="open.emit('profile')">Your profile</button>
        </div>
      </div>
    } @else if (rift.champSelect(); as cs) {
      <section class="hero card">
        @if (rift.champSplash(cs.myChampionId); as splash) {
          <div class="splash"><img [src]="splash" alt="" /></div>
        }
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
              <span class="muted">{{ autoImportText() }}</span>
            } @else {
              <span class="muted">Auto-import is off.</span>
            }
          </div>
        </div>
        <button class="primary" [disabled]="!cs.myChampionId || busy()" (click)="importNow()">{{ busy() ? 'Importing…' : 'Import now' }}</button>
      </section>
      <rl-team-damage [allies]="csAllyIds()" [enemies]="csEnemyIds()" />
      <rl-matchup />
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
      <!-- Team vs team first: what the game looks like, then who's in it, then your own lane and build. -->
      <rl-team-damage [allies]="loadAllyIds()" [enemies]="loadEnemyIds()" [showGold]="true" />
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
      <rl-matchup />
      <rl-rec-card />
    } @else if (visiblePostGame(); as pg) {
      <rl-post-game [game]="pg" (closed)="rift.closedPostGame.set(pg.gameId)" />
    } @else if (postGamePhase() && !rift.postGame()) {
      <div class="empty card">
        <h2>Game over</h2>
        <p class="muted">Getting your game summary from the League client…</p>
      </div>
    } @else if (swiftHasChamp()) {
      <section class="card swift">
        <div class="row">
          <div class="grow stack">
            <h2>Swiftplay</h2>
            <span class="muted">{{ swiftAutoText() }}</span>
          </div>
          <button class="primary" [disabled]="busy() || !swiftHasChamp()" (click)="importSwiftplay()">{{ busy() ? 'Importing…' : 'Import runes' }}</button>
        </div>
        @if (swiftError(); as err) {
          <div class="import bad">{{ err }}</div>
        }
        <div class="stack tight slots">
          @for (s of rift.swiftplay(); track $index) {
            <div class="slot row">
              @if (s.championId > 0) {
                <img class="champ-icon md" [src]="icon(s.championId)" alt="" />
              } @else {
                <div class="champ-icon md"></div>
              }
              <div class="stack grow">
                <b>{{ rift.champName(s.championId) || 'No champion yet' }}</b>
                <span class="muted">{{ pos(s.position) || 'Any role' }}</span>
              </div>
              @if (slotImport(s.championId); as li) {
                <span class="import" [class.bad]="!li.ok">{{ li.message }}</span>
              }
            </div>
          }
        </div>
      </section>
    } @else {
      <div class="empty card">
        @if (rift.swiftplay().length) {
          <h2>Swiftplay</h2>
          <p class="muted">Pick your champions in the lobby and their runes show up here.</p>
        } @else {
          <h2>Nothing going on yet</h2>
          <p class="muted">Queue up. Champ select and the loading screen will show here, and the overlay appears once you're in game.</p>
        }
        @if (rift.lastImport(); as li) {
          <p class="faint">Last rune import: {{ rift.champName(li.championId) }}: {{ li.message }}</p>
        }
        <p class="faint">In the meantime:</p>
        <div class="row links">
          <button (click)="open.emit('champions')">Champion builds</button>
          <button (click)="open.emit('patch')">Patch notes</button>
          <button (click)="open.emit('profile')">Your profile</button>
        </div>
      </div>
    }
  `,
  styles: `
    .top-hint { display: block; margin-bottom: 14px; }
    .empty { max-width: 560px; margin: 60px auto; text-align: center; }
    .empty h2 { font-size: 18px; margin-bottom: 6px; }
    .empty .links { justify-content: center; flex-wrap: wrap; }
    .hero { position: relative; display: flex; align-items: center; gap: 20px; margin-bottom: 8px; padding: 24px; min-height: 132px; }
    .hero > :not(.splash) { position: relative; }
    .hero .big { width: 80px; height: 80px; border-radius: 18px; border: 2px solid var(--accent); background: var(--bg-sunken); box-shadow: 0 0 22px var(--accent-glow); }
    .hero h2 { font-size: 26px; }
    .ingame .clock { text-shadow: 0 0 14px var(--accent-glow); }
    .grow { flex: 1; gap: 6px; }
    .import { font-size: 13px; color: var(--win); }
    .import.bad { color: var(--loss); }
    .section { margin: 22px 0 10px; }
    .section.ally { color: var(--ally); }
    .section.enemy { color: var(--enemy); }
    .tight { gap: 6px; }
    .swift { padding: 24px; }
    .swift h2 { font-size: 22px; }
    .swift .row { align-items: center; gap: 14px; }
    .slots { margin-top: 18px; }
    .slot { padding: 10px 12px; border-radius: 12px; background: var(--bg-sunken); }
    .slot .import { text-align: right; max-width: 50%; }
    .picks { align-items: flex-start; gap: 48px; }
    .banned { filter: grayscale(1) brightness(0.6); }
    .ingame { gap: 22px; flex-wrap: wrap; }
    .clock { font-size: 22px; font-weight: 600; color: var(--accent); }
    .timer { font-size: 13px; display: flex; gap: 6px; }
    .head .section { margin-bottom: 0; }
  `,
})
export class LiveView {
  protected readonly rift = inject(RiftService);
  /** Asks the shell to switch tabs (the shortcut buttons on the "Waiting for League" and idle cards). */
  readonly open = output<'champions' | 'patch' | 'profile'>();
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
  protected readonly autoImportText = computed(() => {
    const c = this.rift.config();
    const parts = ['runes'];
    if (c?.recSource === 'opgg') {
      if (c.setSummonerSpells) parts.push('summoner spells');
      if (c.setItemSets) parts.push('your shop build');
    }
    const list = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}` : parts[0];
    return `${list.charAt(0).toUpperCase()}${list.slice(1)} are set automatically when you lock in.`;
  });
  /** Results of the Swiftplay button, by champion (cleared after a few seconds). */
  protected readonly swiftResults = signal<Record<number, ImportEvent>>({});
  protected readonly swiftError = signal<string | null>(null);
  protected readonly swiftHasChamp = computed(() => this.rift.swiftplay().some((s) => s.championId > 0));
  protected readonly swiftAutoText = computed(() => {
    const c = this.rift.config();
    if (!c?.autoImportRunes) return 'Auto-import is off. Pick your champions here, then import their runes.';
    const spells = c.recSource === 'opgg' && c.setSummonerSpells;
    return (spells ? 'Runes and summoner spells are' : 'Runes are') + ' set automatically when you pick a champion here.';
  });
  protected slotImport(championId: number): ImportEvent | null {
    if (!championId) return null;
    const manual = this.swiftResults()[championId];
    if (manual) return manual;
    const li = this.rift.lastImport();
    return li && li.championId === championId ? li : null;
  }
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

  /** Champions for the damage bars. In champ select an ally's hover counts until they lock in. */
  protected readonly csAllyIds = computed(() => this.rift.champSelect()?.allies.map((p) => p.championId || p.pickIntent) ?? []);
  protected readonly csEnemyIds = computed(() => this.rift.champSelect()?.enemies.map((p) => p.championId) ?? []);
  // Once the game runs, its own player list wins: the loading screen data can miss
  // champions (bots, or picks it hadn't caught yet).
  protected readonly loadAllyIds = computed(
    () => nonEmpty(this.rift.overlay()?.allyChampions) ?? this.rift.loading()?.allies.map((p) => p.championId) ?? [],
  );
  protected readonly loadEnemyIds = computed(
    () => nonEmpty(this.rift.overlay()?.enemyChampions) ?? this.rift.loading()?.enemies.map((p) => p.championId) ?? [],
  );

  protected icon = championIcon;
  protected pos = positionLabel;
  protected time = clock;

  async importSwiftplay(): Promise<void> {
    this.busy.set(true);
    this.swiftError.set(null);
    try {
      const events = await this.rift.importSwiftplayNow();
      this.swiftResults.set(Object.fromEntries(events.map((e) => [e.championId, e])));
    } catch (e) {
      this.swiftError.set(String(e));
    } finally {
      this.busy.set(false);
      setTimeout(() => {
        this.swiftResults.set({});
        this.swiftError.set(null);
      }, 8000);
    }
  }

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

function nonEmpty(ids: number[] | undefined): number[] | undefined {
  return ids?.length ? ids : undefined;
}
