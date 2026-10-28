import { ChangeDetectionStrategy, Component, DestroyRef, Injector, afterNextRender, computed, effect, inject, signal, untracked } from '@angular/core';
import { DecimalPipe, NgTemplateOutlet } from '@angular/common';
import { RiftService } from '../core/rift.service';
import { championIcon, formatTier, kdaRatio, profileIcon, queueLabel, rankCrest, tierClass, winPct } from '../core/assets';
import { LpPoint, MatchLine, MyProfile, PostGame, RankLine } from '../core/models';
import { PostGameView } from './post-game';
import { ItemTip } from './item-tip';
import { LpGraph } from './lp-graph';
import { Loader } from './loader';

const RESULT_LABEL = { win: 'Victory', loss: 'Defeat', remake: 'Remake' } as const;

/** OP.GG's region codes. */
const REGIONS = [
  ['na', 'North America'], ['euw', 'Europe West'], ['eune', 'Europe Nordic & East'], ['kr', 'Korea'], ['br', 'Brazil'],
  ['lan', 'Latin America North'], ['las', 'Latin America South'], ['oce', 'Oceania'], ['tr', 'Türkiye'], ['ru', 'Russia'],
  ['jp', 'Japan'], ['me', 'Middle East'], ['ph', 'Philippines'], ['sg', 'Singapore'], ['th', 'Thailand'], ['tw', 'Taiwan'], ['vn', 'Vietnam'],
].map(([code, label]) => ({ code, label }));

