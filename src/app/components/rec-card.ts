import { Component, computed, inject, input, signal } from '@angular/core';
import { DecimalPipe, NgTemplateOutlet } from '@angular/common';
import { RiftService } from '../core/rift.service';
import { assetUrl } from '../core/assets';
import { ItemSet, RecState } from '../core/models';
import { buildWhy, rolesLabel } from '../core/why';

const MIN_GAMES = 20;

/** OP.GG's recommendation for your current champion: runes, spells, skills, items. */
@Component({
  selector: 'rl-rec-card',
  imports: [DecimalPipe, NgTemplateOutlet],
  template: `
    @if (rift.config()?.recSource === 'opgg' && state(); as s) {
      <section class="card rec">
        <div class="head">
          <h3>Recommended for {{ rift.champName(s.championId) }}</h3>
          <div class="spacer"></div>
          @if (s.rec; as r) {
            <span class="faint small">
              OP.GG · {{ r.games | number }} games
              @if (r.runes; as ru) { · {{ ru.winRate * 100 | number: '1.0-1' }}% win }
            </span>
            <button class="ghost why-toggle" [class.on]="showWhy()" (click)="showWhy.set(!showWhy())">
              {{ showWhy() ? 'Hide why' : 'Why these picks?' }}
            </button>
          }
        </div>

        @if (s.loading) {
          <p class="muted small">Looking up {{ rift.champName(s.championId) }} on OP.GG…</p>
        } @else if (s.error) {
          <p class="loss small">Couldn't get OP.GG data: {{ s.error }}. Runes fall back to the League client's suggestion.</p>
        } @else if (s.rec; as r) {
          @if (r.games < minGames) {
            <p class="warn small">Only {{ r.games }} games on OP.GG for this pick, so runes and spells use the League client's suggestion instead. The data below is shown for reference.</p>
          }
          <div class="grid">
            @if (r.runes; as ru) {
              <div class="block runes">
                <div class="label">Runes</div>
                <div class="row">
                  @if (perkIcon(ru.perkIds[0]); as url) { <img class="keystone" [src]="url" alt="" /> }
                  <div>
                    <div class="strong">{{ ru.keystoneName }}</div>
                    <div class="muted small">{{ ru.primaryName }} / {{ ru.secondaryName }}</div>
                  </div>
                </div>
                <div class="perks">
                  @for (id of ru.perkIds.slice(1); track $index) {
                    @if (perkIcon(id); as url) {
                      <img [src]="url" [title]="perkName(id)" alt="" [class.shard]="$index >= 5" />
                    }
                  }
                </div>
                <div class="faint small names">{{ ru.perkNames.slice(1).join(' · ') }}</div>
              </div>
            }

            <div class="block">
              @if (r.spells.length === 2) {
                <div class="label">Summoner spells</div>
                <div class="row spells">
                  @for (id of r.spells; track $index) {
                    @if (spellIcon(id); as url) { <img [src]="url" alt="" /> }
                    <span>{{ spellName(id) }}</span>
                  }
                </div>
              }
              @if (r.skillMax.length) {
                <div class="label">Skill order</div>
                <div class="row max">
                  @for (k of r.skillMax; track $index; let last = $last) {
                    <span class="key">{{ k }}</span>@if (!last) { <span class="faint">›</span> }
                  }
                </div>
                @if (r.skillOrder.length) {
                  <div class="levels">
                    @for (k of r.skillOrder; track $index) {
                      <span [class]="'lvl k' + k" [title]="'Level ' + ($index + 1)">{{ k }}</span>
                    }
                  </div>
                }
              }
            </div>

            <div class="block items">
              @if (r.starter; as st) {
                <div class="label">Start</div>
                <div class="row">
                  @for (id of st.ids; track $index) {
                    @if (itemIcon(id); as url) { <img [src]="url" [title]="itemName(id, st, $index)" alt="" /> } @else { <span class="chip">{{ itemName(id, st, $index) }}</span> }
                  }
                </div>
              }
              @if (r.buildOrder.length) {
                <div class="label">Build</div>
                <div class="row build">
                  @for (id of r.buildOrder; track id; let last = $last) {
                    @if (itemIcon(id); as url) { <img [src]="url" [title]="itemNameAny(id, r)" alt="" /> } @else { <span class="chip">{{ itemNameAny(id, r) }}</span> }
                    @if (!last) { <span class="faint arrow">›</span> }
                  }
                </div>
                @if (rift.config()?.useRecommendedBuilds) {
                  <div class="faint small">The overlay will remind you of this build in game.</div>
                }
              }
            </div>
          </div>

          @if (showWhy() && why(); as w) {
            <div class="why">
              <div class="why-intro muted small">{{ intro() }}</div>
              <div class="why-grid">
                <div class="why-col">
                  <div class="label">Runes</div>
                  @for (x of w.runes; track x.id) {
                    <ng-container *ngTemplateOutlet="whyRow; context: { $implicit: x, rune: true }" />
                  }
                  @for (n of w.runeNotes; track $index) { <p class="faint small note">{{ n }}</p> }

                  @if (w.spells.length || w.skills.length) {
                    <div class="label">Spells &amp; skills</div>
                    @for (x of w.spells; track x.id) {
                      <ng-container *ngTemplateOutlet="whyRow; context: { $implicit: x }" />
                    }
                    @for (n of w.skills; track $index) { <p class="muted small note">{{ n }}</p> }
                  }
                </div>
                <div class="why-col">
                  <div class="label">Items</div>
                  @for (x of w.items; track $index) {
                    <ng-container *ngTemplateOutlet="whyRow; context: { $implicit: x }" />
                  }
                </div>
              </div>
            </div>
          }
        }
      </section>
    }

    <ng-template #whyRow let-x let-rune="rune">
      <div class="why-row">
        @if (iconFor(x.iconPath); as url) { <img [src]="url" alt="" [class.round]="rune" /> } @else { <span class="icon-gap"></span> }
        <div class="why-body">
          <div class="why-title">
            <span class="strong">{{ x.name }}</span>
            @if (x.tag) { <span class="tag">{{ x.tag }}</span> }
          </div>
          @if (x.stats.length) { <div class="faint small">{{ x.stats.join(' · ') }}</div> }
          @if (x.what) { <div class="muted small what">{{ x.what }}</div> }
          @if (x.reasons.length) {
            <ul class="reasons">
              @for (reason of x.reasons; track $index) { <li>{{ reason }}</li> }
            </ul>
          }
          @if (x.data) { <div class="data small">{{ x.data }}</div> }
        </div>
      </div>
    </ng-template>
  `,
  styles: `
    .rec { margin: 14px 0 4px; display: flex; flex-direction: column; gap: 10px; }
    .head { display: flex; align-items: baseline; gap: 10px; }
    .small { font-size: 12.5px; margin: 0; }
    .warn { color: var(--gold); }
    .grid { display: grid; grid-template-columns: 1.1fr 1fr 1.3fr; gap: 18px; }
    .block { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
    .label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--text-faint); margin-top: 2px; }
    .strong { font-weight: 600; }
    .keystone { width: 44px; height: 44px; }
    .perks { display: flex; gap: 4px; align-items: center; flex-wrap: wrap; }
    .perks img { width: 26px; height: 26px; }
    .perks img.shard { width: 18px; height: 18px; opacity: 0.85; }
    .names { line-height: 1.35; }
    .spells img, .items img { width: 30px; height: 30px; border-radius: 6px; border: 1px solid var(--line-strong); }
    .spells span { margin-right: 8px; }
    .key {
      display: inline-flex; align-items: center; justify-content: center;
      width: 28px; height: 28px; border-radius: 9px; box-shadow: inset 0 0 0 1px var(--accent-soft);
      background: var(--accent-soft); color: var(--accent); font-weight: 700;
    }
    .levels { display: flex; gap: 1px; flex-wrap: nowrap; }
    .lvl {
      width: 16px; height: 18px; border-radius: 4px; font-size: 10.5px; font-weight: 700;
      display: inline-flex; align-items: center; justify-content: center;
      background: var(--bg-sunken); color: var(--text-dim);
    }
    .lvl.kQ { color: #7cc4f5; } .lvl.kW { color: #8de28d; } .lvl.kE { color: #f0b46a; } .lvl.kR { color: var(--accent); background: var(--accent-soft); }
    .build { flex-wrap: wrap; gap: 4px; }
    .arrow { margin: 0 1px; }
    .chip { font-size: 11.5px; background: var(--bg-sunken); border-radius: 999px; padding: 2px 6px; }
    @media (max-width: 960px) { .grid { grid-template-columns: 1fr 1fr; } .items { grid-column: 1 / -1; } }
    .why-toggle { margin-left: 4px; font-size: 12.5px; color: var(--accent); }
    .why-toggle.on { border-color: var(--line-strong); }
    .why { border-top: 1px solid var(--line); padding-top: 12px; display: flex; flex-direction: column; gap: 10px; }
    .why-intro { line-height: 1.5; }
    .why-grid { display: grid; grid-template-columns: 1fr 1.2fr; gap: 22px; }
    .why-col { display: flex; flex-direction: column; gap: 10px; min-width: 0; }
    .why-row { display: flex; gap: 10px; align-items: flex-start; }
    .why-row img { width: 30px; height: 30px; border-radius: 6px; border: 1px solid var(--line-strong); flex: none; margin-top: 2px; }
    .why-row img.round { border-radius: 50%; border: none; background: var(--bg-sunken); }
    .icon-gap { width: 30px; flex: none; }
    .why-body { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
    .why-title { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
    .tag {
      font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.06em;
      color: var(--text-dim); background: var(--bg-sunken); border-radius: 999px; padding: 1px 8px;
    }
    .what { line-height: 1.4; }
    .reasons { margin: 2px 0 0; padding-left: 16px; font-size: 12.5px; line-height: 1.45; }
    .reasons li::marker { color: var(--accent); }
    .data { color: var(--accent); opacity: 0.9; }
    .note { line-height: 1.45; }
    @media (max-width: 960px) { .why-grid { grid-template-columns: 1fr; } }
  `,
})
export class RecCard {
  protected readonly rift = inject(RiftService);
  protected readonly minGames = MIN_GAMES;
  protected readonly showWhy = signal(false);

