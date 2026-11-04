import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { DecimalPipe, NgTemplateOutlet } from '@angular/common';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { RiftService } from '../core/rift.service';
import { championIcon, positionLabel } from '../core/assets';
import { kilo } from '../core/format';
import { championSplit, teamSplit } from '../core/damage';
import { answers, enemyTraits } from '../core/comp';
import { demoBanSuggestions, demoPickSuggestions } from '../core/demo';
import { BanSuggestions, PickSuggestions, SuggestedBan, SuggestedPick } from '../core/models';
import { Loader } from './loader';
import { OpponentPicker } from './opponent-picker';
import { RankPicker, rankName } from './rank-picker';

/** How many picks and bans the card shows. */
const SHOWN = 5;

/** Win rate points a pick moves up for each thing it answers (your team's damage, the enemy comp), at most two. */
const NUDGE = 0.01;
const MAX_NUDGES = 2;

interface Shown extends SuggestedPick {
  /** Gives your team the damage it lacks ("AP" / "AD"), or ''. */
  adds: string;
  /** How it answers the enemy comp ("Shreds tanks"…). */
  answers: string[];
}

/** Listens to a suggestions event from League Bro, starting from the current value. */
function live<T>(event: string, command: string, demo: boolean): () => T | null {
  const value = signal<T | null>(null);
  if (demo) return value;
  let stop: (() => void) | null = null;
  let gone = false;
  listen<T | null>(event, (e) => value.set(e.payload)).then((un) => (gone ? un() : (stop = un)));
  invoke<T | null>(command).then((s) => value.set(s ?? null));
  inject(DestroyRef).onDestroy(() => {
    gone = true;
    stop?.();
  });
  return value;
}

/**
 * Champ select's suggestions card, at the top while you're still choosing:
 * bans while your ban is still to make (`bans.rs`: Lolalytics win rate in your
 * lane, nudged toward champions you've lost to), then picks until you lock in
 * (`picks.rs`: counters to your lane opponent once they're picked, the lane's
 * strongest before that, nudged toward the damage your team lacks and picks
 * that answer the enemy comp, `comp.ts`). Both use your rank unless another is
 * chosen in the card's rank menu (`Config.suggestRank`). Clicking a champion
 * hovers it in the client for your ban or pick, without locking it in.
 * Gone once you lock in: the team card (`champ-teams.ts`) covers the rest.
 */
