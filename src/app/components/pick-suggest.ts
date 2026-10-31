import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { DecimalPipe, NgTemplateOutlet } from '@angular/common';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { RiftService } from '../core/rift.service';
import { championIcon, positionLabel } from '../core/assets';
import { championSplit, teamSplit } from '../core/damage';
import { answers, enemyTraits } from '../core/comp';
import { demoPickSuggestions } from '../core/demo';
import { PickSuggestions, SuggestedPick } from '../core/models';
import { Loader } from './loader';

/** How many picks the card shows. */
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

/**
 * Champions to consider before you lock in, at the top of champ select:
 * counters to your lane opponent once they're picked, the lane's strongest
 * picks before that (OP.GG, `picks.rs`). Nudged toward the damage your team
 * lacks and picks that answer the enemy comp (`comp.ts`). Gone once you lock in:
 * the team card (`champ-teams.ts`) covers the rest of champ select.
 */
@Component({
  selector: 'rl-pick-suggest',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DecimalPipe, NgTemplateOutlet, Loader],
  template: `
    @if (visible() && state(); as s) {
      <section class="card picks">
        <div class="head">
          <h3>
            @if (s.opponentId) {
              Picks for {{ pos(s.position) }} vs {{ rift.champName(s.opponentId) }}
            } @else {
              Strong {{ pos(s.position) }} picks
            }
          </h3>
          @if (s.opponentId) {
            <span class="faint small">{{ s.guessed ? 'guessed lane opponent' : 'picked by you' }}</span>
          }
          @if (s.loading) {
            <rl-loader [size]="16" class="faint small" />
          }
          <div class="spacer"></div>
          @if (enemies().length) {
            <span class="faint small">{{ s.opponentId ? 'Not them?' : 'Who\\'s in your lane?' }}</span>
            <div class="who-pick" role="radiogroup" aria-label="Your lane opponent">
              @for (id of enemies(); track id) {
                <button class="ghost who" role="radio" [class.on]="id === s.opponentId" [attr.aria-checked]="id === s.opponentId"
                  [disabled]="busy()" [title]="rift.champName(id)" (click)="choose(id)">
                  <img [src]="icon(id)" alt="" />
                </button>
              }
              @if (s.opponentId) {
                <button class="ghost none" [disabled]="busy()" (click)="choose(0)" title="Show the lane's strongest picks instead">None</button>
              }
            </div>
          }
        </div>

        @if (best().length) {
          <div class="grid">
            @for (p of best(); track p.championId) {
              <ng-container *ngTemplateOutlet="tile; context: { $implicit: p }" />
            }
          </div>
          <p class="faint small">
            @if (s.opponentId) {
              OP.GG Emerald+ win rates against {{ rift.champName(s.opponentId) }} in lane, weighed with each champion's overall lane win rate so a few lucky games don't top the list.
            } @else {
              OP.GG's tier list for {{ pos(s.position) }} (Emerald+). Switches to counters once your lane opponent is picked.
            }
            @if (need()) { Picks that add {{ need() }} damage are moved up: your team is mostly {{ need() === 'AP' ? 'AD' : 'AP' }}. }
            @if (traits().length) { Picks that answer the enemy comp (see the team card below) are moved up a little too. }
          </p>
        } @else if (s.error) {
          <p class="loss small">Couldn't get picks from OP.GG: {{ s.error }}</p>
        } @else if (s.loading) {
          <p class="faint small">Looking up picks on OP.GG…</p>
        } @else {
          <p class="faint small">No picks with enough games against {{ rift.champName(s.opponentId) }} that you can still play.</p>
        }

        <ng-template #tile let-p>
          <div class="tile" [title]="tip(p)">
            <div class="top">
              <img class="champ-icon" [src]="icon(p.championId)" alt="" />
              <div class="info">
                <div class="name">{{ rift.champName(p.championId) }}</div>
                @if (p.vsGames > 0) {
                  <div class="mono small" [class.win]="p.vsWinRate >= 0.515" [class.loss]="p.vsWinRate <= 0.485">{{ p.vsWinRate * 100 | number: '1.1-1' }}%</div>
                  <div class="faint line">{{ games(p.vsGames) }}</div>
                } @else {
                  <div class="mono small">{{ p.winRate * 100 | number: '1.1-1' }}%</div>
                  <div class="faint line">Tier {{ p.tier }}</div>
                }
              </div>
            </div>
            <!-- What the pick answers, as one-line pills under the stats. -->
            @if (p.adds || p.answers.length) {
              <div class="tags">
                @if (p.adds) { <span class="tag">Adds {{ p.adds }}</span> }
                @for (a of p.answers; track a) { <span class="tag">{{ a }}</span> }
              </div>
            }
          </div>
        </ng-template>
      </section>
    }
  `,
  styles: `
    .picks { margin-bottom: 14px; display: flex; flex-direction: column; gap: 10px; }
    .head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .head h3 { margin: 0; }
    .who-pick { display: flex; gap: 4px; align-items: center; }
    .who { padding: 2px; border-radius: 10px; border: 1px solid transparent; line-height: 0; }
    .who img { width: 28px; height: 28px; border-radius: 8px; opacity: 0.6; }
    .who:hover img, .who.on img { opacity: 1; }
    .who.on { border-color: var(--accent); background: var(--accent-soft); }
    .none { font-size: 12px; padding: 4px 8px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 8px; }
    .tile { display: flex; flex-direction: column; gap: 8px; padding: 10px; border-radius: 12px; background: var(--bg-sunken); min-width: 0; }
    .top { display: flex; align-items: center; gap: 10px; min-width: 0; }
    .tile .champ-icon { width: 40px; height: 40px; border-radius: 10px; flex: none; }
    .info { min-width: 0; display: flex; flex-direction: column; gap: 2px; }
    .name { font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .line { font-size: 11.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .tags { display: flex; flex-wrap: wrap; gap: 4px; }
    .tag { font-size: 11px; line-height: 1; white-space: nowrap; padding: 4px 8px; border-radius: 999px; color: var(--accent); background: var(--accent-soft); font-weight: 600; }
    .small { font-size: 12.5px; margin: 0; }
  `,
})
export class PickSuggest {
  protected readonly rift = inject(RiftService);
  protected readonly icon = championIcon;
  protected readonly pos = positionLabel;
  protected readonly busy = signal(false);
  private readonly live = signal<PickSuggestions | null>(null);
  /** The browser demo's lane opponent (the real one comes back from League Bro). */
  private readonly demoOpponent = signal<number | null>(null);

