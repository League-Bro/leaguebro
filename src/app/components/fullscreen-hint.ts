import { Component, inject } from '@angular/core';
import { RiftService } from '../core/rift.service';

/** Shown while League is set to Fullscreen, which covers the overlay. */
@Component({
  selector: 'rl-fullscreen-hint',
  template: `
    @if (rift.fullscreenHint()) {
      <div class="hint" role="status">
        <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
          <circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" stroke-width="1.5" />
          <path d="M8 4.5v4.5M8 11v.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
        </svg>
        <div>
          <b>League is set to Fullscreen, so the overlay can't show on top of it.</b>
          <span>
            In League, go to <b>Settings → Video → Window Mode</b> and pick <b>Borderless</b>. It looks the same, and you
            can switch during a game.
          </span>
        </div>
      </div>
    }
  `,
  styles: `
    .hint {
      display: flex; gap: 10px; align-items: flex-start; padding: 10px 14px; border-radius: 12px;
      background: var(--accent-soft); border: 1px solid var(--accent); color: var(--text); font-size: 13px; line-height: 1.45;
    }
    .hint svg { flex: none; margin-top: 1px; color: var(--accent); }
    .hint > div { display: flex; flex-direction: column; gap: 2px; }
    .hint span { color: var(--text-dim); }
    .hint span b { color: var(--text); font-weight: 600; }
  `,
})
export class FullscreenHint {
  protected readonly rift = inject(RiftService);
}