@Component({
  selector: 'rl-pick-suggest',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DecimalPipe, NgTemplateOutlet, Loader, OpponentPicker, RankPicker],
  template: `
    @if (showBans() || showPicks()) {
      <section class="card picks">
        <div class="head">
          <h3>{{ showBans() && showPicks() ? 'Bans and picks' : showBans() ? 'Ban suggestions' : 'Pick suggestions' }}</h3>
          @if (bans()?.loading || picks()?.loading) {
            <rl-loader [size]="16" class="faint small" />
          }
          <div class="spacer"></div>
          <span class="faint small">Stats for</span>
          <rl-rank-picker class="end" [small]="true" title="Rank the win rates are from"
            [value]="rift.config()?.suggestRank ?? ''" [auto]="'Your rank (' + myRankLabel() + ')'" [autoRank]="myRank()" (picked)="setRank($event)" />
        </div>

        @if (showBans() && bans(); as b) {
          <div class="part">
            <div class="sub">
              <span class="cap">Ban</span>
              <span class="faint small">{{ pos(b.position) }} · Lolalytics win rate{{ b.personal ? ' + your recent losses' : '' }}</span>
            </div>
            @if (shownBans().length) {
              <div class="grid">
                @for (x of shownBans(); track x.championId) {
                  <button class="tile ban" [class.on]="isHovered(x.championId, 'ban')" [title]="banTip(x)" (click)="hover(x.championId, 'ban')">
                    <div class="top">
                      <img class="champ-icon" [src]="icon(x.championId)" alt="" />
                      <div class="info">
                        <div class="name">{{ rift.champName(x.championId) }}</div>
                        <div class="line">
                          <span class="mono" [class.loss]="x.winRate >= 0.515">{{ x.winRate * 100 | number: '1.1-1' }}%</span>
                          <span class="faint">Tier {{ x.tier }}</span>
                        </div>
                        <div class="extra">
                          @if (x.personal > 0) {
                            <span class="you">You {{ x.winsVs }}-{{ x.gamesVs - x.winsVs }}</span>
                          } @else {
                            <span class="faint">Banned {{ x.banRate * 100 | number: '1.0-1' }}%</span>
                          }
                        </div>
                      </div>
                    </div>
                  </button>
                }
              </div>
            } @else if (b.error) {
              <p class="loss small">Couldn't get the Lolalytics win rates: {{ b.error }}</p>
            } @else if (b.loading) {
              <p class="faint small">Looking up bans…</p>
            }
          </div>
        }

        @if (showPicks() && picks(); as s) {
          <div class="part">
            <div class="sub">
              <span class="cap">Pick</span>
              <span class="faint small">
                @if (s.opponentId) {
                  {{ pos(s.position) }} vs {{ rift.champName(s.opponentId) }} · {{ s.guessed ? 'guessed lane opponent' : 'picked by you' }}
                } @else {
                  Strong {{ pos(s.position) }} picks
                }
              </span>
              <div class="spacer"></div>
              <rl-opponent-picker [ids]="enemies()" [current]="s.opponentId" noneTitle="Show the lane's strongest picks instead" (chosen)="demoOpponent.set($event)" />
            </div>
            @if (best().length) {
              <div class="grid">
                @for (p of best(); track p.championId) {
                  <ng-container *ngTemplateOutlet="tile; context: { $implicit: p }" />
                }
              </div>
            } @else if (s.error) {
              <p class="loss small">Couldn't get picks from OP.GG: {{ s.error }}</p>
            } @else if (s.loading) {
              <p class="faint small">Looking up picks on OP.GG…</p>
            } @else {
              <p class="faint small">No picks with enough games against {{ rift.champName(s.opponentId) }} that you can still play.</p>
            }
          </div>
        }

        @if (hoverError()) {
          <p class="loss small">Couldn't hover it in the client: {{ hoverError() }}</p>
        } @else {
          <p class="faint small foot">
            Click a champion to hover it in the client (it isn't locked in).
            @if (showPicks() && picks(); as s) {
              Picks: OP.GG {{ s.opponentId ? 'win rates against ' + rift.champName(s.opponentId) + ', weighed with each champion\\'s lane win rate' : 'tier list' }}.
              @if (need()) { Picks that add {{ need() }} damage are moved up. }
              @if (traits().length) { Picks that answer the enemy comp are moved up a little. }
            }
          </p>
        }

        <ng-template #tile let-p>
          <button class="tile" [class.on]="isHovered(p.championId, 'pick')" [title]="tip(p)" (click)="hover(p.championId, 'pick')">
            <div class="top">
              <img class="champ-icon" [src]="icon(p.championId)" alt="" />
              <div class="info">
                <div class="name">{{ rift.champName(p.championId) }}</div>
                @if (p.vsGames > 0) {
                  <div class="line">
                    <span class="mono" [class.win]="p.vsWinRate >= 0.515" [class.loss]="p.vsWinRate <= 0.485">{{ p.vsWinRate * 100 | number: '1.1-1' }}%</span>
                    <span class="faint">{{ games(p.vsGames) }}</span>
                  </div>
                } @else {
                  <div class="line">
                    <span class="mono">{{ p.winRate * 100 | number: '1.1-1' }}%</span>
                    <span class="faint">Tier {{ p.tier }}</span>
                  </div>
                }
                <!-- What the pick answers, as one line of pills (the rest are in the tooltip); same height as a ban tile's third line. -->
                <div class="extra">
                  @if (p.adds) { <span class="tag">Adds {{ p.adds }}</span> }
                  @for (a of p.answers; track a) { <span class="tag">{{ a }}</span> }
                  @if (!p.adds && !p.answers.length) {
                    <span class="faint">{{ p.vsGames > 0 ? 'Tier ' + p.tier : 'Lane win rate' }}</span>
                  }
                </div>
              </div>
            </div>
          </button>
        </ng-template>
      </section>
    }
  `,
  styles: `
    .picks { margin-bottom: 14px; display: flex; flex-direction: column; gap: 10px; }
    .head, .sub { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .head h3 { margin: 0; }
    .small { font-size: 12px; }
    .part { display: flex; flex-direction: column; gap: 6px; }
    .cap { font-size: 10.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.1em; color: var(--text-dim); }
    /* Bans and picks use the same tile: same columns, three lines each, so both rows line up. */
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 6px; }
    .tile {
      display: flex; flex-direction: column; padding: 7px 9px; border-radius: 10px; min-width: 0;
      background: var(--bg-sunken); border: 1px solid transparent; text-align: left; color: inherit; font: inherit; cursor: pointer;
    }
    .tile:hover { border-color: var(--accent-soft); }
    .tile.on { border-color: var(--accent); }
    .tile.ban.on { border-color: var(--enemy); }
    .top { display: flex; align-items: center; gap: 9px; min-width: 0; }
    .tile .champ-icon { width: 44px; height: 44px; border-radius: 10px; flex: none; }
    .info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
    .name { font-weight: 600; font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .line { display: flex; align-items: center; gap: 6px; font-size: 12px; white-space: nowrap; overflow: hidden; }
    .extra { display: flex; align-items: center; gap: 4px; height: 18px; font-size: 11.5px; white-space: nowrap; overflow: hidden; }
    .tag { font-size: 10.5px; line-height: 1; white-space: nowrap; padding: 3px 7px; border-radius: 999px; color: var(--accent); background: var(--accent-soft); font-weight: 600; }
    .you { font-size: 10.5px; line-height: 1; padding: 3px 6px; border-radius: 999px; color: var(--enemy); background: color-mix(in srgb, var(--enemy) 16%, transparent); font-weight: 600; }
    .foot { margin: 0; }
  `,
})
export class PickSuggest {
  protected readonly rift = inject(RiftService);
  protected readonly icon = championIcon;
  protected readonly pos = positionLabel;
  private readonly livePicks = live<PickSuggestions>('pick-suggestions', 'get_pick_suggestions', this.rift.demo);
  private readonly liveBans = live<BanSuggestions>('ban-suggestions', 'get_ban_suggestions', this.rift.demo);
  /** The browser demo's lane opponent (the real one comes back from League Bro). */
  protected readonly demoOpponent = signal<number | null>(null);
  /** The champion last hovered from this card, and for what. */
  private readonly hovered = signal<{ id: number; kind: 'pick' | 'ban' } | null>(null);
  protected readonly hoverError = signal<string | null>(null);

