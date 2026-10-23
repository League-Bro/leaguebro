import { Component, computed, inject, input, output, signal } from '@angular/core';
import { DecimalPipe, NgTemplateOutlet } from '@angular/common';
import { RiftService } from '../core/rift.service';
import { assetUrl, championIcon } from '../core/assets';
import { ItemSet, MIN_GAMES, RecChoice, RecState, RuneRec } from '../core/models';
import { buildWhy, rolesLabel } from '../core/why';

/** One of OP.GG's options in a pick list: icons, a name, and its win and play rates. */
interface ChoiceRow {
  o: { games: number; winRate: number; pickRate: number };
  label: string;
  icons: string[];
  tip: string;
  round?: boolean;
}

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
          } @else if (s.loading) {
            <!-- Keeps the header its loaded height. -->
            <button class="ghost why-toggle" style="visibility: hidden" tabindex="-1" aria-hidden="true">Why these picks?</button>
          }
        </div>

        @if (s.loading) {
          <!-- Same layout as the loaded card, so nothing jumps when the data arrives. -->
          <div class="layout skeleton" role="status" [attr.aria-label]="'Looking up ' + rift.champName(s.championId) + ' on OP.GG'">
            <section class="panel">
              <header><h4>Runes</h4></header>
              <div class="rune-main">
                <span class="bone keystone round"></span>
                <div class="lines">
                  <span class="bone text" style="width: 110px"></span>
                  <span class="bone text sm" style="width: 150px"></span>
                </div>
              </div>
              <div class="trees">
                @for (t of [3, 2]; track $index) {
                  <div class="tree">
                    <span class="bone text sm" style="width: 70px"></span>
                    @for (w of nameWidths.slice(0, t); track $index) {
                      <div class="rune"><span class="bone perk round"></span><span class="bone text sm" [style.width.ch]="w"></span></div>
                    }
                  </div>
                }
              </div>
            </section>
            <div class="stack">
              <section class="panel">
                <header><h4>Summoner spells</h4></header>
                <div class="spells">
                  <span class="bone icon"></span><span class="bone text" style="width: 44px"></span>
                  <span class="bone icon"></span><span class="bone text" style="width: 44px"></span>
                </div>
              </section>
              <section class="panel">
                <header><h4>Skill order</h4></header>
                <div class="max">
                  @for (i of [1, 2, 3]; track i) { <span class="bone key-bone"></span> }
                </div>
                <div class="levels">
                  @for (i of levels; track $index) { <span class="bone lvl-bone"></span> }
                </div>
              </section>
            </div>
            <section class="panel wide">
              <header><h4>Items</h4></header>
              <div class="item-path">
                <div class="group">
                  <div class="sub">Start with</div>
                  <div class="icons"><span class="bone icon"></span><span class="bone icon"></span></div>
                </div>
                <div class="group">
                  <div class="sub">Build order</div>
                  <div class="icons">
                    @for (i of [1, 2, 3, 4, 5, 6]; track i; let last = $last) {
                      <span class="bone icon"></span>
                      @if (!last) { <span class="faint arrow">›</span> }
                    }
                  </div>
                </div>
              </div>
            </section>
          </div>
        } @else if (s.error) {
          <p class="loss small">Couldn't get OP.GG data: {{ s.error }}. Runes fall back to the League client's suggestion.</p>
        } @else if (s.rec; as r) {
          @if (r.games < minGames) {
            <p class="warn small">Only {{ r.games }} games on OP.GG for this pick, so runes and spells use the League client's suggestion instead. The data below is shown for reference.</p>
          }
          @if (vsRec(); as vs) {
            <div class="source" role="radiogroup" aria-label="Which games the build comes from">
              <button class="src" role="radio" [attr.aria-checked]="!s.choice.matchup" [class.on]="!s.choice.matchup"
                [disabled]="pickBusy()" (click)="pickSource(false)" title="OP.GG's picks from all of this champion's games in the role">
                All games
              </button>
              <button class="src" role="radio" [attr.aria-checked]="!!s.choice.matchup" [class.on]="!!s.choice.matchup"
                [disabled]="pickBusy()" (click)="pickSource(true)"
                [title]="'OP.GG\\'s picks from ' + vs.games.toLocaleString() + ' games against ' + rift.champName(vs.opponentId) + ' in lane'">
                <img class="round" [src]="champIcon(vs.opponentId)" alt="" (error)="rift.hideImg($event)" />
                vs {{ rift.champName(vs.opponentId) }}
                <span class="faint mono">{{ vs.games | number }} games</span>
              </button>
            </div>
          }
          <div class="layout">
            @if (r.runes; as ru) {
              <section class="panel">
                <header><h4>Runes</h4></header>
                <div class="rune-main">
                  @if (perkIcon(ru.perkIds[0]); as url) { <img class="keystone" [src]="url" [title]="perkName(ru.perkIds[0])" alt="" (error)="rift.hideImg($event)" /> }
                  <div>
                    <div class="keystone-name">{{ perkLabel(ru.perkIds[0], ru.keystoneName) }}</div>
                    <div class="muted small">{{ styleName(ru.primaryStyleId, ru.primaryName) }} + {{ styleName(ru.subStyleId, ru.secondaryName) }}</div>
                  </div>
                </div>
                <div class="trees">
                  <div class="tree">
                    <div class="sub">{{ styleName(ru.primaryStyleId, ru.primaryName) }}</div>
                    @for (id of ru.perkIds.slice(1, 4); track $index) {
                      <ng-container *ngTemplateOutlet="runeRow; context: { $implicit: id, ru, i: $index + 1 }" />
                    }
                  </div>
                  <div class="tree">
                    <div class="sub">{{ styleName(ru.subStyleId, ru.secondaryName) }}</div>
                    @for (id of ru.perkIds.slice(4, 6); track $index) {
                      <ng-container *ngTemplateOutlet="runeRow; context: { $implicit: id, ru, i: $index + 4 }" />
                    }
                    @if (ru.perkIds.length > 6) {
                      <div class="sub">Shards</div>
                      <div class="shards">
                        @for (id of ru.perkIds.slice(6); track $index) {
                          @if (perkIcon(id); as url) { <img [src]="url" [title]="perkName(id)" alt="" (error)="rift.hideImg($event)" /> }
                        }
                      </div>
                    }
                  </div>
                </div>
                @if (runePages(); as rows) {
                  <div class="divider"></div>
                  <ng-container *ngTemplateOutlet="choices; context: { $implicit: rows, kind: 'runes', head: 'Popular pages', sel: s.choice.runes }" />
                }
              </section>
            }

            <div class="stack">
              @if (r.spells.length === 2) {
                <section class="panel">
                  <header><h4>Summoner spells</h4></header>
                  @if (spellRows(); as rows) {
                    <ng-container *ngTemplateOutlet="choices; context: { $implicit: rows, kind: 'spells', head: 'Popular picks', sel: s.choice.spells }" />
                  } @else {
                    <div class="spells">
                      @for (id of r.spells; track $index) {
                        @if (spellIcon(id); as url) { <img [src]="url" alt="" (error)="rift.hideImg($event)" /> }
                        <span>{{ spellName(id) }}</span>
                      }
                    </div>
                  }
                </section>
              }
              @if (r.skillMax.length) {
                <section class="panel">
                  <header><h4>Skill order</h4><span class="hint">Max in this order</span></header>
                  <div class="max">
                    @for (k of r.skillMax; track $index; let last = $last) {
                      <span class="key">{{ rift.abilityKey(k) }}</span>@if (!last) { <span class="faint">›</span> }
                    }
                  </div>
                  @if (r.skillOrder.length) {
                    <div class="levels">
                      @for (k of r.skillOrder; track $index) {
                        <span class="lvl-col" [title]="'Level ' + ($index + 1)">
                          <span class="lvl-n">{{ $index + 1 }}</span>
                          <span [class]="'lvl k' + k">{{ rift.abilityKey(k) }}</span>
                        </span>
                      }
                    </div>
                  }
                </section>
              }
            </div>

            @if (r.starter || r.buildOrder.length) {
              <section class="panel wide">
                <header>
                  <h4>Items</h4>
                  @if (rift.config()?.useRecommendedBuilds && r.buildOrder.length) { <span class="hint">The overlay will remind you of this build in game</span> }
                </header>
                <div class="item-path">
                  @if (r.starter; as st) {
                    <div class="group">
                      <div class="sub">Start with</div>
                      <div class="icons">
                        @for (id of st.ids; track $index) {
                          @if (rift.itemIcon(id); as url) { <img [src]="url" [title]="itemName(id, st, $index)" alt="" (error)="rift.hideImg($event)" /> } @else { <span class="chip">{{ itemName(id, st, $index) }}</span> }
                        }
                      </div>
                    </div>
                  }
                  @if (r.buildOrder.length) {
                    <div class="group">
                      <div class="sub">Build order</div>
                      <div class="icons">
                        @for (id of r.buildOrder; track id; let last = $last) {
                          @if (rift.itemIcon(id); as url) { <img [src]="url" [title]="itemNameAny(id, r)" alt="" (error)="rift.hideImg($event)" /> } @else { <span class="chip">{{ itemNameAny(id, r) }}</span> }
                          @if (!last) { <span class="faint arrow">›</span> }
                        }
                      </div>
                    </div>
                  }
                </div>
                @if (bootsRows() || coreRows()) {
                  <div class="item-choices">
                    @if (coreRows(); as rows) {
                      <ng-container *ngTemplateOutlet="choices; context: { $implicit: rows, kind: 'core', head: 'Core items', sel: s.choice.core }" />
                    }
                    @if (bootsRows(); as rows) {
                      <ng-container *ngTemplateOutlet="choices; context: { $implicit: rows, kind: 'boots', head: 'Boots', sel: s.choice.boots }" />
                    }
                  </div>
                }
              </section>
            }
          </div>
          @if (pickBusy()) {
            <p class="muted small">Applying your pick…</p>
          } @else if (pickMsg(); as m) {
            <p class="small" [class.loss]="m.bad" [class.picked]="!m.bad">{{ m.text }}</p>
          }

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

    <ng-template #runeRow let-id let-ru="ru" let-i="i">
      <div class="rune" [title]="perkName(id)">
        @if (perkIcon(id); as url) { <img [src]="url" alt="" (error)="rift.hideImg($event)" /> }
        <span>{{ perkLabel(id, ru.perkNames[i] ?? '') }}</span>
      </div>
    </ng-template>

    <!-- OP.GG's options for one pick (rune page, spells, core items, boots), with win and play rates. -->
    <ng-template #choices let-rows let-kind="kind" let-head="head" let-sel="sel">
      <div class="choices" role="radiogroup" [attr.aria-label]="head">
        <div class="choices-head" aria-hidden="true"><span>{{ head }}</span><span>Win</span><span>Played</span></div>
        @for (p of rows; track $index) {
          <button class="choice" role="radio" [attr.aria-checked]="sel === $index" [class.on]="sel === $index"
            [disabled]="pickBusy()" [title]="p.tip" (click)="pick(kind, $index)">
            <span class="choice-what">
              @for (u of p.icons; track $index) { <img [class.round]="p.round" [src]="u" alt="" (error)="rift.hideImg($event)" /> }
              <span class="choice-name">{{ p.label }}</span>
            </span>
            <span class="num">{{ pct(p.o.winRate) }}</span>
            <span class="num faint">{{ pct(p.o.pickRate) }}</span>
          </button>
        }
      </div>
    </ng-template>

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
    .rec { margin: 14px 0 4px; display: flex; flex-direction: column; gap: 14px; }
    .head { display: flex; align-items: baseline; gap: 10px; }
    .small { font-size: 12.5px; margin: 0; }
    .warn { color: var(--gold); }
    .rec { container-type: inline-size; }
    .label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--text-faint); margin-top: 2px; }
    .picked { color: var(--win); }
    .strong { font-weight: 600; }
    .mono { font-family: var(--mono); font-variant-numeric: tabular-nums; }

    /* Layout: runes | spells + skills, then items across the card. Titled panels with room between them. */
    .layout { display: grid; grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr); gap: 14px; align-items: start; }
    .stack { display: flex; flex-direction: column; gap: 14px; min-width: 0; }
    .panel {
      display: flex; flex-direction: column; gap: 14px; min-width: 0;
      padding: 14px 16px 16px; border-radius: var(--radius-sm); background: var(--bg-hover); border: 1px solid var(--line);
    }
    .panel.wide { grid-column: 1 / -1; }
    .panel header { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; }
    .panel h4 { margin: 0; font-size: 14px; font-weight: 600; color: var(--text); }
    .hint { font-size: 12px; color: var(--text-faint); }
    .sub { font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--text-faint); }
    @container (max-width: 720px) { .layout { grid-template-columns: minmax(0, 1fr); } }

    /* Which games the build comes from (all games / vs your lane opponent). */
    .source { display: flex; gap: 6px; flex-wrap: wrap; }
    .src {
      display: inline-flex; align-items: center; gap: 6px; padding: 5px 12px; border-radius: 999px;
      background: var(--bg-sunken); border: 1px solid var(--line); color: var(--text-dim); font-size: 12.5px; cursor: pointer;
    }
    .src img { width: 18px; height: 18px; }
    .src:hover:not(:disabled) { border-color: var(--line-strong); color: var(--text); }
    .src.on { border-color: var(--accent); background: var(--accent-soft); color: var(--text); }
    .src:disabled { cursor: progress; }

    /* Runes: keystone, then each tree's runes by name, then the shards. */
    .rune-main { display: flex; align-items: center; gap: 12px; }
    .keystone { width: 48px; height: 48px; flex: none; }
    .keystone-name { font-size: 16px; font-weight: 600; }
    .trees { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
    .tree { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
    .tree .sub + .rune { margin-top: -2px; }
    .rune { display: flex; align-items: center; gap: 8px; font-size: 13px; min-width: 0; }
    .rune img { width: 26px; height: 26px; flex: none; }
    .rune span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .shards { display: flex; gap: 6px; }
    .shards img { width: 20px; height: 20px; opacity: 0.9; }

    /* Options from OP.GG (rune page, spells, core items, boots): one row each, the picked one outlined. */
    .choices { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
    .choices-head, .choice { display: grid; grid-template-columns: minmax(0, 1fr) 40px 52px; align-items: center; gap: 8px; }
    .choices-head { padding: 0 10px 4px; font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--text-faint); }
    .divider { border-top: 1px solid var(--line); margin: 0 -2px; }
    .choices-head span:not(:first-child), .choice .num { text-align: right; }
    .choice {
      padding: 6px 10px; border-radius: 8px; border: 1px solid transparent; background: none;
      color: var(--text-dim); font-size: 13px; text-align: left; cursor: pointer;
    }
    .choice:hover:not(:disabled) { background: var(--bg-hover); color: var(--text); }
    .choice.on { border-color: var(--accent); background: var(--accent-soft); color: var(--text); }
    .choice:disabled { cursor: progress; }
    .choice-what { display: flex; align-items: center; gap: 6px; min-width: 0; }
    .choice-what img { width: 22px; height: 22px; flex: none; border-radius: 5px; }
    .choice-what img.round { border-radius: 50%; }
    .choice-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-left: 2px; }
    .num { font-family: var(--mono); font-size: 12px; font-variant-numeric: tabular-nums; }

    /* Spells without options, skills, items. */
    .spells { display: flex; align-items: center; gap: 8px; font-size: 13px; }
    .spells span { margin-right: 10px; }
    .spells img, .icons img { width: 32px; height: 32px; border-radius: 6px; border: 1px solid var(--line-strong); }
    .max { display: flex; align-items: center; gap: 8px; }
    .key {
      display: inline-flex; align-items: center; justify-content: center;
      width: 30px; height: 30px; border-radius: 9px; box-shadow: inset 0 0 0 1px var(--accent-soft);
      background: var(--accent-soft); color: var(--accent); font-weight: 700;
    }
    .levels { display: grid; grid-template-columns: repeat(18, minmax(0, 1fr)); gap: 2px; max-width: 420px; }
    .lvl-col { display: flex; flex-direction: column; align-items: center; gap: 3px; }
    .lvl-n { font: 10px var(--mono); color: var(--text-faint); }
    .lvl {
      width: 100%; height: 20px; border-radius: 4px; font-size: 11px; font-weight: 700;
      display: inline-flex; align-items: center; justify-content: center;
      background: var(--bg-sunken); color: var(--text-dim);
    }
    .lvl.kQ { color: #7cc4f5; } .lvl.kW { color: #8de28d; } .lvl.kE { color: #f0b46a; } .lvl.kR { color: var(--accent); background: var(--accent-soft); }
    .item-path { display: flex; gap: 28px; flex-wrap: wrap; }
    .group { display: flex; flex-direction: column; gap: 8px; }
    .icons { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
    .arrow { margin: 0 1px; }
    .chip { font-size: 12px; background: var(--bg-sunken); border-radius: 999px; padding: 3px 8px; }
    .item-choices { display: grid; grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr); gap: 24px; padding-top: 14px; border-top: 1px solid var(--line); }
    @container (max-width: 720px) { .item-choices { grid-template-columns: minmax(0, 1fr); } }
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
    .lines { display: flex; flex-direction: column; gap: 6px; }
    .bone {
      display: inline-block; flex: none; border-radius: 6px;
      background: linear-gradient(90deg, var(--bg-sunken) 30%, var(--line-strong) 50%, var(--bg-sunken) 70%);
      background-size: 300% 100%;
      /* The shimmer starts late, so a quick lookup swaps straight to the data without a flash. */
      animation: shimmer 1.4s ease-in-out 0.4s infinite;
    }
    .bone.round { border-radius: 50%; }
    .bone.text { height: 12px; border-radius: 999px; }
    .bone.text.sm { height: 10px; }
    .bone.keystone { width: 48px; height: 48px; }
    .bone.perk { width: 26px; height: 26px; }
    .bone.shard { width: 18px; height: 18px; }
    .bone.icon { width: 32px; height: 32px; }
    .bone.key-bone { width: 30px; height: 30px; border-radius: 9px; }
    .bone.lvl-bone { height: 20px; border-radius: 4px; }
    @keyframes shimmer { from { background-position: 100% 0; } to { background-position: 0 0; } }
    @media (prefers-reduced-motion: reduce) { .bone { animation: none; } }
  `,
})
export class RecCard {
  protected readonly rift = inject(RiftService);
  protected readonly minGames = MIN_GAMES;
  protected readonly champIcon = championIcon;
  protected readonly showWhy = signal(false);
  /** Skill-order placeholder: one box per level. */
  protected readonly levels = Array.from({ length: 18 });
  /** Rune-name placeholders, roughly as wide as real names ("Taste of Blood", "Grisly Mementos"…). */
  protected readonly nameWidths = [13, 14, 14, 13, 12];

  protected readonly why = computed(() => {
    const r = this.state()?.rec;
    if (!r) return null;
    const champ = this.rift.statics()?.champions.find((c) => c.id === r.championId);
    return buildWhy(r, champ, this.rift.itemById(), this.rift.perkById(), this.rift.styleById(), this.rift.spellById(), (k) =>
      this.rift.abilityKey(k),
    );
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
  /** With `lookup`: the player picked another option; the parent applies it. */
  readonly choiceChange = output<RecChoice>();
  protected readonly pickBusy = signal(false);
  protected readonly pickMsg = signal<{ text: string; bad: boolean } | null>(null);

  /** Picks another option. In champ select it's imported right away. */
  async pick(kind: keyof RecChoice, index: number): Promise<void> {
    const s = this.state();
    if (!s?.rec || this.pickBusy() || s.choice[kind] === index) return;
    await this.apply({ ...s.choice, [kind]: index });
  }

  /** OP.GG's build against your lane opponent, when it has enough games (champ select only). */
  protected readonly vsRec = computed(() => {
    const m = this.lookup() === undefined ? this.state()?.matchup : null;
    const r = m?.matchup?.rec;
    return m && r && r.games >= MIN_GAMES ? { opponentId: m.opponentId, games: r.games, winRate: m.matchup!.winRate } : null;
  });

  /** Switches between the build from all games and the one against your lane opponent. */
  async pickSource(vs: boolean): Promise<void> {
    const s = this.state();
    if (!s?.rec || this.pickBusy() || !!s.choice.matchup === vs) return;
    await this.apply({ runes: 0, spells: 0, core: 0, boots: 0, matchup: vs });
  }

  private async apply(choice: RecChoice): Promise<void> {
    if (this.lookup() !== undefined) {
      this.choiceChange.emit(choice);
      return;
    }
    this.pickBusy.set(true);
    this.pickMsg.set(null);
    try {
      this.pickMsg.set({ text: await this.rift.chooseRecOption(choice), bad: false });
    } catch (e) {
      this.pickMsg.set({ text: String(e), bad: true });
    } finally {
      this.pickBusy.set(false);
    }
  }

  /**
   * OP.GG's rune pages, each named by what sets it apart from the most played one
   * (they often share the keystone and trees, so "Inspiration" three times says nothing).
   */
  protected readonly runePages = computed(() => {
    const opts = this.state()?.rec?.runeOptions ?? [];
    if (opts.length < 2) return null;
    const base = opts[0];
    return opts.map((o, i) => {
      let id = o.perkIds[0];
      let label = 'Most played';
      if (i > 0) {
        const minor = (r: RuneRec) => r.perkIds.slice(1, 6);
        const swapped = minor(o).filter((p) => !minor(base).includes(p));
        if (o.perkIds[0] !== base.perkIds[0]) {
          label = this.perkLabel(id, o.keystoneName);
        } else if (o.subStyleId !== base.subStyleId) {
          label = `${this.styleName(o.subStyleId, o.secondaryName)} secondary`;
          id = o.subStyleId;
        } else if (swapped.length) {
          label = swapped.map((p) => this.perkLabel(p, o.perkNames[o.perkIds.indexOf(p)] ?? '')).filter(Boolean).join(' + ') || 'Other runes';
          id = swapped[0];
        } else {
          label = 'Other shards';
        }
      }
      const icon = id === o.subStyleId ? assetUrl(this.rift.styleById().get(id)?.iconPath) : this.perkIcon(id);
      return { o, label, icons: icon ? [icon] : [], round: true, tip: this.optTip(o, this.runeOptionNames(o)) } satisfies ChoiceRow;
    });
  });

  protected readonly spellRows = computed(() => {
    const opts = this.state()?.rec?.spellOptions ?? [];
    if (opts.length < 2) return null;
    return opts.map((o) => {
      const label = o.ids.map((id) => this.spellName(id)).join(' + ');
      return { o, label, icons: o.ids.map((id) => this.spellIcon(id)).filter(Boolean), tip: this.optTip(o, label) } satisfies ChoiceRow;
    });
  });

  protected readonly coreRows = computed(() => this.itemRows(this.state()?.rec?.coreOptions ?? []));
  protected readonly bootsRows = computed(() => this.itemRows(this.state()?.rec?.bootsOptions ?? []));

  private itemRows(opts: ItemSet[]): ChoiceRow[] | null {
    if (opts.length < 2) return null;
    return opts.map((o) => {
      const names = o.ids.map((id, i) => this.itemName(id, o, i));
      return {
        o, label: names.join(' · '), icons: o.ids.map((id) => this.rift.itemIcon(id)).filter(Boolean), tip: this.optTip(o, names.join(' + ')),
      };
    });
  }

  pct(winRate: number): string {
    return `${Math.round(winRate * 100)}%`;
  }
  /** Hover text for an option chip: what it is, then how it does on OP.GG. */
  optTip(o: { games: number; winRate: number; pickRate: number }, what: string): string {
    return `${what}\n${(o.winRate * 100).toFixed(1)}% win · ${o.games.toLocaleString()} games · picked in ${(o.pickRate * 100).toFixed(0)}%`;
  }
  runeOptionNames(o: RuneRec): string {
    return o.perkIds.slice(0, 6).map((id, i) => this.perkLabel(id, o.perkNames[i] ?? '')).filter(Boolean).join(' · ');
  }

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
  /** Names from the client's data, falling back to OP.GG's (the website API sends none). */
  perkLabel(id: number, fallback: string): string {
    return this.rift.perkById().get(id)?.name ?? fallback;
  }
  styleName(id: number, fallback: string): string {
    return this.rift.styleById().get(id)?.name ?? fallback;
  }
  spellIcon(id: number): string {
    return assetUrl(this.rift.spellById().get(id)?.iconPath);
  }
  spellName(id: number): string {
    return this.rift.spellById().get(id)?.name ?? `Spell ${id}`;
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
