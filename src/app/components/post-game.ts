import { Component, computed, inject, input } from '@angular/core';
import { RiftService } from '../core/rift.service';
import { assetUrl, championIcon, clock } from '../core/assets';
import { PostGame, PostPlayer, PostTeam } from '../core/models';

const RESULT_LABEL = { win: 'Victory', loss: 'Defeat', remake: 'Remake' } as const;

@Component({
  selector: 'rl-post-game',
  template: `
    @let g = game();
    @if (me(); as m) {
      <section class="hero card" [class]="g.result">
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
              <span class="slot" [title]="itemName(id)">
                @if (itemIcon(id); as url) { <img [src]="url" alt="" (error)="hide($event)" /> }
              </span>
            }
          </div>
        </div>
        <button class="ghost" (click)="rift.closedPostGame.set(g.gameId)">Close</button>
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
        @for (p of t.players; track $index) {
          <div class="row-p" [class.me]="p.isMe" [class.enemy]="!t.isMine">
            <div class="who">
              <img class="champ-icon sm" [src]="icon(p.championId)" [title]="rift.champName(p.championId)" alt="" />
              <span class="lvl mono">{{ p.level }}</span>
              <span class="name">
                @if (p.name) { {{ p.name }} } @else { <span class="faint">{{ rift.champName(p.championId) }}</span> }
              </span>
            </div>
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
                <span class="slot" [title]="itemName(id)">
                  @if (itemIcon(id); as url) { <img [src]="url" alt="" (error)="hide($event)" /> }
                </span>
              }
            </div>
          </div>
        }
      </div>
    }
  `,
  styles: `
    .hero { display: flex; align-items: center; gap: 18px; border-left: 3px solid var(--text-faint); }
    .hero.win { border-left-color: var(--win); background: linear-gradient(90deg, rgba(98, 196, 140, 0.1), var(--bg-raised) 50%); }
    .hero.loss { border-left-color: var(--loss); background: linear-gradient(90deg, rgba(224, 100, 108, 0.1), var(--bg-raised) 50%); }
    .big { width: 72px; height: 72px; border-radius: 12px; border: 2px solid var(--gold); }
    .grow { flex: 1; gap: 10px; min-width: 0; }
    .title { display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap; }
    .title h2 { font-size: 22px; }
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
      grid-template-columns: minmax(170px, 1.6fr) 72px 44px minmax(90px, 1fr) 48px 32px auto;
      padding: 6px 12px; border-radius: 8px; background: var(--bg-raised);
      border-left: 3px solid var(--ally); font-size: 13px;
    }
    .row-p.enemy { border-left-color: var(--enemy); }
    .row-p.me { background: linear-gradient(90deg, var(--gold-soft), var(--bg-raised) 60%); border-left-color: var(--gold); }
    .who { display: flex; align-items: center; gap: 8px; min-width: 0; }
    .lvl { font-size: 11px; color: var(--text-faint); width: 16px; }
    .name { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .dmg { display: flex; align-items: center; gap: 8px; }
    .dmg .mono { width: 40px; }
    .bar { flex: 1; height: 6px; border-radius: 3px; background: var(--bg-sunken); overflow: hidden; }
    .bar span { display: block; height: 100%; background: var(--gold); opacity: 0.75; }
    .row-p.enemy .bar span { background: var(--enemy); }
  `,
})
export class PostGameView {
  protected readonly rift = inject(RiftService);
  readonly game = input.required<PostGame>();

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

  protected icon = championIcon;
  protected time = clock;

  kda(p: PostPlayer): string {
    return p.deaths === 0 ? 'Perfect' : ((p.kills + p.assists) / p.deaths).toFixed(1);
  }
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
  hide(e: Event): void {
    (e.target as HTMLElement).style.display = 'none';
  }
  mode(m: string): string {
    return m ? m.charAt(0) + m.slice(1).toLowerCase() : 'Game';
  }
  itemIcon(id: number): string {
    return id > 0 ? assetUrl(this.rift.itemById().get(id)?.iconPath) : '';
  }
  itemName(id: number): string {
    return this.rift.itemById().get(id)?.name ?? '';
  }
}