  protected readonly picks = computed<PickSuggestions | null>(() => {
    if (!this.rift.demo) return this.livePicks();
    const s = demoPickSuggestions();
    const o = this.demoOpponent();
    return o === null ? s : { ...s, opponentId: o, guessed: false, picks: o ? s.picks : s.picks.map((p) => ({ ...p, vsGames: 0, score: p.winRate })) };
  });
  protected readonly bans = computed<BanSuggestions | null>(() => (this.rift.demo ? demoBanSuggestions() : this.liveBans()));

  /** Bans until yours is in; picks until you lock in. */
  protected readonly showBans = computed(() => !!this.rift.champSelect()?.banPending && !!this.bans());
  protected readonly showPicks = computed(() => {
    const cs = this.rift.champSelect();
    return !!cs && !cs.locked && !!this.picks();
  });

  /** Your own rank's filter, as League Bro found it. */
  protected readonly myRank = computed(() => this.picks()?.myRank ?? this.bans()?.myRank ?? null);
  protected readonly myRankLabel = computed(() => (this.myRank() ? rankName(this.myRank()) : 'unranked: Emerald+'));

  protected readonly enemies = computed(() => (this.rift.champSelect()?.enemies ?? []).map((e) => e.championId).filter((id) => id > 0));

  /** The damage your team lacks: "AP" when your picks so far are mostly AD, and the other way round. */
  protected readonly need = computed(() => {
    const allies = (this.rift.champSelect()?.allies ?? []).filter((p) => !p.isMe).map((p) => p.championId || p.pickIntent);
    const s = teamSplit(this.rift.champs(allies));
    if (!s || s.counted < 2) return '';
    return s.ad >= 70 ? 'AP' : s.ap >= 70 ? 'AD' : '';
  });

