// Item tooltip: hovering (or focusing) anything with `[rlItemTip]="id"` shows the
// item's full card, like the in-game shop: cost, stats, passives/actives and what
// it's built from. With `tipKind` it shows a rune, rune tree or summoner spell
// instead, like the client's rune page. One <rl-item-tip /> in the shell draws it
// for the whole app.
import { ChangeDetectionStrategy, Component, Directive, ElementRef, Injectable, OnDestroy, afterRenderEffect, computed, inject, input, signal, viewChild } from '@angular/core';
import { RiftService } from '../core/rift.service';
import { assetUrl } from '../core/assets';

/** Moving between neighbouring icons within this keeps the card open and just swaps its contents. */
const HIDE_DELAY_MS = 80;

export type TipKind = 'item' | 'rune' | 'tree' | 'spell';

@Injectable({ providedIn: 'root' })
export class ItemTipState {
  readonly current = signal<{ id: number; anchor: HTMLElement; kind: TipKind } | null>(null);
  private hideTimer = 0;

  show(id: number, anchor: HTMLElement, kind: TipKind = 'item'): void {
    clearTimeout(this.hideTimer);
    const c = this.current();
    if (c?.id !== id || c.anchor !== anchor || c.kind !== kind) this.current.set({ id, anchor, kind });
  }
  hide(anchor: HTMLElement, now = false): void {
    if (this.current()?.anchor !== anchor) return;
    clearTimeout(this.hideTimer);
    if (now) this.current.set(null);
    else this.hideTimer = setTimeout(() => this.current()?.anchor === anchor && this.current.set(null), HIDE_DELAY_MS);
  }
}

// Native listeners, not `host: { '(mouseenter)': … }`: Angular's listeners mark the
// surrounding component dirty, so every hover would re-check the whole rec card or
// scoreboard. This way only the signal changes and only <rl-item-tip> renders.
@Directive({ selector: '[rlItemTip]' })
export class ItemTip implements OnDestroy {
  readonly rlItemTip = input.required<number>();
  readonly tipKind = input<TipKind>('item');
  private readonly el = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly tip = inject(ItemTipState);
  private readonly show = () => this.rlItemTip() > 0 && this.tip.show(this.rlItemTip(), this.el, this.tipKind());
  private readonly hide = () => this.tip.hide(this.el);

  constructor() {
    this.el.addEventListener('mouseenter', this.show);
    this.el.addEventListener('mouseleave', this.hide);
    this.el.addEventListener('focusin', this.show);
    this.el.addEventListener('focusout', this.hide);
  }
  ngOnDestroy(): void {
    this.el.removeEventListener('mouseenter', this.show);
    this.el.removeEventListener('mouseleave', this.hide);
    this.el.removeEventListener('focusin', this.show);
    this.el.removeEventListener('focusout', this.hide);
    this.tip.hide(this.el, true);
  }
}

