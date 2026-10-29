import { ChangeDetectionStrategy, Component, ElementRef, computed, effect, inject, input, output, signal, viewChild } from '@angular/core';
import { RiftService } from '../core/rift.service';
import { championIcon, clock, kdaRatio } from '../core/assets';
import { PostGame, PostPlayer, PostTeam } from '../core/models';
import { Grade, review, reviewText } from '../core/roast';
import { GoldGraph } from './gold-graph';
import { ItemTip } from './item-tip';
import { LpChangeTag } from './lp-change';

const RESULT_LABEL = { win: 'Victory', loss: 'Defeat', remake: 'Remake' } as const;

@Component({
  selector: 'rl-post-game',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ItemTip, GoldGraph, LpChangeTag],
  template: `
    @let g = game();
    @if (me(); as m) {
      <section class="hero card" [class]="g.result">
        @if (rift.champSplash(m.championId); as splash) {
          <div class="splash"><img [src]="splash" alt="" /></div>
        }
        <img class="big" [src]="icon(m.championId)" alt="" />
        <div class="stack grow">
          <div class="title">
            <h2>{{ label() }}</h2>
            @if (g.lpChange; as lp) {
              <rl-lp-change class="lp" [change]="lp" [showRank]="true" />
            }
            <span class="muted">{{ rift.champName(m.championId) }} · {{ g.queueName || mode(g.gameMode) }} · {{ time(g.duration) }}</span>
          </div>
          <div class="line">
            <div><b class="mono">{{ m.kills }} / {{ m.deaths }} / {{ m.assists }}</b><span class="faint">{{ kda(m) }} KDA</span></div>
            <div><b class="mono">{{ m.cs }}</b><span class="faint">{{ perMin(m.cs) }} CS/min</span></div>
            <div><b class="mono">{{ k(m.damage) }}</b><span class="faint">damage</span></div>
            <div><b class="mono">{{ k(m.gold) }}</b><span class="faint">gold</span></div>
            <div><b class="mono">{{ m.vision }}</b><span class="faint">vision</span></div>
            @if (killShare(); as ks) {
              <div><b class="mono">{{ ks }}%</b><span class="faint">kill share</span></div>
            }
          </div>
          <div class="items">
            @for (id of m.items; track $index) {
              <span class="slot" [rlItemTip]="id" [attr.aria-label]="rift.itemName(id) || null">
                @if (rift.itemIcon(id); as url) { <img [src]="url" alt="" (error)="rift.hideImg($event)" /> }
              </span>
            }
          </div>
        </div>
        <button class="ghost icon-btn close" (click)="closed.emit()" title="Close" aria-label="Close"><svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" /></svg></button>
      </section>
    }

    @if (review(); as r) {
      <section #reviewCard class="roast card" [class]="'tone-' + tone(r.review.grade)" aria-live="polite">
        <div class="roast-head">
          <span class="grade" [title]="'Bro score: ' + r.review.score + ' out of 100'">{{ r.review.grade }}</span>
          <div class="verdict">
            <h3>
              The Bro's review
              @if (!r.player.isMe) { <span class="whom">{{ r.player.name ?? rift.champName(r.player.championId) }} · {{ rift.champName(r.player.championId) }}</span> }
            </h3>
            <p>{{ r.review.verdict }}</p>
          </div>
          <div class="actions">
            <button class="ghost" (click)="copy()" [title]="'Copy the review to send to your friends'">{{ copied() ? 'Copied' : 'Copy' }}</button>
            @if (!r.player.isMe) {
              @if (r.player.name) { <button class="ghost" (click)="openPlayer(r.player)">See their profile</button> }
              <button class="ghost" (click)="picked.set(null)">Your review</button>
            }
          </div>
        </div>
        <div class="lines">
          @for (x of r.review.lines; track x.kind) {
            <div class="roast-line" [class.good]="x.good" [style.animation-delay.ms]="$index * 60">
              <span class="stat mono" [title]="x.why">{{ x.stat }}</span>
              <span>{{ x.line }}</span>
            </div>
          } @empty {
            <p class="muted clean">Nothing to roast. {{ r.player.isMe ? 'You' : 'They' }} actually showed up this game.</p>
          }
        </div>
      </section>
    }

    <div class="teams" [class.solo]="g.teams.length < 2">
      @for (t of g.teams; track t.teamId) {
        <div class="team">
          <div class="team-head" [class.ally]="t.isMine" [class.enemy]="!t.isMine">
            <h3>{{ t.isMine ? 'Your team' : 'Enemy team' }}</h3>
            @if (g.result !== 'remake') { <span [class]="t.win ? 'win' : 'loss'">{{ t.win ? 'Victory' : 'Defeat' }}</span> }
            <span class="faint mono">{{ t.kills }} kills · {{ k(t.gold) }} gold</span>
            <span class="faint mono">{{ objectives(t) }}</span>
          </div>
          <div class="board" [class.clickable]="roastsOn()">
            <div class="row-p head" aria-hidden="true">
              <span class="h-who">Player</span>
              <span>KDA</span>
              <span>CS</span>
              <span>Dmg</span>
              <span>Gold</span>
              <span>Vis</span>
            </div>
            @for (p of t.players; track $index) {
              <div
                class="row-p" [class.me]="p.isMe" [class.enemy]="!t.isMine" [class.picked]="isPicked(t, $index)"
                [attr.role]="roastsOn() ? 'button' : null" [attr.tabindex]="roastsOn() ? 0 : null"
                [attr.title]="roastsOn() ? 'See what the Bro thinks of this player' : null"
                (click)="pick(t, $index)" (keydown.enter)="pick(t, $index)" (keydown.space)="$event.preventDefault(); pick(t, $index)"
              >
                <span class="pic" [title]="rift.champName(p.championId) + ' · level ' + p.level">
                  <img class="champ-icon" [src]="icon(p.championId)" alt="" />
                  <span class="lvl mono">{{ p.level }}</span>
                </span>
                <span class="name">
                  @if (p.name && !p.isMe) {
                    <button class="who" title="Open {{ p.name }}'s profile" (click)="$event.stopPropagation(); openPlayer(p)"
                            (keydown.enter)="$event.stopPropagation()" (keydown.space)="$event.stopPropagation()">{{ p.name }}</button>
                  } @else if (p.name) { {{ p.name }} } @else { <span class="faint">{{ rift.champName(p.championId) }}</span> }
                </span>
                <span class="mono">{{ p.kills }}/{{ p.deaths }}/{{ p.assists }}</span>
                <span class="mono muted">{{ p.cs }}</span>
                <div class="dmg" [title]="p.damage + ' damage to champions'">
                  <span class="mono">{{ k(p.damage) }}</span>
                  <span class="bar"><span [style.width.%]="(p.damage / maxDamage()) * 100"></span></span>
                </div>
                <span class="mono muted">{{ k(p.gold) }}</span>
                <span class="mono muted">{{ p.vision }}</span>
                <div class="items sm">
                  @for (id of p.items; track $index) {
                    <span class="slot" [rlItemTip]="id" [attr.aria-label]="rift.itemName(id) || null">
                      @if (rift.itemIcon(id); as url) { <img [src]="url" alt="" (error)="rift.hideImg($event)" /> }
                    </span>
                  }
                </div>
              </div>
            }
          </div>
        </div>
      }
    </div>

    <section class="graphs">
      <div class="graphs-head">
        <h3>Graphs</h3>
        @if (g.teams.length > 1) {
          <span class="legend">
            <span><i class="sw ally"></i>Your team</span>
            <span><i class="sw enemy"></i>Enemy team</span>
          </span>
        }
      </div>
      @if (g.goldLead && g.goldLead.length > 1) {
        <div class="chart wide">
          <div class="chart-title lead-title">
            Gold lead over time
            <b class="mono" [class.win]="g.goldLead.at(-1)!.lead > 0" [class.loss]="g.goldLead.at(-1)!.lead < 0">{{ signedK(g.goldLead.at(-1)!.lead) }}</b>
          </div>
          <rl-gold-graph [points]="g.goldLead" label="Your team's gold lead over the game" />
        </div>
      }
      <div class="charts">
        @for (c of charts; track c.key) {
          <div class="chart">
            <div class="chart-title">{{ c.title }}</div>
            @if (g.teams.length > 1) {
              <!-- The two team totals as one split bar, so who won the stat reads at a glance. -->
              <div class="split" [title]="splitTip(c.key)">
                @for (t of g.teams; track t.teamId) {
                  <span class="half" [class.ally]="t.isMine" [class.enemy]="!t.isMine" [style.flex-grow]="total(c.key, t) || 1">
                    <b class="mono">{{ k(total(c.key, t)) }}</b>
                  </span>
                }
              </div>
            }
            <div class="plot">
              @for (t of g.teams; track t.teamId) {
                <div class="group" [class.ally]="t.isMine" [class.enemy]="!t.isMine">
                  <div class="group-head">
                    <span>{{ t.isMine ? 'Your team' : 'Enemy team' }}</span>
                  </div>
                  @for (p of t.players; track $index) {
                    <div class="bar-row" [class.me]="p.isMe" [title]="tip(c.key, p, t)">
                      <img class="bar-icon" [src]="icon(p.championId)" alt="" />
                      <span class="bar-name">
                        {{ p.name ?? rift.champName(p.championId) }}
                        @if (p.isMe) { <span class="you">You</span> }
                      </span>
                      <span class="gtrack">
                        @for (tk of ticks()[c.key]; track tk) {
                          <i class="gl" [style.left]="at(c.key, tk)"></i>
                        }
                        <span class="gbar" [style.width]="barWidth(c.key, p)"></span>
                        <span class="gval mono">{{ k(p[c.key]) }}<span class="share">{{ share(c.key, p, t) }}%</span></span>
                      </span>
                    </div>
                  }
                </div>
              }
              <div class="axis-row">
                <span></span><span></span>
                <span class="axis mono">
                  @for (tk of ticks()[c.key]; track tk) {
                    <span [style.left]="at(c.key, tk)">{{ tk >= 1000 ? tk / 1000 + 'k' : tk }}</span>
                  }
                </span>
              </div>
            </div>
          </div>
        }
      </div>
    </section>
  `,
  styles: `
    /* Chart colors: validated for the dark surface (dataviz validator, OKLCH L
       0.48-0.67, CVD ΔE 26.8). Kept apart from the win/loss status colors. */
    .graphs { --team-ally: #3987e5; --team-enemy: #d95926; margin-top: 26px; }
    .graphs-head { display: flex; align-items: baseline; gap: 16px; margin-bottom: 10px; }
    .graphs-head h3 { margin: 0; }
    .legend { display: flex; gap: 14px; font-size: 12px; color: var(--text-dim); }
    .legend span { display: inline-flex; align-items: center; gap: 6px; }
    .sw { width: 10px; height: 10px; border-radius: 3px; display: inline-block; }
    .sw.ally { background: var(--team-ally); }
    .sw.enemy { background: var(--team-enemy); }
    .charts { display: grid; grid-template-columns: repeat(auto-fit, minmax(330px, 1fr)); gap: 16px; }
    .chart {
      display: flex; flex-direction: column; gap: 10px; padding: 14px 16px;
      background: var(--glass), var(--bg-raised); border: 1px solid var(--line); border-radius: 14px;
    }
    .chart.wide { margin-bottom: 16px; --gg-up: var(--team-ally); --gg-down: var(--team-enemy); }
    .lead-title { display: flex; justify-content: space-between; align-items: baseline; }
    .lead-title b { font-size: 14px; letter-spacing: 0; text-transform: none; }
    .chart-title { font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--text-faint); }
    .split { display: flex; gap: 2px; height: 22px; font-size: 11.5px; }
    .half { display: flex; align-items: center; padding: 0 8px; min-width: 52px; color: #fff; }
    .half:first-child { border-radius: 4px 0 0 4px; }
    .half:last-child { border-radius: 0 4px 4px 0; justify-content: flex-end; }
    .half.ally { background: var(--team-ally); }
    .half.enemy { background: var(--team-enemy); }
    .plot { display: flex; flex-direction: column; gap: 12px; }
    .group { display: flex; flex-direction: column; gap: 3px; }
    .group-head { display: flex; justify-content: space-between; font-size: 11.5px; font-weight: 600; padding-bottom: 2px; }
    .group.ally .group-head > span:first-child { color: var(--ally); }
    .group.enemy .group-head > span:first-child { color: var(--enemy); }
    .gl { position: absolute; top: -2px; bottom: -2px; width: 1px; background: var(--line); pointer-events: none; }
    .share { margin-left: 5px; color: var(--text-faint); }
    .axis-row { display: grid; grid-template-columns: 18px minmax(90px, 128px) 1fr; gap: 8px; margin-top: -6px; }
    .axis { position: relative; height: 14px; font-size: 10.5px; color: var(--text-faint); }
    .axis span { position: absolute; transform: translateX(-50%); }
    .axis span:first-child { transform: none; }
    .bar-row {
      display: grid; grid-template-columns: 18px minmax(90px, 128px) 1fr; align-items: center; gap: 8px;
      padding: 2px 4px; margin: 0 -4px; border-radius: 6px; font-size: 12.5px;
    }
    .bar-row:hover { background: var(--bg-hover); }
    .bar-icon { width: 18px; height: 18px; border-radius: 5px; }
    .bar-name { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: var(--text-dim); }
    .bar-row.me .bar-name { color: var(--text); font-weight: 600; }
    .you {
      margin-left: 4px; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em;
      color: var(--text); background: var(--bg-hover); border-radius: 4px; padding: 0 4px;
    }
    /* One baseline on the left; the value sits just past each bar's tip. */
    .gtrack { position: relative; display: flex; align-items: center; gap: 6px; min-width: 0; border-left: 1px solid var(--line-strong); }
    .gbar { position: relative; display: block; height: 12px; border-radius: 0 4px 4px 0; flex: none; min-width: 2px; }
    .group.ally .gbar { background: var(--team-ally); }
    .group.enemy .gbar { background: var(--team-enemy); }
    .gval { font-size: 11.5px; color: var(--text-dim); flex: none; }
    .bar-row.me .gval { color: var(--text); }

    .roast { --tone: var(--loss); margin-top: 14px; padding: 14px 18px; display: flex; flex-direction: column; gap: 8px; border-left: 3px solid var(--tone); }
    .roast.tone-top { --tone: var(--gold); }
    .roast.tone-good { --tone: var(--win); }
    .roast.tone-mid { --tone: var(--accent-2); }
    .roast.tone-meh { --tone: #ff9a4e; }
    .roast-head { display: flex; align-items: center; gap: 14px; margin-bottom: 4px; }
    .grade {
      flex: none; display: grid; place-items: center; width: 50px; height: 50px; border-radius: 14px; cursor: help;
      font: 800 24px/1 var(--display); letter-spacing: -0.03em; color: var(--tone);
      background: color-mix(in srgb, var(--tone) 12%, transparent); border: 1px solid color-mix(in srgb, var(--tone) 45%, transparent);
      box-shadow: 0 0 18px color-mix(in srgb, var(--tone) 22%, transparent);
    }
    .tone-top .grade { animation: shine 2.4s ease-in-out infinite; }
    @keyframes shine { 50% { box-shadow: 0 0 28px color-mix(in srgb, var(--tone) 50%, transparent); } }
    .verdict { flex: 1; min-width: 0; }
    .verdict p { margin: 2px 0 0; font-size: 15px; font-weight: 600; font-style: italic; }
    .whom { margin-left: 6px; text-transform: none; letter-spacing: 0; font-weight: 400; color: var(--text-dim); }
    .actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 2px; align-self: flex-start; }
    .roast .clean { margin: 0; }
    /* One stat column as wide as the widest chip, shared by every line. */
    .lines { display: grid; grid-template-columns: minmax(96px, max-content) 1fr; gap: 8px 12px; }
    .lines .clean { grid-column: 1 / -1; }
    .roast h3 { margin: 0; font-size: 12px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--tone); }
    .roast-line {
      display: grid; grid-column: 1 / -1; grid-template-columns: subgrid; align-items: baseline; font-size: 14px;
      padding-top: 8px; border-top: 1px solid var(--line); animation: line-in 0.3s ease-out both;
    }
    @keyframes line-in { from { opacity: 0; transform: translateY(4px); } }
    .roast-line .stat {
      justify-self: start; padding: 1px 7px; border-radius: 6px; font-size: 12px; white-space: nowrap; cursor: help;
      color: var(--loss); background: rgba(255, 90, 78, 0.1); border: 1px solid rgba(255, 90, 78, 0.35);
    }
    /* Highlights (praise) in green, against the red for bad play. */
    .roast-line.good .stat { color: var(--win); background: rgba(60, 207, 142, 0.1); border-color: rgba(60, 207, 142, 0.35); }
    @media (prefers-reduced-motion: reduce) { .roast-line, .tone-top .grade { animation: none; } }

    .hero { position: relative; display: flex; align-items: center; gap: 20px; padding: 24px; border-left: 3px solid var(--text-faint); }
    .hero > :not(.splash) { position: relative; }
    .hero > .close { position: absolute; top: 10px; right: 10px; }
    .hero.win { border-left-color: var(--win); }
    .hero.loss { border-left-color: var(--loss); }
    .hero.win .big { border-color: var(--win); box-shadow: 0 0 22px rgba(60, 207, 142, 0.35); }
    .hero.loss .big { border-color: var(--loss); box-shadow: 0 0 22px rgba(255, 90, 78, 0.35); }
    .big { width: 80px; height: 80px; border-radius: 18px; border: 2px solid var(--accent); }
    .grow { flex: 1; gap: 10px; min-width: 0; }
    .title { display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap; }
    .title h2 { font-size: 28px; }
    .title .lp { font-size: 18px; }
    .hero.win h2 { color: var(--win); }
    .hero.loss h2 { color: var(--loss); }
    .line { display: flex; gap: 26px; flex-wrap: wrap; }
    .line div { display: flex; flex-direction: column; gap: 1px; }
    .line b { font-size: 16px; font-weight: 600; }
    .line .faint { font-size: 11.5px; }
    .items { display: flex; gap: 4px; }
    .items .slot {
      width: 30px; height: 30px; border-radius: 5px; overflow: hidden; flex: none;
      border: 1px solid var(--line-strong); background: var(--bg-sunken);
    }
    .items .slot img { display: block; width: 100%; height: 100%; }
    .items .slot:last-child { margin-left: 4px; border-radius: 50%; }
    .items.sm .slot { width: 22px; height: 22px; border-radius: 4px; }
    .items.sm .slot:last-child { border-radius: 50%; }
    /* The two teams sit side by side once there's room, stacked below that. */
    :host { display: block; container-type: inline-size; }
    .teams { display: grid; grid-template-columns: 1fr; gap: 0 18px; }
    @container (min-width: 780px) {
      .teams:not(.solo) { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    }
    .team { min-width: 0; }
    .team-head { display: flex; align-items: baseline; flex-wrap: wrap; gap: 4px 12px; margin: 22px 0 8px; font-size: 13px; }
    .team-head h3 { margin: 0; }
    .team-head.ally h3 { color: var(--ally); }
    .team-head.enemy h3 { color: var(--enemy); }
    .board { display: flex; flex-direction: column; gap: 4px; }
    /* Champion (with level) spans both lines; name and stats on top, build underneath. */
    .row-p {
      display: grid; align-items: center; gap: 2px 10px;
      grid-template-columns: 34px minmax(0, 1fr) 60px 30px 50px 40px 26px;
      padding: 6px 10px; border-radius: 12px; background: var(--glass), var(--bg-raised); border: 1px solid var(--line);
      border-left: 3px solid var(--ally); font-size: 13px;
    }
    .row-p > .items { grid-column: 2 / -1; }
    .row-p.head {
      background: none; border-color: transparent; padding-top: 0; padding-bottom: 0;
      font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--text-faint);
    }
    .row-p.head .h-who { grid-column: 1 / 3; }
    .row-p.enemy { border-left-color: var(--enemy); }
    .board.clickable .row-p:not(.head) { cursor: pointer; }
    .board.clickable .row-p:not(.head):hover { background: var(--glass), var(--bg-hover); }
    .row-p.picked { outline: 1px solid var(--loss); outline-offset: -1px; }
    .row-p.me { background: linear-gradient(90deg, var(--accent-soft), transparent 60%), var(--bg-raised); border-left-color: var(--accent); }
    .pic { grid-row: span 2; position: relative; width: 34px; height: 34px; }
    .pic .champ-icon { width: 34px; height: 34px; }
    .lvl {
      position: absolute; right: -4px; bottom: -4px; min-width: 16px; padding: 0 3px; border-radius: 6px;
      font-size: 10px; line-height: 15px; text-align: center; color: var(--text-dim);
      background: var(--bg-sunken); border: 1px solid var(--line-strong);
    }
    .name { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .who {
      background: none; border: none; padding: 0; font: inherit; color: inherit; cursor: pointer; max-width: 100%; overflow: hidden; text-overflow: ellipsis;
      text-decoration: underline dotted var(--text-faint); text-underline-offset: 3px;
    }
    .who:hover:not(:disabled), .who:focus-visible { color: var(--accent); text-decoration: underline; background: none; border-color: transparent; }
    .dmg { display: flex; flex-direction: column; gap: 3px; }
    .bar { width: 100%; height: 4px; border-radius: 999px; background: var(--bg-sunken); overflow: hidden; }
    .bar span { display: block; height: 100%; background: var(--accent); opacity: 0.75; }
    .row-p.enemy .bar span { background: var(--enemy); }
  `,
})
export class PostGameView {
  protected readonly rift = inject(RiftService);
  readonly game = input.required<PostGame>();
  readonly closed = output<void>();
  private readonly reviewCard = viewChild<ElementRef<HTMLElement>>('reviewCard');

