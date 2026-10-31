import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RiftService } from '../core/rift.service';
import { championIcon } from '../core/assets';
import { championSplit, damageTip, DamageSplit, teamSplit } from '../core/damage';
import { EnemyTrait, answers, enemyTraits } from '../core/comp';
import { PlayerCard } from './player-card';

const TRAIT_TITLES: Record<EnemyTrait, (n: number) => string> = {
  tanks: (n) => `${n} tanks.`,
  dive: (n) => `${n} divers.`,
  poke: (n) => `${n} poke champions.`,
  squishy: () => 'No tank.',
};
/** What a trait means for your own team. */
const FOR_US: Record<EnemyTrait, string> = {
  tanks: 'You can take long fights and front line for your carries.',
  dive: 'Built to jump their backline: go in together.',
  poke: 'Wear them down before objectives instead of forcing fights.',
  squishy: 'Avoid long fights; pick your moments.',
};
/** How to play into an enemy trait when nobody on your team answers it. */
const VS_THEM: Record<EnemyTrait, string> = {
  tanks: 'Armor or magic pen and % health damage pay off.',
  dive: 'Stay near whoever can peel you; a defensive item helps.',
  poke: 'Engage or flank fast instead of sitting in their range.',
  squishy: 'Catching one of them out of position wins fights.',
};
/** What answers it, for "Nobody on your team …" lines. */
const ANSWER: Record<EnemyTrait, string> = {
  tanks: 'shreds tanks',
  dive: 'stops dive',
  poke: 'engages on poke',
  squishy: 'bursts squishies',
};

interface Note {
  key: string;
  title: string;
  text: string;
  /** Your champions that answer an enemy trait (enemy side only). */
  by?: { id: number; tag: string }[];
}

/**
 * Champ select's one team card: both teams side by side, each with its damage
 * profile (AD / AP / true), what the comp is built around (`comp.ts`) and which of
 * your champions answer the enemy's, then the players lined up row by row, and the bans.
 */
@Component({
  selector: 'rl-champ-teams',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [PlayerCard],
  template: `
    @if (rift.champSelect(); as cs) {
      <section class="card teams-card">
        <div class="top">
          <h3>Your team vs their team</h3>
          <span class="legend">
            <span><i class="sw ad"></i>AD</span>
            <span><i class="sw ap"></i>AP</span>
            <span><i class="sw tr"></i>True</span>
          </span>
          <div class="spacer"></div>
          @if (cs.bans.length) {
            <span class="bans">
              <span class="faint cap">Bans</span>
              @for (b of cs.bans; track $index) {
                <img class="ban" [src]="icon(b)" [title]="rift.champName(b)" alt="" />
              }
            </span>
          }
        </div>

        <!-- Ally cells sit in column 1 and enemy cells in column 2; dense flow lines up each pair in a row. -->
        <div class="grid">
          @for (t of sides(); track t.key) {
            <div class="side" [class.enemy]="t.key === 'enemy'">
              <div class="side-head">
                <span class="who">{{ t.label }}</span>
                @if (t.split && t.split.counted < 5) { <span class="faint small">{{ t.split.counted }}/5 picked</span> }
              </div>
              <div class="track">
                @if (t.split; as s) {
                  @for (seg of segments(s); track seg.key) {
                    <span [class]="'part ' + seg.key" [class.first]="$first" [class.last]="$last" [style.width.%]="seg.value" [title]="t.label + ': ' + seg.value + '% ' + seg.name">
                      @if (seg.value >= 14) { <b class="mono">{{ seg.value }}%</b> }
                    </span>
                  }
                } @else {
                  <span class="none faint">No picks yet</span>
                }
              </div>
              <div class="notes">
                @for (n of t.notes; track n.key) {
                  <div class="note">
                    <b class="trait">{{ n.title }}</b>
                    @if (n.by?.length) {
                      @for (b of n.by; track b.id) {
                        <span class="answer" [title]="rift.champName(b.id) + ': ' + b.tag"><img [src]="icon(b.id)" alt="" />{{ rift.champName(b.id) }}</span>
                      }
                      <span class="muted">{{ n.by!.length === 1 ? 'answers' : 'answer' }} it.</span>
                    } @else {
                      <span class="muted">{{ n.text }}</span>
                    }
                  </div>
                } @empty {
                  <div class="note faint">{{ t.key === 'enemy' ? 'Nothing stands out in their comp yet. This updates as they pick.' : 'Nothing stands out in your comp yet.' }}</div>
                }
              </div>
            </div>
          }
          @for (p of cs.allies; track p.cellId; let i = $index) {
            <rl-player class="row-a" [flat]="true"
              [name]="p.name" [puuid]="p.isMe ? null : p.puuid" [championId]="p.championId || p.pickIntent"
              [position]="p.position" [isMe]="p.isMe"
              [hiddenLabel]="'Ally ' + (i + 1)" [hiddenNote]="'Hidden in ranked champ select'" />
          }
          @for (e of cs.enemies; track e.cellId; let i = $index) {
            <rl-player class="row-e" [flat]="true"
              [name]="e.name" [puuid]="e.puuid" [championId]="e.championId" [position]="e.position" side="enemy"
              [hiddenLabel]="'Enemy ' + (i + 1)" [hiddenNote]="'Names show on the loading screen'" />
          }
        </div>
      </section>
    }
  `,
  styles: `
    .teams-card { padding: 14px 22px 16px; margin-top: 8px; container-type: inline-size; }
    .top { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; margin-bottom: 10px; }
    .top h3 { margin: 0; }
    .legend { display: flex; gap: 12px; font-size: 12px; color: var(--text-dim); }
    .legend span { display: flex; align-items: center; gap: 5px; }
    .sw { width: 10px; height: 10px; border-radius: 3px; display: inline-block; background: var(--c); }
    .ad { --c: #f26b3a; }
    .ap { --c: #8f7dff; }
    .tr { --c: #d8d2e6; }
    .bans { display: flex; align-items: center; gap: 6px; }
    .cap { font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.1em; margin-right: 2px; }
    .ban { width: 26px; height: 26px; border-radius: 7px; filter: grayscale(1) brightness(0.6); }

    .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); grid-auto-flow: row dense; column-gap: 22px; row-gap: 4px; }
    .grid > * { grid-column: 1; }
    .grid > .enemy, .grid > .row-e { grid-column: 2; }
    /* Stacks when the card itself is narrow (the side rail takes part of the window). */
    @container (max-width: 860px) {
      .grid { grid-template-columns: minmax(0, 1fr); }
      .grid > .enemy, .grid > .row-e { grid-column: 1; }
      .grid > .side.enemy { margin-top: 18px; order: 2; }
      .grid > .row-e { order: 3; }
    }

    .side { display: flex; flex-direction: column; gap: 6px; padding-bottom: 6px; }
    .side-head { display: flex; align-items: baseline; gap: 8px; }
    .who { font-weight: 700; font-size: 13px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--ally); }
    .enemy .who { color: var(--enemy); }
    .small { font-size: 12px; }
    .track { display: flex; gap: 2px; height: 22px; }
    .part { display: flex; align-items: center; padding: 0 7px; min-width: 3px; background: var(--c); transition: width 0.4s ease; }
    .part.first { border-top-left-radius: 4px; border-bottom-left-radius: 4px; }
    .part.last { border-top-right-radius: 4px; border-bottom-right-radius: 4px; }
    .part b { font-size: 11.5px; color: #17131d; }
    .none { align-self: center; font-size: 12px; }
    .notes { display: flex; flex-direction: column; gap: 2px; font-size: 12.5px; }
    .note { line-height: 1.7; }
    .note > * { margin-right: 5px; }
    .trait { font-weight: 600; color: var(--text); }
    .answer { vertical-align: middle; display: inline-flex; align-items: center; gap: 5px; padding: 1px 8px 1px 2px; border-radius: 999px; background: var(--accent-2-soft); color: var(--accent-2); font-weight: 600; font-size: 12px; }
    .answer img { width: 18px; height: 18px; border-radius: 50%; }
  `,
})
export class ChampTeams {
  protected readonly rift = inject(RiftService);
  protected readonly icon = championIcon;

