import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { RiftService } from '../core/rift.service';
import { championIcon } from '../core/assets';
import { MIN_GAMES } from '../core/models';

/** Your lane opponent and how the matchup goes: OP.GG's numbers and tip, plus your own games. */
@Component({
  selector: 'rl-matchup',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DecimalPipe],
  template: `
    @if (rift.config()?.recSource === 'opgg' && state(); as m) {
      <section class="card matchup">
        <div class="head">
          <h3>Lane matchup</h3>
          <div class="spacer"></div>
          @if (choices().length) {
            <span class="faint small">{{ m.opponentId ? 'Not them?' : 'Who\\'s in your lane?' }}</span>
            <div class="pick" role="radiogroup" aria-label="Your lane opponent">
              @for (id of choices(); track id) {
                <button class="ghost who" role="radio" [class.on]="id === m.opponentId" [attr.aria-checked]="id === m.opponentId"
                  [disabled]="busy()" [title]="rift.champName(id)" (click)="choose(id)">
                  <img [src]="icon(id)" alt="" />
                </button>
              }
              @if (m.opponentId) {
                <button class="ghost none" [disabled]="busy()" (click)="choose(0)" title="Hide the matchup">None</button>
              }
            </div>
          }
        </div>

        @if (!m.opponentId) {
          <p class="muted small">
            @if (!m.guessed) {
              No lane opponent picked. Pick one above to see the matchup.
            } @else if (choices().length) {
              League Bro can't tell who's in your lane yet. Pick them above once you know.
            } @else {
              Shows once the enemy team picks.
            }
          </p>
        } @else {
          <div class="vs">
            <img class="opp" [src]="icon(m.opponentId)" alt="" />
            <div>
              <div class="strong">{{ rift.champName(rec()!.championId) }} vs {{ rift.champName(m.opponentId) }}</div>
              <div class="faint small">{{ m.guessed ? 'Guessed from the enemy picks' : 'Picked by you' }}</div>
            </div>
          </div>

          @if (m.loading) {
            <p class="muted small" role="status">Looking up the matchup on OP.GG…</p>
          } @else if (m.matchup; as x) {
            <div class="facts">
              @if (x.games > 0) {
                <div class="fact" title="Your champion's win rate against them in this lane on OP.GG (Emerald+)">
                  <div class="label">OP.GG win rate</div>
                  <div class="value mono" [class.win]="x.winRate >= 0.515" [class.loss]="x.winRate <= 0.485">{{ x.winRate * 100 | number: '1.1-1' }}%</div>
                  <div class="faint small">{{ x.games | number }} games</div>
                </div>
              }
              @if (x.tip; as t) {
                @if (t.laneAdvantage) {
                  <div class="fact" title="Who usually comes out of the laning phase ahead (OP.GG)">
                    <div class="label">Laning</div>
                    <div class="value" [class.win]="t.laneAdvantage === 'you'" [class.loss]="t.laneAdvantage === 'them'">{{ side(t.laneAdvantage, m.opponentId) }}</div>
                  </div>
                }
                @if (t.soloKills) {
                  <div class="fact" title="Who gets more solo kills in this lane (OP.GG)">
                    <div class="label">Solo kills</div>
                    <div class="value" [class.win]="t.soloKills === 'you'" [class.loss]="t.soloKills === 'them'">{{ side(t.soloKills, m.opponentId) }}</div>
                  </div>
                }
                @if (playLabel(t.playStyle); as p) {
                  <div class="fact" title="OP.GG's suggested approach for this lane">
                    <div class="label">Play</div>
                    <div class="value">{{ p }}</div>
                  </div>
                }
              }
              @if (damageLabel(x.opponentDamageType); as d) {
                <div class="fact" title="The damage they mostly deal, from the League client">
                  <div class="label">Their damage</div>
                  <div class="value">{{ d }}</div>
                </div>
              }
              @if (m.myRecord; as r) {
                @if (r.games > 0) {
                  <div class="fact" title="Your recent games (the ones the League client keeps) with them as your lane opponent">
                    <div class="label">Your games vs them</div>
                    <div class="value mono" [class.win]="r.wins * 2 > r.games" [class.loss]="r.wins * 2 < r.games">{{ r.wins }}W {{ r.games - r.wins }}L</div>
                    <div class="faint small">{{ r.kills }}/{{ r.deaths }}/{{ r.assists }}</div>
                  </div>
                }
              }
            </div>
            @if (x.tip?.text; as text) {
              <blockquote class="tip">{{ text }} <span class="faint">· OP.GG</span></blockquote>
            }
            @if (!x.rec || x.rec.games < minGames) {
              <p class="faint small">Too few games for a build of its own against {{ rift.champName(m.opponentId) }}, so the build stays on all games.</p>
            }
          } @else if (m.error) {
            <p class="loss small">Couldn't get the matchup from OP.GG: {{ m.error }}</p>
          }
        }
      </section>
    }
  `,
  styles: `
    .matchup { margin: 14px 0 4px; display: flex; flex-direction: column; gap: 12px; }
    .head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .head h3 { margin: 0; }
    .spacer { flex: 1; }
    .pick { display: flex; gap: 4px; align-items: center; }
    .who { padding: 2px; border-radius: 10px; border: 1px solid transparent; line-height: 0; }
    .who img { width: 28px; height: 28px; border-radius: 8px; opacity: 0.6; }
    .who:hover img, .who.on img { opacity: 1; }
    .who.on { border-color: var(--accent); background: var(--accent-soft); }
    .none { font-size: 12px; padding: 4px 8px; }
    .vs { display: flex; align-items: center; gap: 12px; }
    .opp { width: 44px; height: 44px; border-radius: 12px; border: 1px solid var(--line-strong); }
    .strong { font-weight: 600; }
    .facts { display: flex; flex-wrap: wrap; gap: 8px; }
    .fact { background: var(--bg-sunken); border-radius: 10px; padding: 8px 12px; min-width: 104px; }
    .label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--text-faint); }
    .value { font-weight: 600; margin-top: 2px; }
    .win { color: var(--win); }
    .loss { color: var(--loss); }
    .small { font-size: 12.5px; margin: 0; }
    .tip { margin: 0; padding: 8px 12px; border-left: 3px solid var(--accent); background: var(--bg-sunken); border-radius: 0 10px 10px 0; line-height: 1.45; }
  `,
})
export class MatchupCard {
  protected readonly rift = inject(RiftService);
  protected readonly icon = championIcon;
  protected readonly minGames = MIN_GAMES;
  protected readonly busy = signal(false);
  protected readonly rec = this.rift.rec;
  protected readonly state = computed(() => this.rift.rec()?.matchup ?? null);

  /** Enemy champions picked so far; only in champ select, where you can change who's in your lane. */
  protected readonly choices = computed(() => (this.rift.champSelect()?.enemies ?? []).map((e) => e.championId).filter((id) => id > 0));

  async choose(id: number): Promise<void> {
    if (this.busy() || id === this.state()?.opponentId) return;
    this.busy.set(true);
    try {
      await this.rift.chooseLaneOpponent(id);
    } finally {
      this.busy.set(false);
    }
  }

  side(who: string, opponentId: number): string {
    return who === 'you' ? 'You' : who === 'them' ? this.rift.champName(opponentId) : 'Even';
  }
  playLabel(style: string): string {
    return { aggressive: 'Aggressive', even: 'Even', defensive: 'Play safe' }[style] ?? '';
  }
  damageLabel(type: string): string {
    return { AD: 'Physical', AP: 'Magic', BOTH: 'Mixed' }[type] ?? '';
  }
}