  constructor() {
    // A different game starts back on your own review.
    effect(() => {
      this.game();
      this.picked.set(null);
    });
  }

  protected readonly myTeam = computed(() => this.game().teams.find((t) => t.isMine) ?? null);
  protected readonly me = computed(() => this.myTeam()?.players.find((p) => p.isMe) ?? null);
  protected readonly label = computed(() => RESULT_LABEL[this.game().result]);
  /** Roasts are on in Settings (on until the settings load). */
  protected readonly roastsOn = computed(() => this.rift.config()?.showRoasts ?? true);
  /** The scoreboard player whose review is shown (team id and seat); null = you. */
  protected readonly picked = signal<{ teamId: number; seat: number } | null>(null);
  /** The review card: yours only when there's something to roast, anyone else's when clicked. */
  protected readonly review = computed(() => {
    if (!this.roastsOn()) return null;
    const g = this.game();
    const at = this.picked();
    const team = at ? g.teams.find((t) => t.teamId === at.teamId) : this.myTeam();
    const player = at ? team?.players[at.seat] : this.me();
    if (!team || !player) return null;
    const r = review(g, team, player, (id) => this.rift.champName(id));
    return r ? { player, review: r } : null;
  });
  protected readonly copied = signal(false);
  protected readonly maxDamage = computed(() =>
    Math.max(1, ...this.game().teams.flatMap((t) => t.players.map((p) => p.damage))),
  );
  protected readonly killShare = computed(() => {
    const m = this.me();
    const team = this.myTeam();
    if (!m || !team || team.kills === 0) return null;
    return Math.round(((m.kills + m.assists) / team.kills) * 100);
  });