  protected readonly why = computed(() => {
    const r = this.state()?.rec;
    if (!r) return null;
    const champ = this.rift.statics()?.champions.find((c) => c.id === r.championId);
    return buildWhy(r, champ, this.rift.itemById(), this.rift.perkById(), this.rift.styleById(), this.rift.spellById());
  });

  /** "Ahri is a mage / assassin who deals magic damage. Each pick below…" */
  protected readonly intro = computed(() => {
    const s = this.state();
    if (!s?.rec) return '';
    const name = this.rift.champName(s.championId);
    const roles = rolesLabel(this.rift.statics()?.champions.find((c) => c.id === s.championId)).toLowerCase();
    const damage = { AD: 'physical', AP: 'magic', BOTH: 'mixed physical and magic' }[s.rec.damageType];
    let who = name;
    if (roles) who += ` is a ${roles}`;
    if (damage) who += `${roles ? ' who deals' : ' deals'} ${damage} damage`;
    const lead = who === name ? '' : `${who}. `;
    return `${lead}Each pick below shows what it does, why it suits ${name}, and how it does on OP.GG.`;
  });
  iconFor(path: string): string {
    return assetUrl(path);
  }

  /** A lookup to show instead of champ select's (the Champions tab). */
  readonly lookup = input<RecState | null>();