/** Your rank, insights from recent games, and match history. */
@Component({
  selector: 'rl-profile',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DecimalPipe, NgTemplateOutlet, PostGameView, ItemTip, LpGraph, Loader],
  template: `
    @if (setup()) {
      <section class="card empty">
        <h2>{{ editing() ? 'Change your Riot ID' : 'See your profile without League running' }}</h2>
        <p class="muted">While the League client is closed, League Bro looks you up on OP.GG. Your Riot ID is the Name#TAG the client shows.</p>
        <form class="riot-form" (submit)="saveRiotId($event, idInput.value, regionSel.value)">
          <input #idInput name="riotId" placeholder="Name#TAG" [value]="rift.config()?.riotId ?? ''" autocomplete="off" spellcheck="false" />
          <select #regionSel name="region" aria-label="Region">
            @for (r of regions; track r.code) { <option [value]="r.code" [selected]="r.code === (rift.config()?.region ?? 'na')">{{ r.label }}</option> }
          </select>
          <button type="submit">Show my profile</button>
        </form>
        @if (formError(); as e) { <p class="loss small">{{ e }}</p> }
        @if (editing()) { <button class="ghost" (click)="editing.set(false)">Cancel</button> }
      </section>
    } @else if (waiting() && !profile()) {
      <section class="card empty"><p class="muted">Waiting for the League client to finish starting…</p></section>
    } @else if (loading() && !profile()) {
      <section class="card empty"><rl-loader [size]="44" [block]="true" class="muted">Loading your profile from {{ rift.status().connected ? 'the League client' : 'OP.GG' }}…</rl-loader></section>
    } @else if (loadError(); as e) {
      <section class="card empty">
        <h2>Couldn't load your profile</h2>
        <p class="muted">{{ e }}</p>
        <div class="row center">
          <button class="ghost icon-btn" (click)="load()" title="Try again" aria-label="Try again"><svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M20 12a8 8 0 1 1-2.34-5.66M20 4v5h-5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" /></svg></button>
          @if (!rift.status().connected) { <button class="ghost" (click)="editing.set(true)">Change Riot ID</button> }
        </div>
      </section>
    } @else if (profile(); as p) {
      <section class="card head">
        <div class="me">
        @if (icon(p.iconId); as url) { <img class="avatar" [src]="url" alt="" /> } @else { <div class="avatar"></div> }
        <div class="who" [title]="p.name">
          <h2>{{ p.name }}</h2>
          <div class="muted small">Level {{ p.level }}</div>
          @if (p.source === 'opgg') {
            <div class="faint small">
              From OP.GG · updated {{ p.updatedAt ? ago(p.updatedAt) : 'a while ago' }} ·
              <button class="link" (click)="editing.set(true)">Change Riot ID</button>
            </div>
          }
        </div>
        </div>
        <div class="ranks">
          @for (r of ranks(p); track r.label) {
            <div class="rank">
              <img class="crest" [class.unranked]="!r.line" [src]="crest(r.line?.tier)" [alt]="r.line ? tier(r.line.tier, r.line.division) : 'Unranked'" />
              <div class="rank-text">
                <div class="faint cap">{{ r.label }}</div>
                @if (r.line; as l) {
                  <div [class]="tierCls(l.tier)">{{ tier(l.tier, l.division) }} <span class="muted mono">{{ l.lp }} LP</span></div>
                  <div class="faint small mono">{{ l.wins }}W {{ l.losses }}L · {{ pct(l.wins, l.wins + l.losses) }}%</div>
                } @else {
                  <div class="tier-none">Unranked</div>
                }
              </div>
            </div>
          }
        </div>
        <div class="side">
          @for (r of ranked(p); track r.label) {
            <div class="graph">
              @if (ranked(p).length > 1) { <div class="faint cap">{{ r.label }}</div> }
              <rl-lp-graph [points]="r.history" />
            </div>
          }
        <div class="actions">
          @if (p.source === 'opgg') {
            <button class="ghost" [disabled]="renewing() || loading()" title="Has OP.GG fetch your latest games and rank from Riot (once every 2 minutes)" (click)="renew(p.updatedAt)">
              {{ renewing() ? 'Updating…' : 'Update on OP.GG' }}
            </button>
          }
          <button class="ghost icon-btn" [disabled]="loading() || renewing()" [title]="loading() ? 'Refreshing…' : 'Refresh'" [attr.aria-label]="loading() ? 'Refreshing' : 'Refresh'" (click)="load()">
            @if (loading()) {
              <rl-loader [size]="20" />
            } @else {
              <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M20 12a8 8 0 1 1-2.34-5.66M20 4v5h-5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" /></svg>
            }
          </button>
        </div>
        </div>
      </section>
      @if (p.error) { <p class="loss small note">Some data didn't load: {{ p.error }}</p> }
      @if (renewError(); as e) { <p class="loss small note">Couldn't update OP.GG: {{ e }}</p> }

      @if (p.modes.length > 1) {
        <div class="seg modes">
          <button [class.on]="mode() === 'all'" (click)="pick('all')">All <span class="mono count">{{ p.insights.games }}</span></button>
          @for (q of p.modes; track q.queueId) {
            <button [class.on]="mode() === q.queueId" (click)="pick(q.queueId)" [title]="q.queueId === p.currentQueueId ? 'In this queue now' : ''">
              @if (q.queueId === p.currentQueueId) { <span class="now"></span> }
              {{ queue(q.queueId, modeName(p, q.queueId)) }} <span class="mono count">{{ q.insights.games }}</span>
            </button>
          }
        </div>
      }

      @if (ins(); as ins) {
      @if (ins.games > 0) {
        <div class="tiles">
          <div class="tile">
            <div class="big" [class.win]="winRate() >= 55" [class.loss]="winRate() < 45">{{ winRate() }}%</div>
            <div class="faint small">win rate · {{ ins.wins }}W {{ ins.games - ins.wins }}L</div>
          </div>
          <div class="tile">
            <div class="big mono">{{ ratio(ins.kills, ins.deaths, ins.assists) }}</div>
            <div class="faint small">KDA · {{ ins.kills / ins.games | number: '1.1-1' }} / {{ ins.deaths / ins.games | number: '1.1-1' }} / {{ ins.assists / ins.games | number: '1.1-1' }}</div>
          </div>
          <div class="tile"><div class="big mono">{{ ins.csPerMin | number: '1.1-1' }}</div><div class="faint small">CS per minute</div></div>
          <div class="tile"><div class="big mono">{{ ins.damagePerMin | number: '1.0-0' }}</div><div class="faint small">damage per minute</div></div>
          <div class="tile"><div class="big mono">{{ ins.goldPerMin | number: '1.0-0' }}</div><div class="faint small">gold per minute</div></div>
          @if (p.source !== 'opgg') {
            <div class="tile"><div class="big mono">{{ ins.visionPerGame | number: '1.0-0' }}</div><div class="faint small">vision per game</div></div>
          }
          <div class="tile">
            <div class="big mono" [class.win]="ins.streak > 1" [class.loss]="ins.streak < -1">{{ abs(ins.streak) }}{{ ins.streak >= 0 ? 'W' : 'L' }}</div>
            <div class="faint small">current streak</div>
          </div>
        </div>

        <div class="grid">
          <section class="card stack">
            <h3>Champions</h3>
            @for (c of ins.champions.slice(0, 6); track c.championId) {
              <button class="crow" [title]="rift.champName(c.championId) + ': open the build'" (click)="openBuild(c.championId)">
                <img class="champ-icon sm" [src]="champIcon(c.championId)" alt="" />
                <span class="grow">{{ rift.champName(c.championId) }}</span>
                <span class="mono faint">{{ c.games }} {{ c.games === 1 ? 'game' : 'games' }}</span>
                <span class="mono wr" [class.win]="pct(c.wins, c.games) >= 55" [class.loss]="pct(c.wins, c.games) < 45">{{ pct(c.wins, c.games) }}%</span>
                <span class="mono muted kda">{{ ratio(c.kills, c.deaths, c.assists) }} KDA</span>
              </button>
            }
          </section>
          @if (mode() === 'all') {
            <section class="card stack">
              <h3>Queues</h3>
              @for (q of ins.queues; track q.queueId) {
                <button class="qrow" (click)="pick(q.queueId)">
                  <span class="grow">{{ queue(q.queueId, modeName(p, q.queueId)) }}</span>
                  <span class="mono faint">{{ q.wins }}W {{ q.games - q.wins }}L</span>
                  <span class="bar"><span [style.width.%]="pct(q.wins, q.games)"></span></span>
                  <span class="mono wr">{{ pct(q.wins, q.games) }}%</span>
                </button>
              }
            </section>
          }
          @if (hasLanes() || hasEnemies()) {
            <section class="card stack">
              <div class="card-head">
                <h3>Toughest {{ tough() === 'lane' ? 'lane opponents' : 'enemies' }}</h3>
                @if (hasLanes() && hasEnemies()) {
                  <div class="seg mini" role="tablist">
                    <button role="tab" [class.on]="tough() === 'enemy'" [attr.aria-selected]="tough() === 'enemy'" (click)="toughTab.set('enemy')">Any enemy</button>
                    <button role="tab" [class.on]="tough() === 'lane'" [attr.aria-selected]="tough() === 'lane'" (click)="toughTab.set('lane')">Lane</button>
                  </div>
                }
              </div>
              @if (tough() === 'lane') {
                @for (c of ins.toughestLanes; track c.championId) {
                  <ng-container *ngTemplateOutlet="vsRow; context: { $implicit: c }" />
                } @empty {
                  <p class="faint small">No lane opponent has beaten you more often than not in 2+ games.</p>
                }
                <p class="faint small foot">Your lane opponent is a best guess from the client's lane data, Smite and CS.</p>
              } @else {
                @for (c of ins.toughestEnemies; track c.championId) {
                  <ng-container *ngTemplateOutlet="vsRow; context: { $implicit: c }" />
                } @empty {
                  <p class="faint small">No enemy champion has beaten you more often than not in 2+ games.</p>
                }
                <p class="faint small foot">Anywhere on the enemy team. Your K/D/A in those games.</p>
              }
            </section>
          }
        </div>
      }
      }

      <ng-template #vsRow let-c>
        <button class="crow" [title]="'How to play against ' + rift.champName(c.championId)" (click)="rift.showChampion(c.championId, { view: 'guide' })">
          <img class="champ-icon sm" [src]="champIcon(c.championId)" alt="" />
          <span class="grow">{{ rift.champName(c.championId) }}</span>
          <span class="mono faint">{{ c.wins }}W {{ c.games - c.wins }}L</span>
          <span class="mono wr loss">{{ pct(c.wins, c.games) }}%</span>
          <span class="mono muted kda">{{ ratio(c.kills, c.deaths, c.assists) }} KDA</span>
        </button>
      </ng-template>

      <div class="row history-head">
        <h3>Match history</h3>
        <span class="faint small">
          @if (mode() === 'all') {
            Your last {{ p.matches.length }} games {{ where() }}.
          } @else {
            {{ matches().length }} {{ modeLabel() }} {{ matches().length === 1 ? 'game' : 'games' }} of your last {{ p.matches.length }} {{ where() }}.
          }
          Custom and practice games aren't included, and neither are Brawl or League Classic.
        </span>
      </div>
      @if (matches().length === 0) {
        <p class="faint">No games yet.</p>
      }
      <div class="matches">
        @if (matches().length) {
          <div class="match-head" aria-hidden="true">
            <span></span>
            <span>Game</span>
            <span>KDA</span>
            <span>Level</span>
            <span>CS</span>
            <span class="c-dmg">Damage</span>
            <span>Gold</span>
            <span class="c-build">Build</span>
          </div>
        }
        @for (day of days(); track day.key) {
          <div class="day">
            <span class="day-label">{{ day.label }}</span>
            <span class="faint">{{ day.summary }}</span>
          </div>
          @for (m of day.matches; track m.gameId) {
          <div class="item" [class.open]="openId() === m.gameId">
          <button class="match" [class]="m.result" [class.static]="p.source === 'opgg'" [attr.aria-expanded]="openId() === m.gameId" (click)="toggle(m, $event)">
            <img class="champ-icon" [src]="champIcon(m.championId)" [title]="rift.champName(m.championId)" alt="" />
            <div class="what">
              <div class="res">{{ resultLabel(m) }}</div>
              <div class="faint small">
                {{ queue(m.queueId, m.gameMode) }} · {{ ago(m.created) }} · {{ mins(m.duration) }}
                @if (m.laneOpponent; as opp) {
                  · vs <img class="vs" [src]="champIcon(opp)" alt="" /> {{ rift.champName(opp) }}
                }
              </div>
            </div>
            <div>
              <div class="mono">{{ m.kills }} / {{ m.deaths }} / {{ m.assists }}</div>
              <div class="faint small mono">{{ ratio(m.kills, m.deaths, m.assists) }} KDA</div>
            </div>
            <div class="mono">{{ m.level }}</div>
            <div>
              <div class="mono">{{ m.cs }}</div>
              <div class="faint small mono">{{ m.cs / (m.duration / 60 || 1) | number: '1.1-1' }}/min</div>
            </div>
            <div class="c-dmg">
              <div class="mono">{{ m.damage | number }}</div>
              <div class="faint small mono">{{ m.damage / (m.duration / 60 || 1) | number: '1.0-0' }}/min</div>
            </div>
            <div>
              <div class="mono">{{ m.gold | number }}</div>
              <div class="faint small mono">{{ m.gold / (m.duration / 60 || 1) | number: '1.0-0' }}/min</div>
            </div>
            <div class="items c-build">
              @for (id of m.items; track $index) {
                <span class="slot" [rlItemTip]="id">@if (rift.itemIcon(id); as url) { <img [src]="url" alt="" (error)="rift.hideImg($event)" /> }</span>
              }
            </div>
          </button>
          @if (openId() === m.gameId) {
            <div class="detail">
              @if (detail(); as d) {
                <rl-post-game [game]="d" (closed)="openId.set(null)" />
              } @else if (detailError(); as e) {
                <p class="loss small">{{ e }}</p>
              } @else {
                <rl-loader [block]="true" class="muted small">Loading the full scoreboard…</rl-loader>
              }
            </div>
          }
          </div>
          }
        }
      </div>
    }
  `,
  styles: `
    .empty { max-width: 560px; margin: 40px auto; text-align: center; }
    /* You on the left, your ranks centered, LP graphs and buttons on the right.
       When space runs short a long name is cut with "…" rather than running
       under the ranks; on a narrow window the ranks drop to their own row. */
    .head {
      display: grid; grid-template-columns: minmax(0, 1fr) auto minmax(max-content, 1fr);
      grid-template-areas: 'me ranks side'; align-items: center; gap: 20px;
    }
    .me { grid-area: me; display: flex; align-items: center; gap: 16px; min-width: 0; }
    .avatar { flex: none; }
    .who h2 { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .head .ranks { grid-area: ranks; justify-content: center; }
    .side { grid-area: side; display: flex; align-items: center; justify-content: flex-end; gap: 18px; }
    .graph { display: flex; flex-direction: column; gap: 2px; }
    @keyframes spin { to { transform: rotate(360deg); } }
    @media (max-width: 1100px) {
      .head { grid-template-columns: 1fr auto; grid-template-areas: 'me side' 'ranks ranks'; row-gap: 14px; }
    }
    @media (max-width: 760px) {
      .head { grid-template-columns: 1fr; grid-template-areas: 'me' 'ranks' 'side'; }
      .side { justify-content: center; flex-wrap: wrap; }
    }
    .avatar { width: 64px; height: 64px; border-radius: 50%; border: 2px solid var(--accent); background: var(--bg-sunken); box-shadow: 0 0 22px var(--accent-glow); }
    .who { min-width: 0; }
    .who h2 { font-size: 24px; }
    .ranks { display: flex; gap: 36px; flex-wrap: wrap; }
    .rank { display: flex; align-items: center; gap: 12px; }
    .rank-text { display: flex; flex-direction: column; gap: 2px; }
    .crest { width: 44px; height: 44px; object-fit: contain; flex: none; }
    .crest.unranked { opacity: 0.45; }
    .cap { font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.08em; }
    .small { font-size: 12.5px; margin: 0; }
    .note { margin-top: 8px; }
    .tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(118px, 1fr)); gap: 12px; margin-top: 12px; }
    .tile { background: var(--glass), var(--bg-raised); border: 1px solid var(--line); border-radius: var(--radius); padding: 12px 14px; }
    .big { font: 800 22px var(--display); }
    .modes { margin-top: 12px; flex-wrap: wrap; border-radius: 18px; }
    .modes .count { opacity: 0.6; margin-left: 4px; }
    .now { display: inline-block; width: 7px; height: 7px; border-radius: 50%; background: var(--win); margin-right: 5px; vertical-align: 1px; }
    /* Cards in a row share its height, so the row has no ragged gaps under the shorter ones. */
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 12px; margin-top: 12px; }
    .card.stack { gap: 6px; }
    h3 { margin: 0; }
    /* Same header height with or without tabs, so rows line up across cards. */
    .card.stack > h3 { min-height: 26px; display: flex; align-items: center; }
    .crow, .qrow { display: flex; align-items: center; gap: 10px; font-size: 13px; }
    .crow, .qrow { width: 100%; padding: 2px 0; background: none; border: none; border-radius: 6px; color: var(--text); text-align: left; font-weight: 400; }
    .crow:hover:not(:disabled), .qrow:hover:not(:disabled) { background: var(--bg-hover); }
    .foot { margin-top: auto; padding-top: 6px; }
    .card-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; min-height: 26px; }
    .seg.mini { padding: 2px; }
    .seg.mini button { padding: 1px 10px; font-size: 12px; }
    .vs { width: 16px; height: 16px; border-radius: 4px; vertical-align: -3px; }
    .grow { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .wr { width: 40px; text-align: right; }
    .kda { width: 70px; text-align: right; }
    .bar { width: 90px; height: 6px; border-radius: 999px; background: var(--bg-sunken); overflow: hidden; }
    .bar span { display: block; height: 100%; background: var(--accent); opacity: 0.8; }
    .history-head { align-items: baseline; gap: 12px; margin: 24px 0 10px; flex-wrap: wrap; }
    .matches { display: flex; flex-direction: column; gap: 10px; }
    .day {
      display: flex; align-items: baseline; gap: 12px; margin-top: 14px; padding: 0 2px 6px;
      border-bottom: 1px solid var(--line); font-size: 12.5px;
    }
    .match-head + .day { margin-top: 2px; }
    .day-label { font-weight: 700; color: var(--text-dim); letter-spacing: 0.02em; }
    /* An opened match: its row and scoreboard framed as one card. The negative
       margin keeps the row lined up with the column headers; the frame is an
       outline so it takes no space and can't throw that off. */
    .item.open {
      margin: 4px -8px; padding: 8px; border-radius: 18px;
      outline: 1px solid var(--accent); outline-offset: -1px;
      background: var(--bg-sunken); box-shadow: 0 0 0 4px var(--accent-soft);
    }
    .match, .match-head {
      display: grid; grid-template-columns: 44px minmax(150px, 1.3fr) 92px 40px 64px 76px 68px 190px; align-items: center; gap: 14px;
      padding: 8px 14px; border: 1px solid var(--line); border-left: 3px solid var(--text-faint); border-radius: 12px;
    }
    .match { width: 100%; text-align: left; background: var(--glass), var(--bg-raised); color: var(--text); }
    .match-head {
      padding-top: 0; padding-bottom: 2px; border-color: transparent;
      font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--text-faint);
    }
    .match:hover { border-color: var(--line-strong); }
    .match.static { cursor: default; }
    .actions { display: flex; align-items: center; gap: 8px; }
    .riot-form { display: flex; gap: 8px; justify-content: center; flex-wrap: wrap; margin: 14px 0 6px; }
    .riot-form input { flex: 1 1 180px; max-width: 240px; }
    .center { justify-content: center; gap: 8px; }
    .link { background: none; border: none; padding: 0; color: var(--accent); font: inherit; cursor: pointer; }
    .link:hover { text-decoration: underline; }
    .match.win { border-left-color: var(--win); }
    .match.loss { border-left-color: var(--loss); }
    .match.win .res { color: var(--win); }
    .match.loss .res { color: var(--loss); }
    .match.remake .res { color: var(--text-dim); }
    .res { font-weight: 600; }
    .items { display: flex; gap: 3px; }
    .slot { width: 24px; height: 24px; border-radius: 6px; overflow: hidden; border: 1px solid var(--line-strong); background: var(--bg-sunken); flex: none; }
    .slot img { display: block; width: 100%; height: 100%; }
    .slot:last-child { border-radius: 50%; margin-left: 3px; }
    .detail { padding: 10px 4px 4px; }
    @media (max-width: 1000px) {
      .match, .match-head { grid-template-columns: 44px 1fr 92px 40px 64px 68px; }
      .match .c-dmg, .match .c-build, .match-head .c-dmg, .match-head .c-build { display: none; }
    }
  `,
})
export class ProfileView {
  protected readonly rift = inject(RiftService);
  private readonly injector = inject(Injector);
  protected readonly profile = signal<MyProfile | null>(null);
  protected readonly loading = signal(false);
  protected readonly loadError = signal<string | null>(null);
  /** The client is open but not connected yet, so OP.GG isn't asked; loads once it connects. */
  protected readonly waiting = signal(false);
  /** Each load's number, so an answer that arrives after a newer load started is dropped. */
  private loadSeq = 0;
  private destroyed = false;
  protected readonly openId = signal<number | null>(null);
  protected readonly detail = signal<PostGame | null>(null);
  protected readonly detailError = signal<string | null>(null);
  /** Changing the Riot ID (the form over a loaded profile). */
  protected readonly editing = signal(false);
  protected readonly formError = signal<string | null>(null);
  protected readonly renewing = signal(false);
  protected readonly renewError = signal<string | null>(null);
  protected readonly regions = REGIONS;
  /** The Riot ID form: asked for, or needed because there's no client and no Riot ID. */
  protected readonly setup = computed(() => {
    const c = this.rift.config();
    return this.editing() || (c !== null && !c.riotId && !this.rift.status().connected && this.profile()?.source !== 'client');
  });
  protected readonly where = computed(() => (this.profile()?.source === 'opgg' ? 'on OP.GG' : 'in the League client'));

