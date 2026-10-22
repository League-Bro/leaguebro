import { Component, computed, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { RiftService } from '../core/rift.service';
import { assetUrl, championIcon, formatTier, profileIcon, queueLabel, tierClass } from '../core/assets';
import { MatchLine, MyProfile, PostGame, RankLine } from '../core/models';
import { PostGameView } from './post-game';

const RESULT_LABEL = { win: 'Victory', loss: 'Defeat', remake: 'Remake' } as const;

/** Your rank, insights from recent games, and match history. */
@Component({
  selector: 'rl-profile',
  imports: [DecimalPipe, PostGameView],
  template: `
    @if (loading() && !profile()) {
      <section class="card empty"><p class="muted">Loading your profile from the League client…</p></section>
    } @else if (loadError(); as e) {
      <section class="card empty">
        <h2>Couldn't load your profile</h2>
        <p class="muted">{{ e }}</p>
        <button (click)="load()">Try again</button>
      </section>
    } @else if (profile(); as p) {
      <section class="card head">
        @if (icon(p.iconId); as url) { <img class="avatar" [src]="url" alt="" /> } @else { <div class="avatar"></div> }
        <div class="who">
          <h2>{{ p.name }}</h2>
          <div class="muted small">Level {{ p.level }}</div>
        </div>
        <div class="ranks">
          @for (r of ranks(p); track r.label) {
            <div class="rank">
              <div class="faint cap">{{ r.label }}</div>
              @if (r.line; as l) {
                <div [class]="tierCls(l.tier)">{{ tier(l.tier, l.division) }} <span class="muted mono">{{ l.lp }} LP</span></div>
                <div class="faint small mono">{{ l.wins }}W {{ l.losses }}L · {{ pct(l.wins, l.wins + l.losses) }}%</div>
              } @else {
                <div class="tier-none">Unranked</div>
              }
            </div>
          }
        </div>
        <button class="ghost" [disabled]="loading()" (click)="load()">{{ loading() ? 'Refreshing…' : 'Refresh' }}</button>
      </section>
      @if (p.error) { <p class="loss small note">Some data didn't load: {{ p.error }}</p> }

      @if (p.insights.games > 0) {
        @let ins = p.insights;
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
          <div class="tile"><div class="big mono">{{ ins.visionPerGame | number: '1.0-0' }}</div><div class="faint small">vision per game</div></div>
          <div class="tile">
            <div class="big mono" [class.win]="ins.streak > 1" [class.loss]="ins.streak < -1">{{ abs(ins.streak) }}{{ ins.streak >= 0 ? 'W' : 'L' }}</div>
            <div class="faint small">current streak</div>
          </div>
        </div>

        <div class="grid">
          <section class="card stack">
            <h3>Champions</h3>
            @for (c of ins.champions.slice(0, 6); track c.championId) {
              <div class="crow">
                <img class="champ-icon sm" [src]="champIcon(c.championId)" alt="" />
                <span class="grow">{{ rift.champName(c.championId) }}</span>
                <span class="mono faint">{{ c.games }} {{ c.games === 1 ? 'game' : 'games' }}</span>
                <span class="mono wr" [class.win]="pct(c.wins, c.games) >= 55" [class.loss]="pct(c.wins, c.games) < 45">{{ pct(c.wins, c.games) }}%</span>
                <span class="mono muted kda">{{ ratio(c.kills, c.deaths, c.assists) }} KDA</span>
              </div>
            }
          </section>
          <section class="card stack">
            <h3>Queues</h3>
            @for (q of ins.queues; track q.queueId) {
              <div class="qrow">
                <span class="grow">{{ queue(q.queueId) }}</span>
                <span class="mono faint">{{ q.wins }}W {{ q.games - q.wins }}L</span>
                <span class="bar"><span [style.width.%]="pct(q.wins, q.games)"></span></span>
                <span class="mono wr">{{ pct(q.wins, q.games) }}%</span>
              </div>
            }
          </section>
        </div>
      }

      <div class="row history-head">
        <h3>Match history</h3>
        <span class="faint small">
          Your last {{ p.matches.length }} games in the League client. Custom and practice games aren't included, and neither are Brawl or League Classic.
        </span>
      </div>
      @if (p.matches.length === 0) {
        <p class="faint">No games yet.</p>
      }
      <div class="matches">
        @for (m of p.matches; track m.gameId) {
          <button class="match" [class]="m.result" [class.open]="openId() === m.gameId" (click)="toggle(m)">
            <img class="champ-icon" [src]="champIcon(m.championId)" [title]="rift.champName(m.championId)" alt="" />
            <div class="what">
              <div class="res">{{ resultLabel(m) }}</div>
              <div class="faint small">{{ queue(m.queueId, m.gameMode) }} · {{ ago(m.created) }} · {{ mins(m.duration) }}</div>
            </div>
            <div class="kda-col">
              <div class="mono">{{ m.kills }} / {{ m.deaths }} / {{ m.assists }}</div>
              <div class="faint small mono">{{ ratio(m.kills, m.deaths, m.assists) }} KDA</div>
            </div>
            <div class="stat-col">
              <div class="mono">{{ m.cs }} <span class="faint">CS</span></div>
              <div class="faint small mono">{{ m.cs / (m.duration / 60 || 1) | number: '1.1-1' }}/min</div>
            </div>
            <div class="stat-col">
              <div class="mono">{{ m.damage | number }}</div>
              <div class="faint small">damage</div>
            </div>
            <div class="items">
              @for (id of m.items; track $index) {
                <span class="slot">@if (itemIcon(id); as url) { <img [src]="url" alt="" (error)="hide($event)" /> }</span>
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
                <p class="muted small">Loading the full scoreboard…</p>
              }
            </div>
          }
        }
      </div>
    }
  `,
  styles: `
    .empty { max-width: 560px; margin: 40px auto; text-align: center; }
    .head { display: flex; align-items: center; gap: 16px; flex-wrap: wrap; }
    .avatar { width: 64px; height: 64px; border-radius: 50%; border: 2px solid var(--accent); background: var(--bg-sunken); box-shadow: 0 0 22px var(--accent-glow); }
    .who { flex: 1; min-width: 160px; }
    .who h2 { font-size: 24px; }
    .ranks { display: flex; gap: 26px; }
    .rank { display: flex; flex-direction: column; gap: 2px; }
    .cap { font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.08em; }
    .small { font-size: 12.5px; margin: 0; }
    .note { margin-top: 8px; }
    .tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(118px, 1fr)); gap: 10px; margin-top: 16px; }
    .tile { background: var(--glass), var(--bg-raised); border: 1px solid var(--line); border-radius: var(--radius); padding: 12px 14px; }
    .big { font: 800 22px var(--display); }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-top: 16px; align-items: start; }
    .card.stack { gap: 6px; }
    h3 { margin: 0; }
    .crow, .qrow { display: flex; align-items: center; gap: 10px; font-size: 13px; }
    .grow { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .wr { width: 40px; text-align: right; }
    .kda { width: 70px; text-align: right; }
    .bar { width: 90px; height: 6px; border-radius: 999px; background: var(--bg-sunken); overflow: hidden; }
    .bar span { display: block; height: 100%; background: var(--accent); opacity: 0.8; }
    .history-head { align-items: baseline; gap: 12px; margin: 24px 0 10px; flex-wrap: wrap; }
    .matches { display: flex; flex-direction: column; gap: 6px; }
    .match {
      display: grid; grid-template-columns: 44px minmax(150px, 1.3fr) 96px 80px 80px auto; align-items: center; gap: 14px;
      text-align: left; padding: 8px 14px; background: var(--glass), var(--bg-raised); border: 1px solid var(--line);
      border-left: 3px solid var(--text-faint); border-radius: 12px; color: var(--text);
    }
    .match:hover { border-color: var(--line-strong); }
    .match.win { border-left-color: var(--win); }
    .match.loss { border-left-color: var(--loss); }
    .match.open { border-color: var(--accent); }
    .match.win .res { color: var(--win); }
    .match.loss .res { color: var(--loss); }
    .match.remake .res { color: var(--text-dim); }
    .res { font-weight: 600; }
    .items { display: flex; gap: 3px; }
    .slot { width: 24px; height: 24px; border-radius: 6px; overflow: hidden; border: 1px solid var(--line-strong); background: var(--bg-sunken); flex: none; }
    .slot img { display: block; width: 100%; height: 100%; }
    .slot:last-child { border-radius: 50%; margin-left: 3px; }
    .detail { padding: 4px 0 12px; }
    @media (max-width: 1000px) { .grid { grid-template-columns: 1fr; } .match { grid-template-columns: 44px 1fr 96px 80px; } .match .items, .match .stat-col:last-of-type { display: none; } }
  `,
})
export class ProfileView {
  protected readonly rift = inject(RiftService);
  protected readonly profile = signal<MyProfile | null>(null);
  protected readonly loading = signal(false);
  protected readonly loadError = signal<string | null>(null);
  protected readonly openId = signal<number | null>(null);
  protected readonly detail = signal<PostGame | null>(null);
  protected readonly detailError = signal<string | null>(null);

  protected readonly winRate = computed(() => {
    const i = this.profile()?.insights;
    return i ? this.pct(i.wins, i.games) : 0;
  });

  protected champIcon = championIcon;
  protected icon = profileIcon;
  protected tier = formatTier;
  protected tierCls = tierClass;
  protected abs = Math.abs;

  constructor() {
    this.load();
  }

  async load(): Promise<void> {
    this.loading.set(true);
    try {
      this.profile.set(await this.rift.getMyProfile());
      this.loadError.set(null);
    } catch (e) {
      if (!this.profile()) this.loadError.set(String(e));
    } finally {
      this.loading.set(false);
    }
  }

  async toggle(m: MatchLine): Promise<void> {
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

  ranks(p: MyProfile): { label: string; line: RankLine | null }[] {
    return [
      { label: 'Solo/Duo', line: p.solo },
      { label: 'Flex', line: p.flex },
    ];
  }
  pct(wins: number, games: number): number {
    return games > 0 ? Math.round((wins / games) * 100) : 0;
  }
  ratio(k: number, d: number, a: number): string {
    return d === 0 ? (k + a > 0 ? 'Perfect' : '0.0') : ((k + a) / d).toFixed(1);
  }
  queue(id: number, mode = ''): string {
    return queueLabel(id, mode);
  }
  resultLabel(m: MatchLine): string {
    return RESULT_LABEL[m.result];
  }
  mins(s: number): string {
    return `${Math.round(s / 60)} min`;
  }
  ago(ms: number): string {
    const h = (Date.now() - ms) / 3_600_000;
    if (h < 1) return 'just now';
    if (h < 24) return `${Math.floor(h)}h ago`;
    const d = Math.floor(h / 24);
    return d < 30 ? `${d}d ago` : new Date(ms).toLocaleDateString();
  }
  itemIcon(id: number): string {
    return id > 0 ? assetUrl(this.rift.itemById().get(id)?.iconPath) : '';
  }
  hide(e: Event): void {
    (e.target as HTMLElement).style.display = 'none';
  }
}
