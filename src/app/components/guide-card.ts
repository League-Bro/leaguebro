import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { RiftService } from '../core/rift.service';
import { assetUrl } from '../core/assets';
import { Guide } from '../core/models';
import { Loader } from './loader';

const DIFFICULTY = ['', 'Easy', 'Moderate', 'Hard'];
const DAMAGE = { AD: 'Physical damage (AD)', AP: 'Magic damage (AP)', BOTH: 'Mixed damage (AD + AP)' } as Record<string, string>;
const KEY_LABELS: Record<string, string> = { P: 'Passive', Q: 'Q', W: 'W', E: 'E', R: 'Ultimate (R)' };

/** A beginner's guide to a champion: what it does, each ability with Riot's clip, and Riot's tips. */
@Component({
  selector: 'rl-guide',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Loader],
  template: `
    @if (guide(); as g) {
      <section class="card overview">
        <div class="facts">
          @if (difficultyLabel(g.difficulty); as d) {
            <div class="fact">
              <span class="label">Difficulty</span>
              <span class="pips" aria-hidden="true">
                @for (n of [1, 2, 3]; track n) { <i [class.on]="n <= g.difficulty"></i> }
              </span>
              <b>{{ d }}</b>
            </div>
          }
          @if (g.attackType) {
            <div class="fact"><span class="label">Attacks</span><b>{{ g.attackType === 'ranged' ? 'Ranged' : 'Melee' }}</b></div>
          }
          @if (damage(g.damageType); as d) {
            <div class="fact"><span class="label">Deals</span><b>{{ d }}</b></div>
          }
        </div>
        <div class="split">
          <div class="bars">
            @for (b of bars(); track b.label) {
              <div class="bar">
                <span class="label">{{ b.label }}</span>
                <span class="meter">@for (n of [1, 2, 3]; track n) { <i [class.on]="n <= b.value"></i> }</span>
              </div>
            }
          </div>
          @if (g.bio) { <p class="bio muted">{{ g.bio }}</p> }
        </div>
      </section>

      <section class="card abilities">
        <h3>Abilities</h3>
        <div class="keys" role="tablist" aria-label="Abilities">
          @for (a of g.abilities; track a.key; let i = $index) {
            <button class="ability" role="tab" [class.on]="i === selected()" [attr.aria-selected]="i === selected()"
                    [title]="a.name" (click)="selected.set(i)">
              <img [src]="icon(a.icon)" alt="" />
              <span class="key">{{ a.key }}</span>
            </button>
          }
        </div>
        @if (g.abilities[selected()]; as a) {
          <div class="detail">
            @if (a.video) {
              <video [src]="a.video" [poster]="a.poster ?? ''" autoplay muted loop playsinline controls></video>
            }
            <div class="text">
              <div class="faint kicker">{{ keyLabel(a.key) }}</div>
              <h4>{{ a.name }}</h4>
              <p class="muted desc">{{ a.description }}</p>
            </div>
          </div>
        }
      </section>

      <div class="tips">
        @if (g.tips.length) {
          <section class="card">
            <h3>Playing as {{ g.name }}</h3>
            <ul>@for (t of g.tips; track $index) { <li>{{ t }}</li> }</ul>
          </section>
        }
        @if (g.counterTips.length) {
          <section class="card">
            <h3>Playing against {{ g.name }}</h3>
            <ul>@for (t of g.counterTips; track $index) { <li>{{ t }}</li> }</ul>
          </section>
        }
      </div>

      <section class="card videos">
        <div>
          <h3>Video guides</h3>
          <p class="muted small">Search YouTube for beginner guides to {{ g.name }}. Opens in your browser.</p>
        </div>
        <button class="primary" (click)="rift.openGuideVideos(g.name)">Watch on YouTube</button>
      </section>
    } @else if (error()) {
      <section class="card"><p class="muted small">Couldn't load the guide: {{ error() }}</p></section>
    } @else {
      <section class="card"><rl-loader [block]="true" class="faint small">Loading the guide…</rl-loader></section>
    }
  `,
  styles: `
    :host { display: flex; flex-direction: column; gap: 16px; margin-top: 16px; }
    h3 { margin: 0 0 12px; font-size: 15px; }
    h4 { margin: 2px 0 6px; font-size: 17px; }
    .small { font-size: 12.5px; margin: 0; }
    .label { font-size: 10.5px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; color: var(--text-dim); }
    .facts { display: flex; flex-wrap: wrap; gap: 10px 28px; margin-bottom: 16px; }
    .fact { display: flex; align-items: center; gap: 8px; }
    .pips, .meter { display: inline-flex; gap: 3px; }
    .pips i, .meter i { width: 14px; height: 6px; border-radius: 3px; background: var(--bg-sunken); border: 1px solid var(--line-strong); }
    .pips i.on { background: var(--gold); border-color: var(--gold); }
    .meter i.on { background: var(--accent-2); border-color: var(--accent-2); }
    .split { display: grid; grid-template-columns: 220px 1fr; gap: 24px; align-items: start; }
    .bars { display: flex; flex-direction: column; gap: 8px; }
    .bar { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
    .bio { margin: 0; font-size: 13px; line-height: 1.55; }
    .keys { display: flex; gap: 8px; margin-bottom: 14px; }
    .ability { position: relative; padding: 0; width: 52px; height: 52px; border-radius: 12px; overflow: hidden; border: 2px solid var(--line-strong); background: var(--bg-sunken); }
    .ability img { width: 100%; height: 100%; display: block; opacity: 0.6; }
    .ability:hover img, .ability.on img { opacity: 1; }
    .ability.on { border-color: var(--accent); box-shadow: 0 0 14px var(--accent-glow); }
    .ability .key {
      position: absolute; right: 2px; bottom: 2px; font: 700 10.5px var(--mono); color: var(--text);
      background: rgba(0, 0, 0, 0.7); border-radius: 4px; padding: 0 4px;
    }
    .detail { display: grid; grid-template-columns: minmax(0, 1.3fr) minmax(0, 1fr); gap: 20px; align-items: start; }
    .detail:has(> .text:only-child) { grid-template-columns: 1fr; }
    video { width: 100%; display: block; border-radius: var(--radius-sm); background: #000; border: 1px solid var(--line); }
    .kicker { font-size: 11px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; }
    .desc { margin: 0; white-space: pre-line; line-height: 1.55; font-size: 13.5px; }
    .tips { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 16px; }
    .tips ul { margin: 0; padding-left: 18px; display: flex; flex-direction: column; gap: 8px; line-height: 1.5; font-size: 13.5px; }
    .videos { display: flex; align-items: center; gap: 16px; justify-content: space-between; }
    .videos h3 { margin-bottom: 4px; }
    @media (max-width: 900px) {
      .split, .detail { grid-template-columns: 1fr; }
    }
  `,
})
export class GuideCard {
  protected readonly rift = inject(RiftService);
  readonly championId = input.required<number>();
  protected readonly guide = signal<Guide | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly selected = signal(0);
  private seq = 0;

  protected readonly bars = computed(() => {
    const p = this.guide()?.playstyle;
    if (!p) return [];
    return [
      { label: 'Damage', value: p.damage },
      { label: 'Toughness', value: p.durability },
      { label: 'Crowd control', value: p.crowdControl },
      { label: 'Mobility', value: p.mobility },
      { label: 'Utility', value: p.utility },
    ];
  });

  constructor() {
    effect(() => {
      const id = this.championId();
      untracked(() => this.load(id));
    });
  }

  private async load(championId: number): Promise<void> {
    const seq = ++this.seq;
    this.guide.set(null);
    this.error.set(null);
    this.selected.set(0);
    try {
      const g = await this.rift.championGuide(championId);
      if (seq === this.seq) this.guide.set(g);
    } catch (e) {
      if (seq === this.seq) this.error.set(String(e));
    }
  }

  protected icon = assetUrl;
  protected difficultyLabel(d: number): string {
    return DIFFICULTY[d] ?? '';
  }
  protected damage(d: string): string {
    return DAMAGE[d] ?? '';
  }
  protected keyLabel(k: string): string {
    return KEY_LABELS[k] ?? k;
  }
}
