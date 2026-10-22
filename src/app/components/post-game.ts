import { Component, computed, inject, input, output } from '@angular/core';
import { RiftService } from '../core/rift.service';
import { championIcon, clock, kdaRatio } from '../core/assets';
import { PostGame, PostPlayer, PostTeam } from '../core/models';

const RESULT_LABEL = { win: 'Victory', loss: 'Defeat', remake: 'Remake' } as const;

@Component({
  selector: 'rl-post-game',
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
              <span class="slot" [title]="rift.itemName(id)">
                @if (rift.itemIcon(id); as url) { <img [src]="url" alt="" (error)="rift.hideImg($event)" /> }
              </span>
            }
          </div>
        </div>
        <button class="ghost" (click)="closed.emit()">Close</button>
      </section>
    }

    @for (t of g.teams; track t.teamId) {
      <div class="team-head" [class.ally]="t.isMine" [class.enemy]="!t.isMine">
        <h3>{{ t.isMine ? 'Your team' : 'Enemy team' }}</h3>
        @if (g.result !== 'remake') { <span [class]="t.win ? 'win' : 'loss'">{{ t.win ? 'Victory' : 'Defeat' }}</span> }
        <span class="faint mono">{{ t.kills }} kills · {{ k(t.gold) }} gold</span>
        <span class="faint mono">{{ objectives(t) }}</span>
      </div>
      <div class="board">
        <div class="row-p head" aria-hidden="true">
          <span>Player</span>
          <span>Level</span>
          <span>KDA</span>
          <span>CS</span>
          <span>Damage</span>
          <span>Gold</span>
          <span>Vision</span>
          <span>Build</span>
        </div>
        @for (p of t.players; track $index) {
          <div class="row-p" [class.me]="p.isMe" [class.enemy]="!t.isMine">
            <div class="who">
              <img class="champ-icon sm" [src]="icon(p.championId)" [title]="rift.champName(p.championId)" alt="" />
              <span class="name">
                @if (p.name) { {{ p.name }} } @else { <span class="faint">{{ rift.champName(p.championId) }}</span> }
              </span>
            </div>
            <span class="mono muted">{{ p.level }}</span>
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
                <span class="slot" [title]="rift.itemName(id)">
                  @if (rift.itemIcon(id); as url) { <img [src]="url" alt="" (error)="rift.hideImg($event)" /> }
                </span>
              }
            </div>
          </div>
        }
      </div>
    }

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
      <div class="charts">
        @for (c of charts; track c.key) {
          <div class="chart">
            <div class="chart-title">{{ c.title }}</div>
            @for (t of g.teams; track t.teamId) {
              <div class="group" [class.ally]="t.isMine" [class.enemy]="!t.isMine">
                @for (p of t.players; track $index) {
                  <div class="bar-row" [class.me]="p.isMe" [title]="tip(c.key, p, t)">
                    <img class="bar-icon" [src]="icon(p.championId)" alt="" />
                    <span class="bar-name">
                      {{ p.name ?? rift.champName(p.championId) }}
                      @if (p.isMe) { <span class="you">You</span> }
                    </span>
                    <span class="gtrack">
                      <span class="gbar" [style.width]="barWidth(c.key, p)"></span>
                      <span class="gval mono">{{ k(p[c.key]) }}</span>
                    </span>
                  </div>
                }
              </div>
            }
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
    .chart-title { font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--text-faint); }
    .group { display: flex; flex-direction: column; gap: 3px; }
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
    .gtrack { display: flex; align-items: center; gap: 6px; min-width: 0; border-left: 1px solid var(--line-strong); }
    .gbar { display: block; height: 10px; border-radius: 0 4px 4px 0; flex: none; min-width: 2px; }
    .group.ally .gbar { background: var(--team-ally); }
    .group.enemy .gbar { background: var(--team-enemy); }
    .gval { font-size: 11.5px; color: var(--text-dim); flex: none; }
    .bar-row.me .gval { color: var(--text); }

    .hero { position: relative; display: flex; align-items: center; gap: 20px; padding: 24px; border-left: 3px solid var(--text-faint); }
    .hero > :not(.splash) { position: relative; }
    .hero.win { border-left-color: var(--win); }
    .hero.loss { border-left-color: var(--loss); }
    .hero.win .big { border-color: var(--win); box-shadow: 0 0 22px rgba(60, 207, 142, 0.35); }
    .hero.loss .big { border-color: var(--loss); box-shadow: 0 0 22px rgba(255, 90, 78, 0.35); }
    .big { width: 80px; height: 80px; border-radius: 18px; border: 2px solid var(--accent); }
    .grow { flex: 1; gap: 10px; min-width: 0; }
    .title { display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap; }
    .title h2 { font-size: 28px; }
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
    .team-head { display: flex; align-items: baseline; gap: 14px; margin: 22px 0 8px; font-size: 13px; }
    .team-head h3 { margin: 0; }
    .team-head.ally h3 { color: var(--ally); }
    .team-head.enemy h3 { color: var(--enemy); }
    .board { display: flex; flex-direction: column; gap: 4px; }
    .row-p {
      display: grid; align-items: center; gap: 12px;
      grid-template-columns: minmax(150px, 1.6fr) 36px 72px 40px minmax(90px, 1fr) 46px 44px 182px;
      padding: 7px 14px; border-radius: 12px; background: var(--glass), var(--bg-raised); border: 1px solid var(--line);
      border-left: 3px solid var(--ally); font-size: 13px;
    }
    .row-p.head {
      background: none; border-color: transparent; padding-top: 0; padding-bottom: 0;
      font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--text-faint);
    }
    .row-p.enemy { border-left-color: var(--enemy); }
    .row-p.me { background: linear-gradient(90deg, var(--accent-soft), transparent 60%), var(--bg-raised); border-left-color: var(--accent); }
    .who { display: flex; align-items: center; gap: 8px; min-width: 0; }
    .name { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .dmg { display: flex; align-items: center; gap: 8px; }
    .dmg .mono { width: 40px; }
    .bar { flex: 1; height: 6px; border-radius: 999px; background: var(--bg-sunken); overflow: hidden; }
    .bar span { display: block; height: 100%; background: var(--accent); opacity: 0.75; }
    .row-p.enemy .bar span { background: var(--enemy); }
  `,
})
export class PostGameView {
  protected readonly rift = inject(RiftService);
  readonly game = input.required<PostGame>();
  readonly closed = output<void>();

  protected readonly myTeam = computed(() => this.game().teams.find((t) => t.isMine) ?? null);
  protected readonly me = computed(() => this.myTeam()?.players.find((p) => p.isMe) ?? null);
  protected readonly label = computed(() => RESULT_LABEL[this.game().result]);
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
  /** Largest value per chart; every bar in a chart shares one scale. */
  private readonly chartMax = computed(() => {
    const players = this.game().teams.flatMap((t) => t.players);
    return {
      gold: Math.max(1, ...players.map((p) => p.gold)),
      damage: Math.max(1, ...players.map((p) => p.damage)),
    };
  });

  protected icon = championIcon;
  protected time = clock;

  /** Bar length; 44px is kept free past the tip for the value label. */
  barWidth(key: 'gold' | 'damage', p: PostPlayer): string {
    const f = p[key] / this.chartMax()[key];
    return `calc((100% - 44px) * ${f.toFixed(4)})`;
  }
  tip(key: 'gold' | 'damage', p: PostPlayer, t: PostTeam): string {
    const total = t.players.reduce((a, x) => a + x[key], 0);
    const share = total > 0 ? Math.round((p[key] / total) * 100) : 0;
    const who = p.name ?? this.rift.champName(p.championId);
    const unit = this.charts.find((c) => c.key === key)!.unit;
    return `${who} (${this.rift.champName(p.championId)}): ${p[key].toLocaleString()} ${unit}, ${share}% of ${t.isMine ? 'your' : 'their'} team`;
  }

  kda = (p: PostPlayer) => kdaRatio(p.kills, p.deaths, p.assists);
  perMin(n: number): string {
    return (n / Math.max(1, this.game().duration / 60)).toFixed(1);
  }
  k(n: number): string {
    return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
  }
  objectives(t: PostTeam): string {
    const n = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;
    return [n(t.towers, 'tower'), n(t.dragons, 'dragon'), n(t.barons, 'baron')].join(' · ');
  }
  mode(m: string): string {
    return m ? m.charAt(0) + m.slice(1).toLowerCase() : 'Game';
  }
}