  /** 'all' or a queue id. Starts on All; a refresh keeps what you picked. */
  protected readonly mode = signal<number | 'all'>('all');

  protected readonly ins = computed(() => {
    const p = this.profile();
    const m = this.mode();
    return m === 'all' ? p?.insights : p?.modes.find((q) => q.queueId === m)?.insights;
  });
  /** Matches grouped by local calendar day, newest first. */
  protected readonly days = computed(() => {
    const groups: { key: string; label: string; summary: string; matches: MatchLine[] }[] = [];
    for (const m of this.matches()) {
      const d = new Date(m.created);
      const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      let g = groups.at(-1);
      if (!g || g.key !== key) {
        g = { key, label: this.dayLabel(d), summary: '', matches: [] };
        groups.push(g);
      }
      g.matches.push(m);
    }
    for (const g of groups) {
      const wins = g.matches.filter((m) => m.result === 'win').length;
      const losses = g.matches.filter((m) => m.result === 'loss').length;
      const n = g.matches.length;
      g.summary = `${n} ${n === 1 ? 'game' : 'games'} · ${wins}W ${losses}L`;
    }
    return groups;
  });

  protected readonly matches = computed(() => {
    const all = this.profile()?.matches ?? [];
    const m = this.mode();
    return m === 'all' ? all : all.filter((x) => x.queueId === m);
  });
  protected readonly modeLabel = computed(() => {
    const p = this.profile();
    const m = this.mode();
    return p && m !== 'all' ? this.queue(m, this.modeName(p, m)) : '';
  });
  protected readonly hasLanes = computed(() => this.matches().some((m) => m.laneOpponent));
  protected readonly hasEnemies = computed(() => this.matches().some((m) => m.enemies.length > 0));
  /** The Toughest card's tab; falls back to whichever list has data. */
  protected readonly toughTab = signal<'lane' | 'enemy'>('enemy');
  protected readonly tough = computed(() => (this.hasLanes() && this.hasEnemies() ? this.toughTab() : this.hasLanes() ? 'lane' : 'enemy'));
  protected readonly winRate = computed(() => {
    const i = this.ins();
    return i ? this.pct(i.wins, i.games) : 0;
  });

