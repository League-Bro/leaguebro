import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { RiftService } from '../core/rift.service';
import { championIcon, positionLabel } from '../core/assets';
import { demoBanSuggestions } from '../core/demo';
import { BanSuggestions, SuggestedBan } from '../core/models';
import { Loader } from './loader';

/** How many bans the card shows. */
const SHOWN = 5;

/**
 * Champions to ban, at the very top of champ select while your ban is still
 * to make: your lane's strongest by Lolalytics win rate, nudged a little
 * toward champions you've lost to lately (`bans.rs`). Gone once you've banned.
 */
@Component({
  selector: 'rl-ban-suggest',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DecimalPipe, Loader],
  template: `
    @if (visible() && state(); as s) {
      <section class="card bans">
        <div class="head">
          <h3>Ban suggestions</h3>
          <span class="faint small">{{ pos(s.position) }} · Lolalytics Emerald+ win rate{{ s.personal ? ' + your recent losses' : '' }}</span>
          @if (s.loading) {
            <rl-loader [size]="16" class="faint small" />
          }
        </div>
        @if (shown().length) {
          <div class="row">
            @for (b of shown(); track b.championId) {
              <div class="ban" [title]="tip(b)">
                <img class="champ-icon" [src]="icon(b.championId)" alt="" />
                <div class="info">
                  <div class="name">{{ rift.champName(b.championId) }}</div>
                  <div class="line">
                    <span class="mono" [class.loss]="b.winRate >= 0.515">{{ b.winRate * 100 | number: '1.1-1' }}%</span>
                    @if (b.personal > 0) {
                      <span class="you" title="Your record against it in recent games">You {{ b.winsVs }}-{{ b.gamesVs - b.winsVs }}</span>
                    } @else {
                      <span class="faint">{{ b.tier }}</span>
                    }
                  </div>
                </div>
              </div>
            }
          </div>
        } @else if (s.error) {
          <p class="loss small">Couldn't get the Lolalytics win rates: {{ s.error }}</p>
        } @else if (s.loading) {
          <p class="faint small">Looking up bans…</p>
        }
      </section>
    }
  `,
  styles: `
    .bans { margin-bottom: 14px; display: flex; flex-direction: column; gap: 8px; padding-top: 12px; padding-bottom: 12px; }
    .head { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; }
    .head h3 { margin: 0; }
    .small { font-size: 12px; }
    .row { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 6px; }
    .ban { display: flex; align-items: center; gap: 8px; padding: 6px 8px; border-radius: 10px; background: var(--bg-sunken); min-width: 0; }
    .ban .champ-icon { width: 34px; height: 34px; border-radius: 8px; flex: none; }
    .info { min-width: 0; display: flex; flex-direction: column; gap: 1px; }
    .name { font-weight: 600; font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .line { display: flex; align-items: center; gap: 6px; font-size: 12px; white-space: nowrap; }
    .you { font-size: 10.5px; line-height: 1; padding: 3px 6px; border-radius: 999px; color: var(--enemy); background: color-mix(in srgb, var(--enemy) 16%, transparent); font-weight: 600; }
  `,
})
export class BanSuggest {
  protected readonly rift = inject(RiftService);
  protected readonly icon = championIcon;
  protected readonly pos = positionLabel;
  private readonly live = signal<BanSuggestions | null>(null);

  constructor() {
    if (this.rift.demo) return;
    let stop: (() => void) | null = null;
    let gone = false;
    listen<BanSuggestions | null>('ban-suggestions', (e) => this.live.set(e.payload)).then((un) => (gone ? un() : (stop = un)));
    invoke<BanSuggestions | null>('get_ban_suggestions').then((s) => this.live.set(s ?? null));
    inject(DestroyRef).onDestroy(() => {
      gone = true;
      stop?.();
    });
  }

  protected readonly state = computed<BanSuggestions | null>(() => (this.rift.demo ? demoBanSuggestions() : this.live()));

  /** Until your ban is in. */
  protected readonly visible = computed(() => !!this.rift.champSelect()?.banPending);

  protected readonly shown = computed(() => (this.state()?.bans ?? []).slice(0, SHOWN));

  tip(b: SuggestedBan): string {
    const name = this.rift.champName(b.championId);
    const lines = [
      `${name}: ${(b.winRate * 100).toFixed(2)}% win rate in ${this.pos(this.state()?.position ?? '')} (Lolalytics tier ${b.tier})`,
      `Picked ${(b.pickRate * 100).toFixed(1)}%, banned ${(b.banRate * 100).toFixed(1)}% of games`,
    ];
    if (b.gamesVs) lines.push(`You: ${b.winsVs}-${b.gamesVs - b.winsVs} against ${name} in recent games`);
    if (b.laneGamesVs) lines.push(`${b.laneWinsVs}-${b.laneGamesVs - b.laneWinsVs} with ${name} as your lane opponent`);
    if (b.personal > 0) lines.push(`Moved up ${b.personal.toFixed(2)} points for those losses`);
    return lines.join('\n');
  }
}
