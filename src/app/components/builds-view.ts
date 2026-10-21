import { Component, computed, inject, signal } from '@angular/core';
import { RiftService } from '../core/rift.service';
import { ChampPicker } from './champ-picker';
import { assetUrl, championIcon } from '../core/assets';
import { ItemInfo } from '../core/models';

@Component({
  selector: 'rl-builds',
  imports: [ChampPicker],
  template: `
    <div class="layout">
      <aside class="card">
        <div class="stack">
          <rl-champ-picker placeholder="Add a champion…" (picked)="select($event)" />
          <div class="list">
            @for (c of champsWithBuilds(); track c) {
              <button class="champ" [class.active]="c === selected()" (click)="select(c)">
                <img class="champ-icon sm" [src]="icon(c)" alt="" />
                <span>{{ rift.champName(c) }}</span>
                <span class="faint mono">{{ buildOf(c).length }}</span>
              </button>
            } @empty {
              <p class="faint small">No builds yet. Pick a champion to start one.</p>
            }
          </div>
        </div>
      </aside>

      <section class="card stack">
        @if (selected(); as champ) {
          <div class="row">
            <img class="champ-icon" [src]="icon(champ)" alt="" />
            <div>
              <h2>{{ rift.champName(champ) }} build</h2>
              <div class="muted small">The overlay shows the next two items you don't own yet, in this order.</div>
            </div>
          </div>

          <ol class="items">
            @for (id of buildOf(champ); track $index; let i = $index; let last = $last) {
              <li>
                <span class="idx mono faint">{{ i + 1 }}</span>
                @if (item(id); as it) {
                  <img [src]="itemIcon(it)" alt="" />
                  <span class="grow">{{ it.name }}</span>
                  <span class="mono faint">{{ it.priceTotal }}g</span>
                } @else {
                  <span class="grow faint">Item {{ id }}</span>
                }
                <button class="ghost" [disabled]="i === 0" (click)="move(champ, i, -1)" title="Move up">▲</button>
                <button class="ghost" [disabled]="last" (click)="move(champ, i, 1)" title="Move down">▼</button>
                <button class="ghost" (click)="removeAt(champ, i)" title="Remove">✕</button>
              </li>
            }
          </ol>

          <div class="add">
            <input type="text" placeholder="Add an item…" [value]="query()" (input)="query.set($any($event.target).value)" />
            @if (matches().length) {
              <div class="results">
                @for (it of matches(); track it.id) {
                  <button (click)="add(champ, it.id)">
                    <img [src]="itemIcon(it)" alt="" />
                    <span class="grow">{{ it.name }}</span>
                    <span class="mono faint">{{ it.priceTotal }}g</span>
                  </button>
                }
              </div>
            }
          </div>
          @if (!rift.statics()) {
            <p class="faint small">Item names load once the League client is open.</p>
          }
        } @else {
          <p class="muted">Pick a champion on the left to set up their item order.</p>
        }
      </section>
    </div>
  `,
  styles: `
    .layout { display: grid; grid-template-columns: 260px 1fr; gap: 16px; align-items: start; }
    .list { display: flex; flex-direction: column; gap: 2px; }
    .champ { display: flex; align-items: center; gap: 10px; background: none; border-color: transparent; text-align: left; }
    .champ span:nth-child(2) { flex: 1; }
    .champ.active { background: var(--gold-soft); border-color: var(--gold); }
    .small { font-size: 12.5px; }
    .items { list-style: none; padding: 0; margin: 4px 0; display: flex; flex-direction: column; gap: 4px; }
    .items li { display: flex; align-items: center; gap: 10px; padding: 6px 8px; background: var(--bg-sunken); border-radius: 8px; }
    .items img, .results img { width: 30px; height: 30px; border-radius: 6px; border: 1px solid var(--line-strong); }
    .idx { width: 16px; text-align: right; }
    .grow { flex: 1; }
    .add input { width: 100%; }
    .results { display: flex; flex-direction: column; gap: 2px; margin-top: 6px; max-height: 300px; overflow: auto; }
    .results button { display: flex; align-items: center; gap: 10px; text-align: left; background: none; border-color: transparent; }
    .results button:hover { background: var(--bg-sunken); }
  `,
})
export class BuildsView {
  protected readonly rift = inject(RiftService);
  protected readonly selected = signal<number | null>(null);
  protected readonly query = signal('');

  protected readonly champsWithBuilds = computed(() => {
    const ids = Object.keys(this.rift.config()?.builds ?? {}).map(Number);
    const sel = this.selected();
    if (sel && !ids.includes(sel)) ids.push(sel);
    return ids.sort((a, b) => this.rift.champName(a).localeCompare(this.rift.champName(b)));
  });

  protected readonly matches = computed(() => {
    const q = this.query().trim().toLowerCase();
    if (q.length < 2) return [];
    return (this.rift.statics()?.items ?? []).filter((i) => i.name.toLowerCase().includes(q)).slice(0, 12);
  });

  protected icon = championIcon;

  constructor() {
    const cs = this.rift.champSelect()?.myChampionId;
    if (cs) this.selected.set(cs);
  }

  buildOf(champ: number): number[] {
    return this.rift.config()?.builds[String(champ)] ?? [];
  }
  item(id: number): ItemInfo | undefined {
    return this.rift.itemById().get(id);
  }
  itemIcon(it: ItemInfo): string {
    return assetUrl(it.iconPath);
  }

  select(champ: number): void {
    this.selected.set(champ);
    this.query.set('');
  }

  private edit(champ: number, fn: (b: number[]) => number[]): void {
    this.rift.updateConfig((c) => {
      const next = fn([...(c.builds[String(champ)] ?? [])]);
      if (next.length) c.builds[String(champ)] = next;
      else delete c.builds[String(champ)];
      return c;
    });
  }

  add(champ: number, id: number): void {
    this.edit(champ, (b) => [...b, id]);
    this.query.set('');
  }
  removeAt(champ: number, i: number): void {
    this.edit(champ, (b) => b.filter((_, j) => j !== i));
  }
  move(champ: number, i: number, d: number): void {
    this.edit(champ, (b) => {
      const j = i + d;
      [b[i], b[j]] = [b[j], b[i]];
      return b;
    });
  }
}
