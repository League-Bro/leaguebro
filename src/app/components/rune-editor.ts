import { ChangeDetectionStrategy, Component, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { ItemTip } from './item-tip';
import { RiftService } from '../core/rift.service';
import { assetUrl } from '../core/assets';
import { CustomRunes, PerkInfo, RuneRec } from '../core/models';

/** A page being edited: trees, keystone, the three primary runes, secondary picks (row, rune; oldest first) and shards. */
interface Draft {
  primary: number;
  sub: number;
  keystone: number;
  main: number[];
  side: { row: number; id: number }[];
  shards: number[];
}

/**
 * The whole rune page to edit, like the client's: primary tree, keystone, a rune per row,
 * a secondary tree with two runes from different rows, and three stat shards. Every
 * complete change is sent out (`change`), so it's set in the lobby right away.
 */
@Component({
  selector: 'rl-rune-editor',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (trees().length && draft(); as d) {
      <div class="editor">
        <div class="side">
          <div class="styles" role="radiogroup" aria-label="Primary tree">
            @for (t of trees(); track t.id) {
              <button class="style" role="radio" [attr.aria-checked]="t.id === d.primary" [class.on]="t.id === d.primary"
                [disabled]="disabled()" [attr.aria-label]="t.name" [rlItemTip]="t.id" tipKind="tree" (click)="setPrimary(t.id)">
                <img [src]="icon(t)" alt="" (error)="rift.hideImg($event)" />
              </button>
            }
          </div>
          @for (row of rows(d.primary, 'keystone'); track $index) {
            <div class="row keys" role="radiogroup" aria-label="Keystone">
              @for (id of row; track id) {
                <ng-container *ngTemplateOutlet="perk; context: { $implicit: id, on: id === d.keystone, big: true, pick: 'keystone' }" />
              }
            </div>
          }
          @for (row of rows(d.primary, 'regular'); track $index; let r = $index) {
            <div class="row" role="radiogroup" [attr.aria-label]="treeName(d.primary) + ' row ' + (r + 1)">
              @for (id of row; track id) {
                <ng-container *ngTemplateOutlet="perk; context: { $implicit: id, on: d.main[r] === id, row: r, pick: 'main' }" />
              }
            </div>
          }
        </div>
        <div class="side">
          <div class="styles" role="radiogroup" aria-label="Secondary tree">
            @for (t of subTrees(d.primary); track t.id) {
              <button class="style" role="radio" [attr.aria-checked]="t.id === d.sub" [class.on]="t.id === d.sub"
                [disabled]="disabled()" [attr.aria-label]="t.name" [rlItemTip]="t.id" tipKind="tree" (click)="setSub(t.id)">
                <img [src]="icon(t)" alt="" (error)="rift.hideImg($event)" />
              </button>
            }
          </div>
          @for (row of rows(d.sub, 'regular'); track $index; let r = $index) {
            <div class="row" role="group" [attr.aria-label]="treeName(d.sub) + ' row ' + (r + 1)">
              @for (id of row; track id) {
                <ng-container *ngTemplateOutlet="perk; context: { $implicit: id, on: sideHas(d, id), row: r, pick: 'side' }" />
              }
            </div>
          }
          <div class="shards">
            @for (row of rows(d.primary, 'shard'); track $index; let r = $index) {
              <div class="row" role="radiogroup" [attr.aria-label]="'Shard ' + (r + 1)">
                @for (id of row; track id) {
                  <ng-container *ngTemplateOutlet="perk; context: { $implicit: id, on: d.shards[r] === id, row: r, pick: 'shard', small: true }" />
                }
              </div>
            }
          </div>
        </div>
      </div>
      <p class="faint hint">Two secondary runes, from different rows. A third replaces the older one.</p>
    } @else {
      <p class="faint hint">Rune trees load from the League client. Open it to edit runes here.</p>
    }

    <ng-template #perk let-id let-on="on" let-big="big" let-small="small" let-row="row" let-pick="pick">
      <button class="perk" [class.on]="on" [class.big]="big" [class.small]="small" [disabled]="disabled()"
        [attr.aria-pressed]="on" [attr.aria-label]="perkName(id)" [rlItemTip]="id" tipKind="rune" (click)="choose(pick, id, row)">
        @if (perkIcon(id); as url) { <img [src]="url" alt="" (error)="rift.hideImg($event)" /> }
        @else { <span class="fallback">{{ perkName(id).slice(0, 2) }}</span> }
      </button>
    </ng-template>
  `,
  imports: [NgTemplateOutlet, ItemTip],
  styles: `
    :host { display: block; margin-top: 4px; }
    .editor { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 18px; }
    @container (max-width: 520px) { .editor { grid-template-columns: minmax(0, 1fr); } }
    .side { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
    .styles { display: flex; gap: 6px; padding-bottom: 8px; border-bottom: 1px solid var(--line); }
    .style { padding: 3px; width: 32px; height: 32px; border-radius: 50%; display: grid; place-items: center; background: transparent; }
    .style img { width: 22px; height: 22px; opacity: 0.45; filter: grayscale(1); }
    .style.on { border-color: var(--accent); background: var(--bg-hover); }
    .style.on img, .style:hover:not(:disabled) img { opacity: 1; filter: none; }
    .row { display: flex; gap: 8px; justify-content: space-around; }
    .shards { display: flex; flex-direction: column; gap: 4px; margin-top: 2px; padding-top: 8px; border-top: 1px solid var(--line); }
    .perk { padding: 0; width: 32px; height: 32px; border-radius: 50%; display: grid; place-items: center; background: var(--bg-sunken); overflow: hidden; }
    .perk.big { width: 40px; height: 40px; }
    .perk.small { width: 26px; height: 26px; }
    .perk img { width: 100%; height: 100%; opacity: 0.4; filter: grayscale(1); }
    .perk.on { border-color: var(--accent); box-shadow: 0 0 10px var(--accent-glow); }
    .perk.on img, .perk:hover:not(:disabled) img { opacity: 1; filter: none; }
    .fallback { font-size: 10px; color: var(--text-dim); }
    .hint { font-size: 12px; margin: 6px 0 0; }
  `,
})
export class RuneEditor {
  protected readonly rift = inject(RiftService);
  /** The page shown now (OP.GG's pick or an edited one); the editor starts from it. */
  readonly page = input.required<RuneRec>();
  readonly disabled = input(false);
  readonly change = output<CustomRunes>();

  protected readonly draft = signal<Draft | null>(null);

  /** Rune trees with their rows (from the client's perkstyles.json). */
  protected readonly trees = computed(() => (this.rift.statics()?.styles ?? []).filter((s) => s.slots?.length));
  private readonly treeById = computed(() => new Map(this.trees().map((t) => [t.id, t])));

  constructor() {
    // Start over from the page shown whenever it changes from outside (another pick, champion or role).
    effect(() => {
      const p = this.page();
      this.trees();
      untracked(() => {
        const d = this.draft();
        if (!d || !samePage(toCustom(d), p)) this.draft.set(this.fromPage(p));
      });
    });
  }

  protected rows(styleId: number, kind: 'keystone' | 'regular' | 'shard'): number[][] {
    return (this.treeById().get(styleId)?.slots ?? []).filter((s) => s.kind === kind).map((s) => s.perks);
  }

  protected subTrees(primary: number): PerkInfo[] {
    const allowed = this.treeById().get(primary)?.subStyles;
    return this.trees().filter((t) => t.id !== primary && (!allowed?.length || allowed.includes(t.id)));
  }

  protected sideHas(d: Draft, id: number): boolean {
    return d.side.some((s) => s.id === id);
  }

  protected setPrimary(id: number): void {
    const d = this.draft();
    if (!d || d.primary === id) return;
    // The old primary becomes the secondary when they'd clash, like in the client.
    const sub = d.sub === id ? d.primary : d.sub;
    this.commit({ ...d, primary: id, sub, keystone: this.rows(id, 'keystone')[0]?.[0] ?? 0, main: this.rows(id, 'regular').map((r) => r[0]),
      side: sub === d.sub ? d.side : this.firstSide(sub) });
  }

  protected setSub(id: number): void {
    const d = this.draft();
    if (!d || d.sub === id) return;
    this.commit({ ...d, sub: id, side: this.firstSide(id) });
  }

  protected choose(kind: 'keystone' | 'main' | 'side' | 'shard', id: number, row: number): void {
    const d = this.draft();
    if (!d) return;
    if (kind === 'keystone') this.commit({ ...d, keystone: id });
    else if (kind === 'main') this.commit({ ...d, main: d.main.map((x, i) => (i === row ? id : x)) });
    else if (kind === 'shard') this.commit({ ...d, shards: d.shards.map((x, i) => (i === row ? id : x)) });
    else if (!this.sideHas(d, id)) {
      // One per row; a new row pushes out the older pick.
      const others = d.side.filter((s) => s.row !== row);
      this.commit({ ...d, side: [...others.slice(-1), { row, id }] });
    }
  }

  private commit(d: Draft): void {
    this.draft.set(d);
    const c = toCustom(d);
    if (c.perkIds.length === 9 && c.perkIds.every((id) => id > 0)) this.change.emit(c);
  }

  private firstSide(sub: number): Draft['side'] {
    return this.rows(sub, 'regular').slice(0, 2).map((r, row) => ({ row, id: r[0] }));
  }

  private fromPage(p: RuneRec): Draft {
    const [keystone = 0, a = 0, b = 0, c = 0, s1 = 0, s2 = 0, ...shards] = p.perkIds;
    const subRows = this.rows(p.subStyleId, 'regular');
    const rowOf = (id: number) => Math.max(0, subRows.findIndex((r) => r.includes(id)));
    return {
      primary: p.primaryStyleId,
      sub: p.subStyleId,
      keystone,
      main: [a, b, c],
      side: [s1, s2].filter(Boolean).map((id) => ({ row: rowOf(id), id })),
      shards: [0, 1, 2].map((i) => shards[i] ?? 0),
    };
  }

  protected icon(t: PerkInfo): string {
    return assetUrl(t.iconPath);
  }
  protected perkIcon(id: number): string {
    return assetUrl(this.rift.perkById().get(id)?.iconPath);
  }
  protected perkName(id: number): string {
    return this.rift.perkById().get(id)?.name ?? '';
  }
  protected treeName(id: number): string {
    return this.treeById().get(id)?.name ?? '';
  }
}

/** The draft as a page, secondary runes in row order (the client's order). */
function toCustom(d: Draft): CustomRunes {
  const side = [...d.side].sort((x, y) => x.row - y.row).map((s) => s.id);
  return { primaryStyleId: d.primary, subStyleId: d.sub, perkIds: [d.keystone, ...d.main, ...side, ...d.shards] };
}

function samePage(c: CustomRunes, p: RuneRec): boolean {
  return c.primaryStyleId === p.primaryStyleId && c.subStyleId === p.subStyleId && c.perkIds.join() === p.perkIds.join();
}