  protected champIcon = championIcon;
  protected icon = profileIcon;
  protected tier = formatTier;
  protected tierCls = tierClass;
  protected crest = rankCrest;
  protected abs = Math.abs;

  constructor() {
    inject(DestroyRef).onDestroy(() => (this.destroyed = true));
    // League opened or closed: switch between the client's data and OP.GG's.
    // A load still running was asked of the old source, so it's redone too.
    effect(() => {
      const connected = this.rift.status().connected;
      untracked(() => {
        const p = this.profile();
        const stale = p !== null && (p.source === 'opgg') === connected;
        if (!p || stale || this.loading() || this.waiting()) this.load();
      });
    });
  }

  async saveRiotId(event: Event, riotId: string, region: string): Promise<void> {
    event.preventDefault();
    const id = riotId.trim();
    const hash = id.lastIndexOf('#');
    if (hash <= 0 || hash === id.length - 1) {
      this.formError.set('Enter your Riot ID as Name#TAG, for example Faker#KR1.');
      return;
    }
    this.formError.set(null);
    await this.rift.updateConfig((c) => ({ ...c, riotId: id, region }));
    this.editing.set(false);
    // Looked up again from scratch, so an error from the old ID doesn't linger.
    this.profile.set(null);
    this.loadError.set(null);
    await this.load();
  }

