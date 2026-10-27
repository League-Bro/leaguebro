import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { UpdateService } from '../core/update.service';

/**
 * The update screens: a popup when a new version comes out while the app runs,
 * and a full-window splash (the app icon's face glowing and swirling) while an
 * update downloads and installs.
 */
@Component({
  selector: 'rl-update-splash',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (updates.showSplash()) {
      <div class="update-splash" role="status" aria-live="polite">
        <div class="stage">
          <div class="halo"></div>
          <div class="ring one"></div>
          <div class="ring two"></div>
          <div class="sparks">
            <i></i><i></i><i></i><i></i><i></i><i></i>
          </div>
          <svg class="face" viewBox="0 0 1024 1024" aria-hidden="true">
            <rect x="32" y="32" width="960" height="960" rx="210" fill="#151021" />
            <g class="dots" fill="#2fd4c4">
              <circle cx="170" cy="190" r="14" />
              <circle cx="862" cy="230" r="10" />
              <circle cx="880" cy="820" r="14" />
              <circle cx="160" cy="800" r="10" />
            </g>
            <g fill="#ff4fa3" class="drips">
              <rect x="410" y="790" width="46" height="160" rx="23" />
              <rect x="610" y="780" width="40" height="100" rx="20" />
            </g>
            <path
              class="swirl"
              pathLength="100"
              d="M512,180 C700,175 840,320 834,510 C828,700 690,836 505,830 C318,824 186,690 192,500 C198,316 330,186 540,190"
              fill="none" stroke="#ff4fa3" stroke-width="60" stroke-linecap="round"
            />
            <g class="eye-x" stroke="#2fd4c4" stroke-width="56" stroke-linecap="round">
              <line x1="332" y1="342" x2="448" y2="458" />
              <line x1="448" y1="342" x2="332" y2="458" />
            </g>
            <path class="eye-o" d="M652,400 a22,22 0 1,1 -44,0 a52,52 0 1,1 104,0" fill="none" stroke="#2fd4c4" stroke-width="40" stroke-linecap="round" />
            <path
              class="grin"
              d="M320,592 L376,664 L432,600 L480,688 L528,600 L576,688 L624,600 L672,664 L712,592"
              fill="none" stroke="#ff4fa3" stroke-width="52" stroke-linecap="round" stroke-linejoin="round"
            />
          </svg>
        </div>
        <h1>Updating League Bro</h1>
        <p class="what">to version {{ version() }}</p>
        <div class="bar" [class.indeterminate]="percent() === null">
          <span [style.width.%]="percent() ?? 100"></span>
        </div>
        <p class="faint small">{{ step() }}</p>
      </div>
    } @else if (updates.showPrompt()) {
      <div class="backdrop">
        <div class="prompt" role="dialog" aria-labelledby="update-title">
          <img src="favicon.png" alt="" />
          <div>
            <h2 id="update-title">League Bro {{ version() }} is out</h2>
            <p class="dim">Update now? It takes a few seconds and League Bro restarts by itself.</p>
            <div class="actions">
              <button class="primary" (click)="updates.install()">Update now</button>
              <button class="ghost" (click)="updates.later()">Later</button>
            </div>
          </div>
        </div>
      </div>
    }
  `,
  styles: `
    .update-splash {
      position: fixed; inset: 0; z-index: 1000;
      display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px;
      background:
        radial-gradient(520px 420px at 50% 42%, rgba(255, 79, 163, 0.16), transparent 70%),
        radial-gradient(700px 520px at 50% 60%, rgba(47, 212, 196, 0.08), transparent 70%),
        var(--bg);
      animation: fade-in 0.35s ease-out;
    }
    .stage { position: relative; width: 300px; height: 300px; display: grid; place-items: center; margin-bottom: 18px; }
    .face {
      position: relative; width: 168px; height: 168px; border-radius: 36px;
      animation: bob 2.4s ease-in-out infinite, glow 2.4s ease-in-out infinite;
    }
    .halo {
      position: absolute; inset: 40px; border-radius: 50%;
      background: radial-gradient(circle, rgba(255, 79, 163, 0.5), rgba(47, 212, 196, 0.18) 55%, transparent 72%);
      filter: blur(18px);
      animation: pulse 2.4s ease-in-out infinite;
    }
    .ring { position: absolute; border-radius: 50%; }
    .ring.one {
      inset: 22px;
      background: conic-gradient(from 0deg, transparent 0 8%, #ff4fa3 22%, transparent 38% 52%, #2fd4c4 68%, transparent 84%);
      -webkit-mask: radial-gradient(circle, transparent 62%, #000 63% 67%, transparent 68%);
      mask: radial-gradient(circle, transparent 62%, #000 63% 67%, transparent 68%);
      filter: drop-shadow(0 0 6px rgba(255, 79, 163, 0.8));
      animation: spin 2.2s linear infinite;
    }
    .ring.two {
      inset: 4px;
      background: conic-gradient(from 90deg, transparent 0 18%, #2fd4c4 30%, transparent 44% 70%, #ff4fa3 84%, transparent 96%);
      -webkit-mask: radial-gradient(circle, transparent 66%, #000 67% 69%, transparent 70%);
      mask: radial-gradient(circle, transparent 66%, #000 67% 69%, transparent 70%);
      opacity: 0.8;
      animation: spin 3.4s linear infinite reverse;
    }
    .sparks { position: absolute; inset: 0; animation: spin 7s linear infinite; }
    .sparks i {
      position: absolute; left: 50%; top: 50%; width: 7px; height: 7px; margin: -3.5px; border-radius: 50%;
      background: #2fd4c4; box-shadow: 0 0 10px #2fd4c4;
      animation: twinkle 1.8s ease-in-out infinite;
    }
    .sparks i:nth-child(odd) { background: #ff4fa3; box-shadow: 0 0 10px #ff4fa3; }
    .sparks i:nth-child(1) { transform: rotate(0deg) translateX(146px); }
    .sparks i:nth-child(2) { transform: rotate(60deg) translateX(132px); animation-delay: -0.3s; }
    .sparks i:nth-child(3) { transform: rotate(120deg) translateX(148px); animation-delay: -0.6s; }
    .sparks i:nth-child(4) { transform: rotate(180deg) translateX(134px); animation-delay: -0.9s; }
    .sparks i:nth-child(5) { transform: rotate(240deg) translateX(146px); animation-delay: -1.2s; }
    .sparks i:nth-child(6) { transform: rotate(300deg) translateX(130px); animation-delay: -1.5s; }
    .swirl { stroke-dasharray: 72 28; animation: swirl 1.6s linear infinite; filter: drop-shadow(0 0 18px #ff4fa3); }
    .grin { filter: drop-shadow(0 0 14px #ff4fa3); }
    .eye-x, .eye-o { filter: drop-shadow(0 0 16px #2fd4c4); }
    .eye-x { transform-origin: 390px 400px; animation: spin-eye 2.4s ease-in-out infinite; }
    .eye-o { transform-origin: 660px 400px; animation: blink 3.2s ease-in-out infinite; }
    .dots circle { animation: twinkle 1.6s ease-in-out infinite; }
    .dots circle:nth-child(2) { animation-delay: -0.4s; }
    .dots circle:nth-child(3) { animation-delay: -0.8s; }
    .dots circle:nth-child(4) { animation-delay: -1.2s; }
    .drips rect { transform-box: fill-box; transform-origin: top; animation: drip 2.4s ease-in-out infinite; }
    .drips rect:nth-child(2) { animation-delay: -1.1s; }
    h1 { font-size: 22px; }
    .what { margin: 0 0 14px; color: var(--text-dim); }
    .bar { width: 260px; height: 6px; border-radius: 999px; background: var(--bg-hover); overflow: hidden; }
    .bar span {
      display: block; height: 100%; border-radius: inherit;
      background: linear-gradient(90deg, #ff4fa3, #2fd4c4);
      box-shadow: 0 0 12px rgba(255, 79, 163, 0.7);
      transition: width 0.25s ease-out;
    }
    .bar.indeterminate span { width: 40% !important; animation: slide 1.2s ease-in-out infinite; }
    .small { font-size: 12px; margin: 8px 0 0; }

    .backdrop {
      position: fixed; inset: 0; z-index: 900; display: grid; place-items: center;
      background: rgba(8, 6, 12, 0.55); backdrop-filter: blur(3px);
      animation: fade-in 0.2s ease-out;
    }
    .prompt {
      display: flex; gap: 16px; align-items: flex-start; max-width: 420px; padding: 20px 22px;
      background: var(--bg-raised); border: 1px solid var(--line-strong); border-radius: var(--radius);
      box-shadow: var(--shadow), 0 0 40px rgba(255, 79, 163, 0.18);
      animation: pop 0.25s ease-out;
    }
    .prompt img { width: 48px; height: 48px; border-radius: 12px; filter: drop-shadow(0 0 10px rgba(255, 79, 163, 0.5)); }
    .prompt h2 { font-size: 17px; }
    .prompt p { margin: 6px 0 14px; }
    .actions { display: flex; gap: 8px; }

    @keyframes spin { to { transform: rotate(360deg); } }
    @keyframes swirl { to { stroke-dashoffset: -100; } }
    @keyframes bob { 0%, 100% { transform: translateY(0) rotate(-2deg); } 50% { transform: translateY(-6px) rotate(2deg); } }
    @keyframes glow {
      0%, 100% { filter: drop-shadow(0 0 14px rgba(255, 79, 163, 0.55)); }
      50% { filter: drop-shadow(0 0 30px rgba(47, 212, 196, 0.6)); }
    }
    @keyframes pulse { 0%, 100% { opacity: 0.55; transform: scale(0.92); } 50% { opacity: 1; transform: scale(1.06); } }
    @keyframes twinkle { 0%, 100% { opacity: 0.25; } 50% { opacity: 1; } }
    @keyframes spin-eye { 0%, 55% { transform: rotate(0deg); } 80%, 100% { transform: rotate(180deg); } }
    @keyframes blink { 0%, 88%, 100% { transform: scaleY(1); } 93% { transform: scaleY(0.15); } }
    @keyframes drip { 0%, 100% { transform: scaleY(1); } 50% { transform: scaleY(1.18); } }
    @keyframes slide { from { transform: translateX(-100%); } to { transform: translateX(250%); } }
    @keyframes fade-in { from { opacity: 0; } }
    @keyframes pop { from { opacity: 0; transform: scale(0.96); } }
    @media (prefers-reduced-motion: reduce) {
      .update-splash *, .prompt { animation-duration: 0s !important; animation-iteration-count: 1 !important; }
    }
  `,
})
export class UpdateSplash {
  protected readonly updates = inject(UpdateService);

  protected readonly version = computed(() => {
    const s = this.updates.state();
    return 'version' in s ? s.version : '';
  });
  protected readonly percent = computed(() => {
    const s = this.updates.state();
    return s.kind === 'downloading' ? s.percent : s.kind === 'installing' ? 100 : null;
  });
  protected readonly step = computed(() => {
    const s = this.updates.state();
    if (s.kind === 'installing') return 'Installing. League Bro restarts by itself in a moment.';
    return s.kind === 'downloading' && s.percent !== null ? `Downloading… ${s.percent}%` : 'Downloading…';
  });
}
