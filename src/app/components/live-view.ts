import { ChangeDetectionStrategy, Component, computed, effect, inject, output, signal, untracked } from '@angular/core';
import { RiftService } from '../core/rift.service';
import { PlayerCard } from './player-card';
import { RecCard } from './rec-card';
import { MatchupCard } from './matchup-card';
import { PostGameView } from './post-game';
import { FullscreenHint } from './fullscreen-hint';
import { TeamDamage } from './team-damage';
import { PickSuggest } from './pick-suggest';
import { championIcon, clock, positionLabel } from '../core/assets';
import { ImportEvent, RecChoice, RecState, SwiftplaySlot } from '../core/models';

@Component({
  selector: 'rl-live',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [PlayerCard, RecCard, MatchupCard, PostGameView, FullscreenHint, TeamDamage, PickSuggest],
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
      <!-- Before you lock in: who to pick against your lane opponent. -->
      <rl-pick-suggest />
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

      <!-- Both teams side by side; the grid lines up each ally with the enemy in the same row. -->
      <div class="teams">
        <h3 class="section ally">Your team</h3>
        @for (p of cs.allies; track p.cellId; let i = $index) {
          <rl-player
            [name]="p.name" [puuid]="p.isMe ? null : p.puuid" [championId]="p.championId || p.pickIntent"
            [position]="p.position" [isMe]="p.isMe"
            [hiddenLabel]="'Ally ' + (i + 1)" [hiddenNote]="'Hidden in ranked champ select · shown on the loading screen'" />
        }
        <h3 class="section enemy">Enemy team</h3>
        @for (e of cs.enemies; track e.cellId; let i = $index) {
          <rl-player class="foe"
            [name]="e.name" [puuid]="e.puuid" [championId]="e.championId" [position]="e.position" side="enemy"
            [hiddenLabel]="'Enemy ' + (i + 1)" [hiddenNote]="'Names show on the loading screen'" />
        }
      </div>

      <div class="row picks">
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
        <div class="stack">
          <h2>Swiftplay</h2>
          <span class="muted">{{ swiftAutoText() }}</span>
        </div>
        @if (swiftError(); as err) {
          <div class="import bad">{{ err }}</div>
        }
      </section>
      <!-- Both lobby slots side by side, each with its own runes and build. -->
      <div class="swift-cols">
        @for (s of rift.swiftplay(); track $index) {
          <div class="swift-col">
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
              @if (swiftBusy() === slotKey(s)) {
                <span class="import faint">Setting…</span>
              } @else if (slotImport(s.championId); as li) {
                <!-- Only problems: the card below already shows what's set. -->
                @if (!li.ok) {
                  <span class="import bad" [title]="li.message">{{ shortImport(li) }}</span>
                  <button class="ghost icon-btn sm retry" (click)="retrySlot(s)" title="Retry" aria-label="Retry"><svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M20 12a8 8 0 1 1-2.34-5.66M20 4v5h-5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" /></svg></button>
                }
              }
            </div>
            @if (s.championId > 0) {
              @if (swiftRecs()[slotKey(s)]; as st) {
                <rl-rec-card [lookup]="st" (choiceChange)="pickSwift(st, $event)" />
              }
            } @else {
              <p class="faint hint">Pick a champion for this position in the lobby.</p>
            }
          </div>
        }
      </div>
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
    .slot { padding: 10px 12px; border-radius: 12px; background: var(--bg-sunken); }
    .slot .import { text-align: right; white-space: nowrap; cursor: help; }
    .swift-cols { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; margin-top: 14px; align-items: start; }
    .swift-col { display: flex; flex-direction: column; gap: 10px; min-width: 0; }
    .swift-col .slot { border: 1px solid var(--line); align-items: center; gap: 12px; }
    .retry { color: var(--accent); }
    .swift-col .slot .import { overflow: hidden; text-overflow: ellipsis; min-width: 0; max-width: 60%; }
    @media (max-width: 900px) { .swift-cols { grid-template-columns: minmax(0, 1fr); } }
    .hint { font-size: 12.5px; margin: 12px 0 0; }
    .picks { align-items: flex-start; gap: 48px; }
    .teams { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); grid-auto-flow: row dense; column-gap: 14px; row-gap: 6px; }
    .teams > * { grid-column: 1; }
    .teams > .enemy, .teams > .foe { grid-column: 2; }
    @media (max-width: 760px) {
      .teams { grid-template-columns: minmax(0, 1fr); }
      .teams > .enemy, .teams > .foe { grid-column: 1; }
    }
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
    if (c?.recSource !== 'opgg') return 'OP.GG recommendations are off (Settings → Recommendations), so there are no builds to pick from.';
    if (!c.autoImportRunes) return 'Auto-import is off: anything you pick below goes into that slot.';
    return 'Set when you pick a champion. Change anything below before you hit Find Match.';
  });
  /** OP.GG's options per Swiftplay champion and position (`slotKey`), with the slot's picks in place. */
  protected readonly swiftRecs = signal<Record<string, RecState>>({});
  /** The slot (`slotKey`) whose pick is being imported, or null. */
  protected readonly swiftBusy = signal<string | null>(null);
  /** Champion and position of each slot with a champion, so picks changing doesn't refetch. */
  private readonly swiftKeys = computed(
    () => this.rift.swiftplay().filter((s) => s.championId > 0).map((s) => this.slotKey(s)).join(','),
  );

  constructor() {
    effect(() => {
      const keys = this.swiftKeys();
      untracked(() => {
        const slots = this.rift.swiftplay().filter((s) => s.championId > 0);
        const old = this.swiftRecs();
        // Keep what's loaded for slots that stayed, drop the rest.
        this.swiftRecs.set(Object.fromEntries(Object.entries(old).filter(([k]) => keys.split(',').includes(k))));
        for (const s of slots) if (!old[this.slotKey(s)]) void this.loadSwift(s);
      });
    });
  }

  protected slotKey(s: SwiftplaySlot): string {
    return `${s.championId}:${s.position}`;
  }

  private async loadSwift(slot: SwiftplaySlot): Promise<void> {
    const key = this.slotKey(slot);
    const { championId, position, choice } = slot;
    const base: RecState = { championId, position, loading: true, rec: null, error: null, choice };
    // Only while the slot still has this champion (the lobby can change during the lookup).
    const put = (st: RecState) => {
      if (this.swiftKeys().split(',').includes(key)) this.swiftRecs.update((r) => ({ ...r, [key]: st }));
    };
    put(base);
    try {
      let rec = await this.rift.lookupRec(championId, position, 'ranked');
      if (choice.runes || choice.spells || choice.core || choice.boots) rec = await this.rift.recWithChoice(rec, choice);
      put({ ...base, loading: false, rec });
    } catch (e) {
      put({ ...base, loading: false, error: String(e) });
    }
  }

  /** A pick on a slot's card: shown at once, then imported into that lobby slot. */
  async pickSwift(s: RecState, choice: RecChoice, retry = false): Promise<void> {
    if ((!s.rec && !retry) || this.swiftBusy()) return;
    const key = `${s.championId}:${s.position}`;
    this.swiftBusy.set(key);
    this.swiftError.set(null);
    try {
      if (s.rec) {
        const rec = await this.rift.recWithChoice(s.rec, choice);
        if (this.swiftRecs()[key] === s) this.swiftRecs.update((r) => ({ ...r, [key]: { ...s, rec, choice } }));
      }
      const events = await this.rift.chooseSwiftplayOption(s.championId, s.position, choice);
      this.swiftResults.update((r) => ({ ...r, ...Object.fromEntries(events.map((e) => [e.championId, e])) }));
    } catch (e) {
      this.swiftError.set(String(e));
    } finally {
      this.swiftBusy.set(null);
      this.clearSwiftSoon();
    }
  }

  private swiftTimer?: ReturnType<typeof setTimeout>;
  /** Hides the Swiftplay import results after a few seconds. */
  private clearSwiftSoon(): void {
    clearTimeout(this.swiftTimer);
    this.swiftTimer = setTimeout(() => {
      this.swiftResults.set({});
      this.swiftError.set(null);
    }, 8000);
  }

  /** A failed slot import in a few words; the full message is its tooltip. */
  protected shortImport(li: ImportEvent): string {
    return li.message.includes('rune menu') ? '✕ Pick the League Bro page in the lobby' : '✕ Couldn\'t set runes';
  }

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

  /** Imports a slot again with its current picks, after a failed import. */
  async retrySlot(slot: SwiftplaySlot): Promise<void> {
    const st = this.swiftRecs()[this.slotKey(slot)];
    if (st) await this.pickSwift(st, slot.choice, true);
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