  async renew(updatedAt: number | null): Promise<void> {
    this.renewing.set(true);
    this.renewError.set(null);
    try {
      this.profile.set(await this.rift.renewProfile(updatedAt));
    } catch (e) {
      this.renewError.set(String(e));
    } finally {
      this.renewing.set(false);
    }
  }

  async load(): Promise<void> {
    const seq = ++this.loadSeq;
    this.loading.set(true);
    try {
      const p = await this.rift.getMyProfile();
      if (seq !== this.loadSeq) return;
      this.profile.set(p);
      this.loadError.set(null);
      this.waiting.set(false);
      // The picked queue is gone from the new data (e.g. switched to OP.GG's).
      const m = this.mode();
      if (m !== 'all' && !p.modes.some((q) => q.queueId === m)) this.mode.set('all');
    } catch (e) {
      if (seq !== this.loadSeq) return;
      const waiting = String(e).includes('Waiting for the League client');
      this.waiting.set(waiting);
      if (waiting) {
        this.loadError.set(null);
        // Asked again in case the client closes instead of connecting.
        setTimeout(() => !this.destroyed && seq === this.loadSeq && this.load(), 5000);
      }
      else if (!this.profile()) this.loadError.set(String(e));
    } finally {
      if (seq === this.loadSeq) this.loading.set(false);
    }
  }

