import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { RiftService } from '../core/rift.service';
import { championIcon, formatTier, positionLabel, rankCrest, tierClass, winPct } from '../core/assets';
import { Loader } from './loader';

@Component({
  selector: 'rl-player',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DecimalPipe, Loader],
  template: `
    <div class="player" [class.me]="isMe()" [class.enemy]="side() === 'enemy'" [class.flat]="flat()">
      <div class="who">
        @if (championId() > 0) {
          <img class="champ-icon" [src]="icon(championId())" alt="" [title]="rift.champName(championId())" />
        } @else {
          <div class="champ-icon"></div>
        }
        <div class="names">
          <div class="name">
            @if (name(); as n) { {{ n }} } @else { <span class="faint">{{ hiddenLabel() }}</span> }
            @if (isMe()) { <span class="you">You</span> }
          </div>
          <div class="sub muted">
            {{ rift.champName(championId()) || 'Picking…' }}
            @if (pos()) { · {{ pos() }} }
          </div>
        </div>
      </div>

      @if (profile(); as p) {
        <div class="rank-cell">
          @let shown = p.solo ?? p.flex;
          <img class="crest" [class.unranked]="!shown" [src]="crest(shown?.tier)" [alt]="shown ? tier(shown.tier, shown.division) : 'Unranked'" />
          <div class="rank">
            @if (p.solo; as r) {
              <span [class]="tierCls(r.tier)">{{ tier(r.tier, r.division) }}</span>
              <span class="muted mono">{{ r.lp }} LP</span>
              <span class="faint mono">{{ r.wins }}W {{ r.losses }}L · {{ wr(r.wins, r.losses) }}%</span>
            } @else if (p.flex; as r) {
              <span [class]="tierCls(r.tier)">{{ tier(r.tier, r.division) }}</span>
              <span class="faint">Flex</span>
            } @else {
              <span class="tier-none">Unranked</span>
            }
          </div>
        </div>
        <div class="form">
          @if (p.recentGames > 0) {
            <div class="mono">
              <span [class.win]="recentWr() >= 55" [class.loss]="recentWr() < 45">{{ p.recentWins }}-{{ p.recentGames - p.recentWins }}</span>
              <span class="faint"> last {{ p.recentGames }}</span>
            </div>
            <div class="mono muted">{{ p.avgKills | number: '1.1-1' }} / {{ p.avgDeaths | number: '1.1-1' }} / {{ p.avgAssists | number: '1.1-1' }}</div>
            <div class="strip">
              @for (g of p.lastGames; track $index) {
                <span [class.w]="g.win" [title]="rift.champName(g.championId) + ' ' + g.kills + '/' + g.deaths + '/' + g.assists"></span>
              }
            </div>
          } @else {
            <span class="faint">No recent games</span>
          }
        </div>
      } @else if (puuid()) {
        <rl-loader [size]="22" class="loading muted">Looking up…</rl-loader>
      } @else if (!isMe()) {
        <div class="loading faint">{{ hiddenNote() }}</div>
      }
    </div>
  `,
  styles: `
    :host { display: block; container-type: inline-size; }
    .player {
      display: grid;
      grid-template-columns: minmax(180px, 1.4fr) 1fr 1fr;
      align-items: center;
      gap: 14px;
      padding: 10px 14px;
      background: var(--glass), var(--bg-raised); border: 1px solid var(--line);
      border-left: 3px solid var(--ally);
      border-radius: 12px;
      min-height: 62px;
      height: 100%;
    }
    .player.enemy { border-left-color: var(--enemy); }
    .player.me { background: linear-gradient(90deg, var(--accent-soft), transparent 60%), var(--bg-raised); border-left-color: var(--accent); }
    /* A row inside another card (champ select's team card): no card of its own. */
    .player.flat { background: var(--bg-sunken); border: 0; border-left: 3px solid var(--ally); border-radius: 10px; min-height: 50px; padding: 6px 12px; }
    .player.flat.enemy { border-left-color: var(--enemy); }
    .player.flat.me { background: linear-gradient(90deg, var(--accent-soft), transparent 60%), var(--bg-sunken); border-left-color: var(--accent); }
    .who { display: flex; align-items: center; gap: 10px; min-width: 0; }
    .names { min-width: 0; }
    .name { font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .sub { font-size: 12.5px; }
    .you { font-size: 10px; font-weight: 700; color: var(--accent); border: 1px solid var(--accent); border-radius: 999px; padding: 0 6px; margin-left: 6px; vertical-align: 2px; }
    .rank-cell { display: flex; align-items: center; gap: 10px; min-width: 0; }
    .crest { width: 36px; height: 36px; object-fit: contain; flex: none; }
    .crest.unranked { opacity: 0.45; }
    .rank, .form { display: flex; flex-direction: column; font-size: 13px; gap: 1px; }
    .rank span:first-child { font-weight: 600; }
    .strip { display: flex; gap: 2px; margin-top: 3px; }
    .strip span { width: 9px; height: 5px; border-radius: 2px; background: var(--loss); opacity: 0.85; }
    .strip span.w { background: var(--win); }
    .loading { grid-column: 2 / -1; font-size: 13px; }
    /* Half-width card (teams side by side): narrower name column. */
    @container (max-width: 640px) {
      .player { grid-template-columns: minmax(0, 1.3fr) minmax(0, 1fr) minmax(0, 1fr); gap: 4px 12px; }
    }
  `,
})
export class PlayerCard {
  protected readonly rift = inject(RiftService);
  readonly name = input<string | null>(null);
  readonly puuid = input<string | null>(null);
  readonly championId = input(0);
  readonly position = input('');
  readonly isMe = input(false);
  readonly side = input<'ally' | 'enemy'>('ally');
  /** Why a player's details are missing, e.g. ranked champ select. */
  readonly hiddenLabel = input('Hidden');
  readonly hiddenNote = input('Shown on the loading screen');
  /** A plain row for use inside another card. */
  readonly flat = input(false);

  protected readonly profile = computed(() => {
    const id = this.puuid();
    return id ? this.rift.profiles()[id] ?? null : null;
  });
  protected readonly pos = computed(() => positionLabel(this.position()));
  protected readonly recentWr = computed(() => {
    const p = this.profile();
    return p && p.recentGames ? (100 * p.recentWins) / p.recentGames : 50;
  });

  protected icon = championIcon;
  protected tierCls = tierClass;
  protected tier = formatTier;
  protected crest = rankCrest;
  protected wr = (w: number, l: number) => winPct(w, w + l);
}
