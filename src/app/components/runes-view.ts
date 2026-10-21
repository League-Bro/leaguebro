import { Component, computed, inject, signal } from '@angular/core';
import { RiftService } from '../core/rift.service';
import { ChampPicker } from './champ-picker';
import { assetUrl, championIcon } from '../core/assets';
import { RunePage } from '../core/models';

@Component({
  selector: 'rl-runes',
  imports: [ChampPicker],
  template: `
    @if (rift.config(); as cfg) {
      <div class="grid">
        <section class="card stack">
          <h2>Auto-import</h2>
          <label class="toggle">
            <input type="checkbox" [checked]="cfg.autoImportRunes" (change)="set('autoImportRunes', $any($event.target).checked)" />
            <span class="track"></span>
            <span class="label"><b>Import runes in champ select</b><span>Creates one page called "League Buddy: …" and replaces it each game.</span></span>
          </label>
          <label class="toggle">
            <input type="checkbox" [checked]="cfg.importOnHover" (change)="set('importOnHover', $any($event.target).checked)" />
            <span class="track"></span>
            <span class="label"><b>Import while hovering</b><span>Don't wait for lock-in. Handy for blind pick.</span></span>
          </label>
          <label class="toggle">
            <input type="checkbox" [checked]="cfg.reuseCurrentPageWhenFull" (change)="set('reuseCurrentPageWhenFull', $any($event.target).checked)" />
            <span class="track"></span>
            <span class="label"><b>Reuse the selected page when slots are full</b><span>Overwrites whichever editable page is selected. Leave off if you'd rather keep one slot free for League Buddy.</span></span>
          </label>
          @if (rift.lastImport(); as li) {
            <p class="last" [class.loss]="!li.ok">
              <span class="faint">Last import:</span> {{ rift.champName(li.championId) }}: {{ li.message }}
            </p>
          }
        </section>

        <section class="card stack">
          <h2>Where pages come from</h2>
          <p class="muted">
            By default League Buddy uses the League client's own recommended page for your champion and role. To use your own page
            for a champion instead, select that page in the client's rune editor, then save it here.
          </p>
          <div class="row">
            <rl-champ-picker placeholder="Champion to save for…" (picked)="saveFor($event)" />
            @if (currentChamp(); as c) {
              <button (click)="saveFor(c)">Save for {{ rift.champName(c) }}</button>
            }
          </div>
          @if (msg(); as m) { <p class="msg" [class.loss]="m.bad">{{ m.text }}</p> }
        </section>
      </div>

      <h3 class="section">Your saved pages ({{ saved().length }})</h3>
      @if (saved().length === 0) {
        <p class="faint">None yet. Every champion uses the client recommendation.</p>
      }
      <div class="pages">
        @for (s of saved(); track s.championId) {
          <div class="page card row">
            <img class="champ-icon" [src]="icon(s.championId)" alt="" />
            <div class="grow">
              <div class="name">{{ rift.champName(s.championId) }}</div>
              <div class="muted small">{{ s.page.name || 'Untitled page' }} · {{ styleName(s.page.primaryStyleId) }} / {{ styleName(s.page.subStyleId) }}</div>
              <div class="perks">
                @for (id of s.page.selectedPerkIds; track $index) {
                  @if (perkIcon(id); as url) {
                    <img [src]="url" [title]="perkName(id)" alt="" />
                  }
                }
              </div>
            </div>
            <button class="ghost" (click)="remove(s.championId)">Remove</button>
          </div>
        }
      </div>
    }
  `,
  styles: `
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
    .card { gap: 8px; }
    .last, .msg { font-size: 13px; margin: 4px 0 0; }
    .section { margin: 26px 0 10px; }
    .pages { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 10px; }
    .page { padding: 12px; }
    .grow { flex: 1; min-width: 0; }
    .name { font-weight: 600; }
    .small { font-size: 12.5px; }
    .perks { display: flex; gap: 3px; margin-top: 6px; }
    .perks img { width: 22px; height: 22px; }
    p { margin: 0; }
    @media (max-width: 900px) { .grid { grid-template-columns: 1fr; } }
  `,
})
export class RunesView {
  protected readonly rift = inject(RiftService);
  protected readonly msg = signal<{ text: string; bad: boolean } | null>(null);

  protected readonly currentChamp = computed(() => this.rift.champSelect()?.myChampionId || 0);
  protected readonly saved = computed(() => {
    const o = this.rift.config()?.runeOverrides ?? {};
    return Object.entries(o)
      .map(([id, page]) => ({ championId: Number(id), page: page as RunePage }))
      .sort((a, b) => this.rift.champName(a.championId).localeCompare(this.rift.champName(b.championId)));
  });

  protected icon = championIcon;

  styleName(id: number): string {
    return this.rift.styleById().get(id)?.name ?? `#${id}`;
  }
  perkName(id: number): string {
    return this.rift.perkById().get(id)?.name ?? '';
  }
  perkIcon(id: number): string {
    return assetUrl(this.rift.perkById().get(id)?.iconPath);
  }

  set(key: 'autoImportRunes' | 'importOnHover' | 'reuseCurrentPageWhenFull', value: boolean): void {
    this.rift.updateConfig((c) => ({ ...c, [key]: value }));
  }

  async saveFor(championId: number): Promise<void> {
    try {
      const page = await this.rift.saveCurrentPageFor(championId);
      this.msg.set({ text: `Saved "${page.name}" for ${this.rift.champName(championId)}.`, bad: false });
    } catch (e) {
      this.msg.set({ text: String(e), bad: true });
    }
  }

  remove(championId: number): void {
    this.rift.updateConfig((c) => {
      delete c.runeOverrides[String(championId)];
      return c;
    });
  }
}