  private readonly champs = computed(() => new Map((this.rift.statics()?.champions ?? []).map((c) => [c.id, c])));
  /** An ally's hover counts until they lock in. */
  private readonly allyIds = computed(() => (this.rift.champSelect()?.allies ?? []).map((p) => p.championId || p.pickIntent).filter((id) => id > 0));
  private readonly enemyIds = computed(() => (this.rift.champSelect()?.enemies ?? []).map((p) => p.championId).filter((id) => id > 0));

  private split(ids: number[]): DamageSplit | null {
    const m = this.champs();
    return teamSplit(ids.flatMap((id) => {
      const c = m.get(id);
      return c ? [championSplit(c.alias, c.roles)] : [];
    }));
  }
  private traits(ids: number[]) {
    const m = this.champs();
    return enemyTraits(ids.flatMap((id) => (m.has(id) ? [m.get(id)!] : [])));
  }

  protected readonly sides = computed(() => {
    const ours = this.split(this.allyIds());
    const theirs = this.split(this.enemyIds());
    const allyNotes: Note[] = this.traits(this.allyIds()).map((t) => ({ key: t.trait, title: TRAIT_TITLES[t.trait](t.count), text: FOR_US[t.trait] }));
    const enemyNotes: Note[] = this.traits(this.enemyIds()).map((t) => {
      const by = this.allyIds().flatMap((id) => {
        const alias = this.champs().get(id)?.alias ?? '';
        const tag = alias ? answers(t.trait, alias) : '';
        return tag ? [{ id, tag }] : [];
      });
      return { key: t.trait, title: TRAIT_TITLES[t.trait](t.count), text: `Nobody on your team ${ANSWER[t.trait]}. ${VS_THEM[t.trait]}`, by };
    });
    // The damage tip leads each side's notes (heavy AD on your side, "armor goes a long way" on theirs).
    const tip = (s: DamageSplit | null, enemy: boolean): Note[] => {
      const text = s ? damageTip(s, enemy) : '';
      if (!text) return [];
      const [title, ...rest] = text.split('. ');
      return [{ key: 'dmg', title: `${title}.`, text: rest.join('. ') }];
    };
    return [
      { key: 'ally', label: 'Your team', split: ours, notes: [...tip(ours, false), ...allyNotes] },
      { key: 'enemy', label: 'Enemy team', split: theirs, notes: [...tip(theirs, true), ...enemyNotes] },
    ];
  });

  protected segments(s: DamageSplit) {
    return [
      { key: 'ad', name: 'physical', value: s.ad },
      { key: 'ap', name: 'magic', value: s.ap },
      { key: 'tr', name: 'true', value: s.true },
    ].filter((x) => x.value > 0);
  }
}
