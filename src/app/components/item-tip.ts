// Item tooltip: hovering (or focusing) anything with `[rlItemTip]="id"` shows the
// item's full card, like the in-game shop: cost, stats, passives/actives and what
// it's built from. One <rl-item-tip /> in the shell draws it for the whole app.
import { ChangeDetectionStrategy, Component, Directive, ElementRef, Injectable, OnDestroy, afterRenderEffect, computed, inject, input, signal, viewChild } from '@angular/core';
import { RiftService } from '../core/rift.service';

/** Moving between neighbouring icons within this keeps the card open and just swaps its contents. */
const HIDE_DELAY_MS = 80;

@Injectable({ providedIn: 'root' })
export class ItemTipState {
  readonly current = signal<{ id: number; anchor: HTMLElement } | null>(null);
  private hideTimer = 0;

  show(id: number, anchor: HTMLElement): void {
    clearTimeout(this.hideTimer);
    const c = this.current();
    if (c?.id !== id || c.anchor !== anchor) this.current.set({ id, anchor });
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
  private readonly el = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly tip = inject(ItemTipState);
  private readonly show = () => this.rlItemTip() > 0 && this.tip.show(this.rlItemTip(), this.el);
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
  `,
})
export class ItemTipPopup {
  protected readonly rift = inject(RiftService);
  private readonly state = inject(ItemTipState);
  private readonly box = viewChild<ElementRef<HTMLElement>>('box');

  protected readonly item = computed(() => {
    const c = this.state.current();
    return c ? (this.rift.itemById().get(c.id) ?? null) : null;
  });
  protected readonly from = computed(() =>
    (this.item()?.from ?? []).map((id) => ({ id, name: this.rift.itemName(id) || `Item ${id}` })),
  );

  constructor() {
    // Below the hovered element, or above it when there's no room; kept on screen.
    // Measuring and moving are separate phases, so Angular batches the reads before
    // any writes and the page is laid out once per hover.
    const GAP = 8;
    afterRenderEffect({
      earlyRead: () => {
        const box = this.box()?.nativeElement;
        const anchor = this.state.current()?.anchor;
        if (!box || !anchor) return null;
        const a = anchor.getBoundingClientRect();
        const w = box.offsetWidth;
        const h = box.offsetHeight;
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