  /** Only show the recommendation for the champion currently picked. */
  protected readonly state = computed(() => {
    const own = this.lookup();
    if (own !== undefined) return own;
    const s = this.rift.rec();
    if (!s) return null;
    const cs = this.rift.champSelect();
    if (cs && cs.myChampionId && cs.myChampionId !== s.championId) return null;
    return s;
  });

  perkIcon(id: number): string {
    return assetUrl(this.rift.perkById().get(id)?.iconPath);
  }
  /** Hover text: the rune's name and what it does. */
  perkName(id: number): string {
    const p = this.rift.perkById().get(id);
    return p ? [p.name, p.desc].filter(Boolean).join('\n') : '';
  }
  spellIcon(id: number): string {
    return assetUrl(this.rift.spellById().get(id)?.iconPath);
  }
  spellName(id: number): string {
    return this.rift.spellById().get(id)?.name ?? `Spell ${id}`;
  }
  itemIcon(id: number): string {
    return assetUrl(this.rift.itemById().get(id)?.iconPath);
  }
  itemName(id: number, set: ItemSet, i: number): string {
    return this.rift.itemById().get(id)?.name ?? set.names[i] ?? `Item ${id}`;
  }
  /** Name for an item in the build order, from the client or OP.GG's own names. */
  itemNameAny(id: number, r: { starter: ItemSet | null; boots: ItemSet | null; core: ItemSet | null; later: ItemSet[][] }): string {
    const known = this.rift.itemById().get(id)?.name;
    if (known) return known;
    for (const set of [r.boots, r.core, ...r.later.flat()]) {
      const i = set?.ids.indexOf(id) ?? -1;
      if (set && i >= 0 && set.names[i]) return set.names[i];
    }
    return `Item ${id}`;
  }
}