  protected readonly charts: { key: 'gold' | 'damage'; title: string; unit: string }[] = [
    { key: 'gold', title: 'Gold earned', unit: 'gold' },
    { key: 'damage', title: 'Damage to champions', unit: 'damage' },
  ];
  /** Axis top per chart: the largest value rounded up to a tick; every bar in a chart shares one scale. */
  private readonly chartMax = computed(() => {
    const players = this.game().teams.flatMap((t) => t.players);
    const top = (n: number) => Math.ceil(n / tickStep(n)) * tickStep(n);
    return {
      gold: top(Math.max(1, ...players.map((p) => p.gold))),
      damage: top(Math.max(1, ...players.map((p) => p.damage))),
    };
  });
  /** Gridline values per chart, from 0 to the axis top. */
  protected readonly ticks = computed(() => {
    const max = this.chartMax();
    const ticks = (top: number) => {
      const step = tickStep(top);
      return Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step);
    };
    return { gold: ticks(max.gold), damage: ticks(max.damage) };
  });

  protected icon = championIcon;
  protected time = clock;

  /** Bar length on the chart's axis. */
  barWidth(key: 'gold' | 'damage', p: PostPlayer): string {
    return this.at(key, p[key]);
  }
  /** Where a value sits on the chart's axis (70px kept free at the end for the value and share). */
  at(key: 'gold' | 'damage', v: number): string {
    return `calc((100% - 70px) * ${(v / this.chartMax()[key]).toFixed(4)})`;
  }
  total(key: 'gold' | 'damage', t: PostTeam): number {
    return t.players.reduce((a, x) => a + x[key], 0);
  }
  share(key: 'gold' | 'damage', p: PostPlayer, t: PostTeam): number {
    const total = this.total(key, t);
    return total > 0 ? Math.round((p[key] / total) * 100) : 0;
  }
  splitTip(key: 'gold' | 'damage'): string {
    const unit = this.charts.find((c) => c.key === key)!.unit;
    return this.game().teams.map((t) => `${t.isMine ? 'Your team' : 'Enemy team'}: ${this.total(key, t).toLocaleString()} ${unit}`).join(' · ');
  }
  tip(key: 'gold' | 'damage', p: PostPlayer, t: PostTeam): string {
    const share = this.share(key, p, t);
    const who = p.name ?? this.rift.champName(p.championId);
    const unit = this.charts.find((c) => c.key === key)!.unit;
    return `${who} (${this.rift.champName(p.championId)}): ${p[key].toLocaleString()} ${unit}, ${share}% of ${t.isMine ? 'your' : 'their'} team`;
  }

  /** Their profile on the Profile page. */
  openPlayer(p: PostPlayer): void {
    // No puuid (seen on some players): looked up by Riot ID instead.
    this.rift.showPlayer({ puuid: p.puuid || null, riotId: p.name });
  }

  pick(t: PostTeam, seat: number): void {
    if (!this.roastsOn()) return;
    const already = this.isPicked(t, seat);
    this.picked.set(already || t.players[seat].isMe ? null : { teamId: t.teamId, seat });
    // The card sits above the scoreboard, so bring it into view.
    setTimeout(() => this.reviewCard()?.nativeElement.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
  }
  /** The review as text on the clipboard, for the group chat. */
  copy(): void {
    const r = this.review();
    if (!r) return;
    const champ = this.rift.champName(r.player.championId);
    const who = r.player.isMe ? `my ${champ}` : `${r.player.name ?? champ} (${champ})`;
    navigator.clipboard?.writeText(reviewText(r.review, who)).then(
      () => {
        this.copied.set(true);
        setTimeout(() => this.copied.set(false), 1500);
      },
      () => undefined,
    );
  }
  tone(g: Grade): string {
    return g === 'S+' || g === 'S' ? 'top' : g === 'A' ? 'good' : g === 'B' ? 'mid' : g === 'C' ? 'meh' : 'bad';
  }
  isPicked(t: PostTeam, seat: number): boolean {
    const at = this.picked();
    return !!at && at.teamId === t.teamId && at.seat === seat;
  }

  kda = (p: PostPlayer) => kdaRatio(p.kills, p.deaths, p.assists);
  perMin(n: number): string {
    return (n / Math.max(1, this.game().duration / 60)).toFixed(1);
  }
  k(n: number): string {
    return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
  }
  signedK(n: number): string {
    return (n > 0 ? '+' : n < 0 ? '−' : '±') + this.k(Math.abs(n));
  }
  objectives(t: PostTeam): string {
    const n = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;
    return [n(t.towers, 'tower'), n(t.dragons, 'dragon'), n(t.barons, 'baron')].join(' · ');
  }
  mode(m: string): string {
    return m ? m.charAt(0) + m.slice(1).toLowerCase() : 'Game';
  }
}

/** A round gridline step giving about 3–5 lines up to `max`. */
function tickStep(max: number): number {
  const raw = max / 4;
  const mag = 10 ** Math.floor(Math.log10(raw));
  return [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag;
}