@Component({
  selector: 'rl-item-tip',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (item(); as it) {
      <div class="tip" #box role="tooltip">
        <header>
          @if (rift.itemIcon(it.id); as url) { <img [src]="url" alt="" (error)="rift.hideImg($event)" /> }
          <div>
            <div class="name">{{ it.name }}</div>
            @if (it.priceTotal > 0) { <div class="cost mono">{{ it.priceTotal.toLocaleString() }} gold</div> }
          </div>
        </header>
        @if (it.stats.length) {
          <ul class="stats">
            @for (s of it.stats; track $index) { <li>{{ s }}</li> }
          </ul>
        }
        @for (e of it.effects; track $index) {
          <div class="effect">
            @if (e.name) { <div class="ename"><span class="kind" [class.active]="e.kind === 'active'">{{ e.kind === 'active' ? 'Active' : 'Passive' }}</span>{{ e.name }}</div> }
            @if (e.text) { <div class="etext">{{ e.text }}</div> }
          </div>
        }
        @if (from().length) {
          <div class="from">
            <span class="faint">Built from</span>
            @for (f of from(); track $index) {
              @if (rift.itemIcon(f.id); as url) { <img [src]="url" [alt]="f.name" [title]="f.name" (error)="rift.hideImg($event)" /> } @else { <span class="small">{{ f.name }}</span> }
            }
          </div>
        }
      </div>
    } @else if (perk(); as p) {
      <div class="tip fit" #box role="tooltip">
        <header>
          @if (p.icon) { <img class="round" [class.tree]="p.kind === 'tree'" [src]="p.icon" alt="" (error)="rift.hideImg($event)" /> }
          <div>
            <div class="name">{{ p.name }}</div>
            @if (p.sub) { <div class="sub">{{ p.sub }}</div> }
          </div>
        </header>
        @if (p.text) { <div class="ptext">{{ p.text }}</div> }
      </div>
    }
  `,
  styles: `
    :host { display: contents; }
    /* contain: its content changes never make the page lay out again. */
    .tip {
      position: fixed; left: 0; top: 0; z-index: 1000; pointer-events: none; contain: content; width: 300px; max-width: calc(100vw - 16px); max-height: calc(100vh - 16px); overflow: hidden;
      padding: 12px 14px; border-radius: var(--radius-sm); border: 1px solid var(--line-strong);
      background: var(--bg-raised); box-shadow: var(--shadow); font-size: 12.5px; line-height: 1.45; color: var(--text);
    }
    header { display: flex; gap: 10px; align-items: center; }
    header img { width: 36px; height: 36px; border-radius: 6px; flex: none; }
    .name { font-weight: 600; font-size: 14px; }
    .cost { color: var(--gold); font-size: 12px; }
    .stats { list-style: none; margin: 10px 0 0; padding: 8px 0 0; border-top: 1px solid var(--line); }
    .stats li { color: var(--text); }
    .effect { margin-top: 8px; }
    .ename { font-weight: 600; }
    .kind { display: inline-block; margin-right: 6px; padding: 0 6px; border-radius: 6px; font-size: 10.5px; font-weight: 600;
      text-transform: uppercase; letter-spacing: 0.04em; background: var(--accent-2-soft); color: var(--accent-2); }
    .kind.active { background: var(--accent-soft); color: var(--accent); }
    .etext { color: var(--text-dim); white-space: pre-line; }
    .from { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin-top: 10px; padding-top: 8px; border-top: 1px solid var(--line); }
    .from img { width: 22px; height: 22px; border-radius: 4px; }
    .tip.fit { width: max-content; max-width: min(300px, calc(100vw - 16px)); }
    header img.round { border-radius: 50%; background: var(--bg-sunken); }
    header img.tree { padding: 5px; }
    .sub { color: var(--gold); font-size: 11.5px; letter-spacing: 0.02em; }
    .ptext { margin-top: 10px; padding-top: 8px; border-top: 1px solid var(--line); color: var(--text-dim); white-space: pre-line; }
  `,
})
export class ItemTipPopup {
  protected readonly rift = inject(RiftService);
  private readonly state = inject(ItemTipState);
  private readonly box = viewChild<ElementRef<HTMLElement>>('box');

  protected readonly item = computed(() => {
    const c = this.state.current();
    return c?.kind === 'item' ? (this.rift.itemById().get(c.id) ?? null) : null;
  });

  /** Where each rune sits: its tree and row ("Domination", "keystone"); shards are in every tree. */
  private readonly runePlace = computed(() => {
    const at = new Map<number, { tree: string; kind: string }>();
    for (const t of this.rift.statics()?.styles ?? []) {
      for (const s of t.slots ?? []) for (const id of s.perks) if (!at.has(id)) at.set(id, { tree: t.name, kind: s.kind });
    }
    return at;
  });

  /** A rune, tree or spell card: icon, name, what it is, and the client's description. */
  protected readonly perk = computed(() => {
    const c = this.state.current();
    if (!c || c.kind === 'item') return null;
    const map = c.kind === 'rune' ? this.rift.perkById() : c.kind === 'tree' ? this.rift.styleById() : this.rift.spellById();
    const p = map.get(c.id);
    if (!p) return null;
    let sub = c.kind === 'tree' ? 'Rune path' : c.kind === 'spell' ? 'Summoner spell' : p.tag;
    if (c.kind === 'rune') {
      const at = this.runePlace().get(p.id);
      if (at?.kind === 'shard') sub = 'Stat shard';
      else if (at) sub = [at.kind === 'keystone' ? `${at.tree} keystone` : at.tree, p.tag].filter(Boolean).join(' · ');
    }
    return { kind: c.kind, name: p.name, icon: assetUrl(p.iconPath), sub, text: p.longDesc || p.desc };
  });
  protected readonly from = computed(() =>
    (this.item()?.from ?? []).map((id) => ({ id, name: this.rift.itemName(id) || `Item ${id}` })),
  );

  constructor() {
    // Items: below the hovered element, or above it when there's no room. Runes, trees and
    // spells sit in tight grids, so their card goes beside the icon (right, else left), like
    // the client's rune page. Always kept on screen.
    // Measuring and moving are separate phases, so Angular batches the reads before
    // any writes and the page is laid out once per hover.
    const GAP = 8;
    afterRenderEffect({
      earlyRead: () => {
        const box = this.box()?.nativeElement;
        const c = this.state.current();
        const anchor = c?.anchor;
        if (!box || !anchor) return null;
        const a = anchor.getBoundingClientRect();
        const w = box.offsetWidth;
        const h = box.offsetHeight;
        if (c.kind !== 'item') {
          const right = a.right + GAP;
          const x = right + w <= window.innerWidth - GAP ? right : Math.max(GAP, a.left - GAP - w);
          const y = Math.min(Math.max(GAP, a.top + a.height / 2 - 24), window.innerHeight - h - GAP);
          return { box, transform: `translate(${Math.round(x)}px, ${Math.round(y)}px)` };
        }
        const left = Math.min(Math.max(GAP, a.left + a.width / 2 - w / 2), window.innerWidth - w - GAP);
        const below = a.bottom + GAP;
        const top = below + h <= window.innerHeight - GAP ? below : Math.max(GAP, a.top - GAP - h);
        return { box, transform: `translate(${Math.round(left)}px, ${Math.round(top)}px)` };
      },
      write: (pos) => {
        const p = pos();
        if (p) p.box.style.transform = p.transform;
      },
    });
  }
}