  /** What the enemy picks so far are built around (tanks, dive, poke, squishy). */
  protected readonly traits = computed(() => enemyTraits(this.rift.champs(this.enemies())));

  private readonly ranked = computed<Shown[]>(() => {
    const need = this.need();
    const traits = this.traits();
    const picks = (this.picks()?.picks ?? []).map((p) => {
      const c = this.rift.champ(p.championId);
      const s = c ? championSplit(c) : null;
      const kind = !s ? '' : s[1] >= 60 ? 'AP' : s[0] >= 60 ? 'AD' : '';
      const tags = c ? traits.map((t) => answers(t.trait, c.alias)).filter((a) => !!a) : [];
      return { ...p, adds: need && kind === need ? need : '', answers: tags };
    });
    // A point of win rate per answer: enough to swap close picks, not to lift a bad one.
    const boost = (p: Shown) => p.score + NUDGE * Math.min(MAX_NUDGES, (p.adds ? 1 : 0) + p.answers.length);
    return picks.sort((a, b) => boost(b) - boost(a));
  });

  protected readonly best = computed(() => this.ranked().slice(0, SHOWN));
  protected readonly shownBans = computed(() => (this.bans()?.bans ?? []).slice(0, SHOWN));

  games = (n: number) => `${kilo(n)} games`;

  isHovered(id: number, kind: 'pick' | 'ban'): boolean {
    const h = this.hovered();
    return !!h && h.id === id && h.kind === kind;
  }

  async hover(id: number, kind: 'pick' | 'ban'): Promise<void> {
    this.hoverError.set(null);
    try {
      await this.rift.hoverChampion(id, kind);
      this.hovered.set({ id, kind });
    } catch (e) {
      this.hoverError.set(String(e));
    }
  }

  setRank(rank: string): void {
    this.rift.updateConfig((c) => ({ ...c, suggestRank: rank }));
  }

  private rankName(): string {
    return rankName(this.picks()?.rank ?? this.bans()?.rank);
  }

  tip(p: Shown): string {
    const lines = [`${this.rift.champName(p.championId)}: ${(p.winRate * 100).toFixed(1)}% win rate in lane overall (OP.GG ${this.rankName()}, tier ${p.tier})`];
    const o = this.picks()?.opponentId;
    if (p.vsGames > 0 && o) lines.push(`${(p.vsWinRate * 100).toFixed(1)}% against ${this.rift.champName(o)} over ${p.vsGames} games`);
    if (p.masteryPoints) lines.push(`Your mastery: level ${p.masteryLevel}, ${p.masteryPoints.toLocaleString()} points`);
    lines.push('Click to hover it as your pick');
    return lines.join('\n');
  }

  banTip(b: SuggestedBan): string {
    const name = this.rift.champName(b.championId);
    const lines = [
      `${name}: ${(b.winRate * 100).toFixed(2)}% win rate in ${this.pos(this.bans()?.position ?? '')} (Lolalytics ${this.rankName()}, tier ${b.tier})`,
      `Picked ${(b.pickRate * 100).toFixed(1)}%, banned ${(b.banRate * 100).toFixed(1)}% of games`,
    ];
    if (b.gamesVs) lines.push(`You: ${b.winsVs}-${b.gamesVs - b.winsVs} against ${name} in recent games`);
    if (b.laneGamesVs) lines.push(`${b.laneWinsVs}-${b.laneGamesVs - b.laneWinsVs} with ${name} as your lane opponent`);
    if (b.personal > 0) lines.push(`Moved up ${b.personal.toFixed(2)} points for those losses`);
    lines.push('Click to hover it as your ban');
    return lines.join('\n');
  }
}
