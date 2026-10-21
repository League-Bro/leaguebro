import { Injectable, computed, signal } from '@angular/core';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import {
  ChampSelectView,
  Config,
  ImportEvent,
  LoadingView,
  OverlayState,
  PatchInfo,
  PatchNotes,
  Profile,
  RecState,
  RunePage,
  Snapshot,
  StaticData,
  Status,
} from './models';
import { demoChampSelect, demoConfig, demoPatch, demoPatchList, demoSnapshot, demoStatic } from './demo';

export function inTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

@Injectable({ providedIn: 'root' })
export class RiftService {
  readonly status = signal<Status>({ connected: false, phase: '', summoner: null, message: 'Starting…' });
  readonly champSelect = signal<ChampSelectView | null>(null);
  readonly loading = signal<LoadingView | null>(null);
  readonly profiles = signal<Record<string, Profile>>({});
  readonly lastImport = signal<ImportEvent | null>(null);
  readonly overlay = signal<OverlayState | null>(null);
  readonly rec = signal<RecState | null>(null);
  readonly overlayPreview = signal(false);
  readonly overlayLocked = signal(true);
  readonly config = signal<Config | null>(null);
  readonly statics = signal<StaticData | null>(null);
  /** Window label: "main" or "overlay". */
  readonly windowLabel = signal('main');
  readonly demo = !inTauri();

  readonly champById = computed(() => {
    const m = new Map<number, string>();
    for (const c of this.statics()?.champions ?? []) m.set(c.id, c.name);
    return m;
  });
  readonly itemById = computed(() => new Map((this.statics()?.items ?? []).map((i) => [i.id, i])));
  readonly perkById = computed(() => new Map((this.statics()?.perks ?? []).map((p) => [p.id, p])));
  readonly spellById = computed(() => new Map((this.statics()?.spells ?? []).map((p) => [p.id, p])));
  readonly styleById = computed(() => new Map((this.statics()?.styles ?? []).map((p) => [p.id, p])));

  private started = false;

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    if (this.demo) {
      this.windowLabel.set(new URLSearchParams(location.search).get('window') ?? 'main');
      const snap = demoSnapshot();
      if (new URLSearchParams(location.search).get('scene') === 'champselect') {
        snap.status.phase = 'ChampSelect';
        snap.loading = null;
        snap.overlay = null;
        snap.champSelect = demoChampSelect();
      }
      this.applySnapshot(snap);
      this.statics.set(demoStatic());
      this.config.set(demoConfig());
      return;
    }
    this.windowLabel.set(getCurrentWindow().label);
    await Promise.all([
      listen<Status>('status', (e) => this.status.set(e.payload)),
      listen<ChampSelectView | null>('champ-select', (e) => this.champSelect.set(e.payload)),
      listen<LoadingView | null>('loading', (e) => this.loading.set(e.payload)),
      listen<Profile>('scout', (e) => this.profiles.update((p) => ({ ...p, [e.payload.puuid]: e.payload }))),
      listen<ImportEvent>('rune-import', (e) => this.lastImport.set(e.payload)),
      listen<OverlayState | null>('overlay', (e) => this.overlay.set(e.payload)),
      listen<RecState | null>('recommendation', (e) => this.rec.set(e.payload)),
      listen<boolean>('overlay-preview', (e) => this.overlayPreview.set(e.payload)),
      listen<boolean>('overlay-locked', (e) => this.overlayLocked.set(e.payload)),
      listen<Config>('config', (e) => this.config.set(e.payload)),
      listen<StaticData>('static', (e) => this.statics.set(e.payload)),
    ]);
    this.applySnapshot(await invoke<Snapshot>('get_snapshot'));
    this.config.set(await invoke<Config>('get_config'));
    this.statics.set((await invoke<StaticData | null>('get_static')) ?? null);
  }

  private applySnapshot(s: Snapshot): void {
    this.status.set(s.status);
    this.champSelect.set(s.champSelect);
    this.loading.set(s.loading);
    this.lastImport.set(s.lastImport);
    this.overlay.set(s.overlay);
    this.rec.set(s.rec);
    const p: Record<string, Profile> = {};
    for (const x of s.profiles) p[x.puuid] = x;
    this.profiles.set(p);
  }

  champName(id: number): string {
    return this.champById().get(id) ?? (id > 0 ? `#${id}` : '');
  }

  async saveConfig(config: Config): Promise<void> {
    if (this.demo) {
      this.config.set(config);
      return;
    }
    await invoke('save_config', { config });
    this.config.set(config);
  }

  async updateConfig(fn: (c: Config) => Config): Promise<void> {
    const c = this.config();
    if (!c) return;
    await this.saveConfig(fn(structuredClone(c)));
  }

  importRunesNow(): Promise<string> {
    if (this.demo) return Promise.resolve('Set "League Buddy: Ahri Mid" (OP.GG) · Flash + Ignite');
    return invoke<string>('import_runes_now');
  }

  async saveCurrentPageFor(championId: number): Promise<RunePage> {
    if (this.demo) throw 'Not connected (demo mode)';
    const page = await invoke<RunePage>('save_current_page_for', { championId });
    return page;
  }

  async previewOverlay(show: boolean): Promise<void> {
    this.overlayPreview.set(show);
    if (!this.demo) await invoke('preview_overlay', { show });
  }

  async setOverlayLocked(locked: boolean): Promise<void> {
    this.overlayLocked.set(locked);
    if (!this.demo) await invoke('set_overlay_locked', { locked });
  }

  listPatches(): Promise<PatchInfo[]> {
    if (this.demo) return Promise.resolve(demoPatchList());
    return invoke<PatchInfo[]>('list_patches');
  }

  getPatch(url: string): Promise<PatchNotes> {
    if (this.demo) return Promise.resolve(demoPatch(url));
    return invoke<PatchNotes>('get_patch', { url });
  }
}
