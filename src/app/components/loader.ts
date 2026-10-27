import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * The app's loading indicator: the icon face from the startup splash, small,
 * glowing and with a ring swirling around it. Text inside the tag shows next
 * to it, e.g. `<rl-loader>Loading patch notes…</rl-loader>`.
 */
@Component({
  selector: 'rl-loader',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { role: 'status', '[style.--size.px]': 'size()', '[class.block]': 'block()' },
  template: `
    <span class="face-wrap">
      <span class="ring"></span>
      <svg class="face" viewBox="0 0 1024 1024" aria-hidden="true">
        <rect x="32" y="32" width="960" height="960" rx="210" fill="#151021" />
        <path
          class="swirl"
          pathLength="100"
          d="M512,180 C700,175 840,320 834,510 C828,700 690,836 505,830 C318,824 186,690 192,500 C198,316 330,186 540,190"
          fill="none" stroke="#ff4fa3" stroke-width="70" stroke-linecap="round"
        />
        <g stroke="#2fd4c4" stroke-width="64" stroke-linecap="round">
          <line x1="332" y1="342" x2="448" y2="458" />
          <line x1="448" y1="342" x2="332" y2="458" />
        </g>
        <path d="M652,400 a22,22 0 1,1 -44,0 a52,52 0 1,1 104,0" fill="none" stroke="#2fd4c4" stroke-width="48" stroke-linecap="round" />
        <path
          d="M320,592 L376,664 L432,600 L480,688 L528,600 L576,688 L624,600 L672,664 L712,592"
          fill="none" stroke="#ff4fa3" stroke-width="60" stroke-linecap="round" stroke-linejoin="round"
        />
      </svg>
    </span>
    <span class="text"><ng-content /></span>
  `,
  styles: `
    :host { display: inline-flex; align-items: center; gap: 10px; vertical-align: middle; --size: 28px; }
    :host(.block) { display: flex; justify-content: center; padding: 18px 0; }
    .text:empty { display: none; }
    .face-wrap { position: relative; flex: none; width: var(--size); height: var(--size); display: grid; place-items: center; }
    .face {
      width: 74%; height: 74%; border-radius: 22%;
      animation: bob 1.6s ease-in-out infinite, glow 1.6s ease-in-out infinite;
    }
    .ring {
      position: absolute; inset: 0; border-radius: 50%;
      background: conic-gradient(from 0deg, transparent 0 10%, #ff4fa3 35%, transparent 50% 60%, #2fd4c4 85%, transparent);
      -webkit-mask: radial-gradient(circle, transparent 62%, #000 64%);
      mask: radial-gradient(circle, transparent 62%, #000 64%);
      animation: spin 1.1s linear infinite;
    }
    .swirl { stroke-dasharray: 72 28; animation: swirl 1.2s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }
    @keyframes swirl { to { stroke-dashoffset: -100; } }
    @keyframes bob { 0%, 100% { transform: rotate(-4deg); } 50% { transform: rotate(4deg) scale(1.04); } }
    @keyframes glow {
      0%, 100% { filter: drop-shadow(0 0 3px rgba(255, 79, 163, 0.7)); }
      50% { filter: drop-shadow(0 0 6px rgba(47, 212, 196, 0.8)); }
    }
  `,
})
export class Loader {
  /** Width and height of the face and its ring, in px. */
  readonly size = input(28);
  /** Centered on its own line, for a whole page or card that's loading. */
  readonly block = input(false);
}