  constructor() {
    if (this.rift.demo) return;
    let stop: (() => void) | null = null;
    let gone = false;
    listen<PickSuggestions | null>('pick-suggestions', (e) => this.live.set(e.payload)).then((un) => (gone ? un() : (stop = un)));
    invoke<PickSuggestions | null>('get_pick_suggestions').then((s) => this.live.set(s ?? null));
    inject(DestroyRef).onDestroy(() => {
      gone = true;
      stop?.();
    });
  }

  protected readonly state = computed<PickSuggestions | null>(() => {
    if (!this.rift.demo) return this.live();
    const s = demoPickSuggestions();
    const o = this.demoOpponent();
    return o === null ? s : { ...s, opponentId: o, guessed: false, picks: o ? s.picks : s.picks.map((p) => ({ ...p, vsGames: 0, score: p.winRate })) };
  });

  /** While you're still picking. */
  protected readonly visible = computed(() => {
    const cs = this.rift.champSelect();
    return !!cs && !cs.locked;
  });
  protected readonly enemies = computed(() => (this.rift.champSelect()?.enemies ?? []).map((e) => e.championId).filter((id) => id > 0));

  private readonly champs = computed(() => new Map((this.rift.statics()?.champions ?? []).map((c) => [c.id, c])));

  private split(id: number): [number, number, number] | null {
    const c = this.champs().get(id);
    return c ? championSplit(c.alias, c.roles) : null;
  }

  /** The damage your team lacks: "AP" when your picks so far are mostly AD, and the other way round. */
  protected readonly need = computed(() => {
    const allies = (this.rift.champSelect()?.allies ?? []).filter((p) => !p.isMe).map((p) => p.championId || p.pickIntent);
    const s = teamSplit(allies.filter((id) => id > 0).map((id) => this.split(id)).filter((x) => !!x));
    if (!s || s.counted < 2) return '';
    return s.ad >= 70 ? 'AP' : s.ap >= 70 ? 'AD' : '';
  });

  /** What the enemy picks so far are built around (tanks, dive, poke, squishy). */
  protected readonly traits = computed(() => {
    const enemies = (this.rift.champSelect()?.enemies ?? []).map((e) => this.champs().get(e.championId)).filter((c) => !!c);
    return enemyTraits(enemies);
  });

  private readonly ranked = computed<Shown[]>(() => {
    const need = this.need();
    const traits = this.traits();
    const picks = (this.state()?.picks ?? []).map((p) => {
      const s = this.split(p.championId);
      const kind = !s ? '' : s[1] >= 60 ? 'AP' : s[0] >= 60 ? 'AD' : '';
      const alias = this.champs().get(p.championId)?.alias ?? '';
      const tags = alias ? traits.map((t) => answers(t.trait, alias)).filter((a) => !!a) : [];
      return { ...p, adds: need && kind === need ? need : '', answers: tags };
    });
    // A point of win rate per answer: enough to swap close picks, not to lift a bad one.
    const boost = (p: Shown) => p.score + NUDGE * Math.min(MAX_NUDGES, (p.adds ? 1 : 0) + p.answers.length);
    return picks.sort((a, b) => boost(b) - boost(a));
  });

  protected readonly best = computed(() => this.ranked().slice(0, SHOWN));

  async choose(id: number): Promise<void> {
    if (this.busy() || id === this.state()?.opponentId) return;
    if (this.rift.demo) {
      this.demoOpponent.set(id);
      return;
    }
    this.busy.set(true);
    try {
      await this.rift.chooseLaneOpponent(id);
    } finally {
      this.busy.set(false);
    }
  }

  games(n: number): string {
    return n >= 1000 ? `${(n / 1000).toFixed(1)}k games` : `${n} games`;
  }

  tip(p: Shown): string {
    const lines = [`${this.rift.champName(p.championId)}: ${(p.winRate * 100).toFixed(1)}% win rate in lane overall (OP.GG tier ${p.tier})`];
    const o = this.state()?.opponentId;
    if (p.vsGames > 0 && o) lines.push(`${(p.vsWinRate * 100).toFixed(1)}% against ${this.rift.champName(o)} over ${p.vsGames} games`);
    if (p.masteryPoints) lines.push(`Your mastery: level ${p.masteryLevel}, ${p.masteryPoints.toLocaleString()} points`);
    return lines.join('\n');
  }
}