  async toggle(m: MatchLine, ev?: Event): Promise<void> {
    // OP.GG's match list has no full scoreboards.
    if (this.profile()?.source === 'opgg') return;
    this.keepInPlace(ev?.currentTarget as HTMLElement | undefined);
    if (this.openId() === m.gameId) {
      this.openId.set(null);
      return;
    }
    this.openId.set(m.gameId);
    this.detail.set(null);
    this.detailError.set(null);
    try {
      const d = await this.rift.getMatch(m.gameId, this.queue(m.queueId, m.gameMode));
      if (this.openId() === m.gameId) this.detail.set(d);
    } catch (e) {
      if (this.openId() === m.gameId) this.detailError.set(String(e));
    }
  }

  /**
   * Keeps a clicked match row where it was on screen. Opening a game closes the
   * one that was open, and when that one is above, the page would otherwise
   * jump by its whole scoreboard's height.
   */
  private keepInPlace(row: HTMLElement | undefined): void {
    if (!row) return;
    const before = row.getBoundingClientRect().top;
    afterNextRender(
      () => {
        const moved = row.getBoundingClientRect().top - before;
        const scroller = row.closest('main');
        if (moved && scroller) scroller.scrollTop += moved;
      },
      { injector: this.injector },
    );
  }

  /** A champion's build on the Champions tab: ARAM's while you're looking at your ARAM games, else ranked. */
  openBuild(championId: number): void {
    void this.rift.showChampion(championId, { mode: this.mode() === 450 ? 'aram' : 'ranked' });
  }

