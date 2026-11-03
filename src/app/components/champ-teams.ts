import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RiftService } from '../core/rift.service';
import { championIcon } from '../core/assets';
import { damageTip, DamageSplit, teamSplit } from '../core/damage';
import { TRAIT_ANSWER, TRAIT_FOR_US, TRAIT_TITLES, TRAIT_VS_THEM, answers, enemyTraits } from '../core/comp';
import { DamageBar, DamageLegend } from './damage-bar';
import { PlayerCard } from './player-card';

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
  imports: [DamageBar, DamageLegend, PlayerCard],
  template: `
    @if (rift.champSelect(); as cs) {
      <section class="card teams-card">
        <div class="top">
          <h3>Your team vs their team</h3>
          <rl-damage-legend />
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
              <rl-damage-bar [split]="t.split" [label]="t.label" />
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
    .bans { display: flex; align-items: center; gap: 6px; }
    .cap { font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.1em; margin-right: 2px; }
    .ban { width: 26px; height: 26px; border-radius: 7px; filter: grayscale(1) brightness(0.6); }

    .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); grid-auto-flow: row dense; column-gap: 22px; row-gap: 4px; }
    .grid > * { grid-column: 1; }
    .grid > .enemy, .grid > .row-e { grid-column: 2; }
    /* Stacks when the card itself is narrow. */
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

  /** An ally's hover counts until they lock in. */
  private readonly allies = computed(() => this.rift.champs((this.rift.champSelect()?.allies ?? []).map((p) => p.championId || p.pickIntent)));
  private readonly enemies = computed(() => this.rift.champs((this.rift.champSelect()?.enemies ?? []).map((p) => p.championId)));

  protected readonly sides = computed(() => {
    const ours = teamSplit(this.allies());
    const theirs = teamSplit(this.enemies());
    const allyNotes: Note[] = enemyTraits(this.allies()).map((t) => ({ key: t.trait, title: TRAIT_TITLES[t.trait](t.count), text: TRAIT_FOR_US[t.trait] }));
    const enemyNotes: Note[] = enemyTraits(this.enemies()).map((t) => {
      const by = this.allies().flatMap((c) => {
        const tag = answers(t.trait, c.alias);
        return tag ? [{ id: c.id, tag }] : [];
      });
      return { key: t.trait, title: TRAIT_TITLES[t.trait](t.count), text: `Nobody on your team ${TRAIT_ANSWER[t.trait]}. ${TRAIT_VS_THEM[t.trait]}`, by };
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
}
