import { ChangeDetectionStrategy, Component, input, signal } from '@angular/core';

/** One sweep, in ms. Matches --t in the styles (the dim radar shows no blips). */
const SWEEP_MS = 4000;

interface Blip { key: number; x: number; y: number; delay: number; }

/**
 * The idle Live tab's "listening" animation: a radar scope. A bright line sweeps round with a
 * fading trail behind it, and blips light up as it passes them and slowly fade out again, so the
 * page looks awake while it waits for a lobby, a queue or a game. CSS only (rotation and opacity),
 * so it costs next to nothing. `dim` greys it out and slows it for when the League client isn't open.
 */
@Component({
  selector: 'rl-live-radar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="scope" [class.dim]="dim()" aria-hidden="true">
      <span class="ring r1"></span><span class="ring r2"></span><span class="ring r3"></span>
      <span class="cross"></span>
      <span class="sweep" (animationstart)="roll()" (animationiteration)="roll()"><span class="beam"></span></span>
      @if (!dim()) {
        @for (b of blips(); track b.key) {
          <span class="blip" [style.left.%]="b.x" [style.top.%]="b.y" [style.animation-delay.ms]="b.delay"></span>
        }
      }
      <img class="core" src="favicon.png" alt="" />
    </div>
    <div class="label" [class.dim]="dim()"><span class="dot"></span>{{ label() }}</div>
  `,
  styles: `
    :host { display: flex; flex-direction: column; align-items: center; gap: 14px; margin-bottom: 18px; }
    /* One sweep takes --t; each blip's delay is its angle (clockwise from 12 o'clock) / 360 × the
       sweep, so it lights up exactly when the beam reaches it. */
    .scope {
      --c: var(--accent); --c2: var(--accent-2); --t: 4s;
      position: relative; width: 184px; height: 184px; border-radius: 50%; overflow: hidden;
      background: radial-gradient(circle, color-mix(in srgb, var(--c2) 9%, transparent), transparent 70%);
      box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--c2) 45%, transparent), 0 0 40px color-mix(in srgb, var(--c) 12%, transparent);
    }
    .scope.dim { --c: var(--text-faint); --c2: var(--text-faint); --t: 8s; opacity: 0.75; }
    .ring { position: absolute; border-radius: 50%; border: 1px dashed color-mix(in srgb, var(--c2) 28%, transparent); }
    .r1 { inset: 23px; } .r2 { inset: 46px; } .r3 { inset: 69px; border-style: solid; }
    .cross {
      position: absolute; inset: 0;
      background:
        linear-gradient(color-mix(in srgb, var(--c2) 22%, transparent), color-mix(in srgb, var(--c2) 22%, transparent)) center / 1px 100% no-repeat,
        linear-gradient(color-mix(in srgb, var(--c2) 22%, transparent), color-mix(in srgb, var(--c2) 22%, transparent)) center / 100% 1px no-repeat;
    }
    /* The trail: brightest right behind the beam, fading out over the quarter turn behind it. */
    .sweep {
      position: absolute; inset: 0; border-radius: 50%;
      background: conic-gradient(from 0deg, transparent 0deg 250deg, color-mix(in srgb, var(--c) 6%, transparent) 290deg, color-mix(in srgb, var(--c) 22%, transparent) 340deg, color-mix(in srgb, var(--c) 45%, transparent) 360deg);
      animation: spin var(--t) linear infinite;
    }
    .beam {
      position: absolute; left: calc(50% - 1px); top: 0; width: 2px; height: 50%;
      background: linear-gradient(var(--c), color-mix(in srgb, var(--c) 30%, transparent));
      box-shadow: 0 0 10px var(--c), 0 0 2px var(--c);
    }
    .blip {
      position: absolute; width: 8px; height: 8px; margin: -4px; border-radius: 50%;
      background: var(--c2); box-shadow: 0 0 12px var(--c2); opacity: 0;
      animation: blip var(--t) linear forwards;
    }
    /* A ring pops out of each blip as the beam hits it. Forwards fill only: until the beam
       gets there the blip stays hidden (opacity 0), so the sweep finds it rather than clears it. */
    .blip::after {
      content: ''; position: absolute; inset: -1px; border-radius: 50%; border: 1px solid var(--c2);
      animation: hit var(--t) ease-out forwards; animation-delay: inherit; opacity: 0;
    }
    .core {
      position: absolute; left: 50%; top: 50%; width: 44px; height: 44px; margin: -22px;
      filter: drop-shadow(0 0 12px var(--accent-glow));
    }
    .dim .core { filter: grayscale(1); opacity: 0.6; }
    .label { display: flex; align-items: center; gap: 8px; font: 600 11px var(--mono); letter-spacing: 0.14em; text-transform: uppercase; color: var(--accent); }
    .label.dim { color: var(--text-faint); }
    .label .dot { width: 7px; height: 7px; border-radius: 50%; background: currentColor; box-shadow: 0 0 8px currentColor; animation: fade 1.6s ease-in-out infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }
    /* Hit at 0%, then a slow afterglow that's gone before the beam comes round again. */
    @keyframes blip { 0% { opacity: 1; transform: scale(1.4); } 6% { transform: scale(1); } 60% { opacity: 0.25; } 75%, 100% { opacity: 0; } }
    @keyframes hit { 0% { transform: scale(1); opacity: 0.9; } 18%, 100% { transform: scale(4); opacity: 0; } }
    @keyframes fade { 50% { opacity: 0.3; } }
  `,
})
export class LiveRadar {
  readonly label = input('Listening');
  readonly dim = input(false);

  protected readonly blips = signal<Blip[]>([]);
  private next = 0;
  /** Last sweep's blips, kept one more round so a late one can finish fading. */
  private last: Blip[] = [];

  /** A new handful as each sweep starts, so their delays line up with the beam. */
  protected roll(): void {
    const fresh = this.pick();
    this.blips.set([...this.last, ...fresh]);
    this.last = fresh;
  }

  /** 0 blips 30% of the time, 1 half the time, 2 the rest, anywhere between the logo and the rim. */
  private pick(): Blip[] {
    const r = Math.random();
    const count = r < 0.3 ? 0 : r < 0.8 ? 1 : 2;
    return Array.from({ length: count }, () => {
      const angle = Math.random() * 360;
      const dist = 0.3 + Math.random() * 0.55;
      const rad = (angle * Math.PI) / 180;
      return {
        key: this.next++,
        x: 50 + Math.sin(rad) * dist * 50,
        y: 50 - Math.cos(rad) * dist * 50,
        delay: (angle / 360) * SWEEP_MS,
      };
    });
  }
}