  pick(mode: number | 'all'): void {
    this.mode.set(mode);
    this.openId.set(null);
  }
  /** A game mode for the queue, for queues without a label. */
  modeName(p: MyProfile, queueId: number): string {
    return p.matches.find((m) => m.queueId === queueId)?.gameMode ?? '';
  }
  ranks(p: MyProfile): { label: string; line: RankLine | null; history: LpPoint[] }[] {
    return [
      { label: 'Solo/Duo', line: p.solo, history: p.lpHistory?.solo ?? [] },
      { label: 'Flex', line: p.flex, history: p.lpHistory?.flex ?? [] },
    ];
  }
  /** Ranked queues with at least two saved ranks, which get an LP graph. */
  ranked(p: MyProfile) {
    return this.ranks(p).filter((r) => r.line && r.history.length > 1);
  }
  pct = winPct;
  ratio = kdaRatio;
  queue(id: number, mode = ''): string {
    return queueLabel(id, mode);
  }
  resultLabel(m: MatchLine): string {
    return RESULT_LABEL[m.result];
  }
  mins(s: number): string {
    return `${Math.round(s / 60)} min`;
  }
  private dayLabel(d: Date): string {
    const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
    const daysAgo = Math.round((startOf(new Date()) - startOf(d)) / 86_400_000);
    if (daysAgo === 0) return 'Today';
    if (daysAgo === 1) return 'Yesterday';
    const sameYear = d.getFullYear() === new Date().getFullYear();
    return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: sameYear ? undefined : 'numeric' });
  }
  ago(ms: number): string {
    const h = (Date.now() - ms) / 3_600_000;
    if (h < 1) return 'just now';
    if (h < 24) return `${Math.floor(h)}h ago`;
    const d = Math.floor(h / 24);
    return d < 30 ? `${d}d ago` : new Date(ms).toLocaleDateString();
  }
}
