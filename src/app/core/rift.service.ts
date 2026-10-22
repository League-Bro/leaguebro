import { Injectable, computed, signal } from '@angular/core';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import {
  AbilityKeys,
  CacheInfo,
  CacheName,
  ChampSelectView,
  Config,
  ImportEvent,
  LoadingView,
  MyProfile,
  OverlayState,
  PatchInfo,
  PatchNotes,
  PostGame,
  Profile,
  RecState,
  Recommendation,
  Snapshot,
  StaticData,
  SwiftplaySlot,
  Status,
  TierList,
  TierSource,
} from './models';
import { championSplash, positionLabel } from './assets';
import {
  demoCacheInfo,
  demoChampSelect,
  demoConfig,
  demoPatch,
  demoPatchList,
  demoPostGame,
  demoProfile,
  demoRec,
  demoSnapshot,
  demoStatic,
  demoSwiftplay,
  demoTierList,
} from './demo';

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
  /** Your Swiftplay lobby slots (empty outside a Swiftplay lobby). */
  readonly swiftplay = signal<SwiftplaySlot[]>([]);
  readonly overlay = signal<OverlayState | null>(null);
  readonly rec = signal<RecState | null>(null);
  readonly postGame = signal<PostGame | null>(null);
  /** Game id of a summary the user closed. */
  readonly closedPostGame = signal<number | null>(null);
  /** Champions tab selection, kept across tab switches. */
  readonly championsPick = signal<{ championId: number; position: string; mode: 'ranked' | 'aram' } | null>(null);
  readonly championsGame = signal<'league' | 'classic'>('league');
  /** Tier List tab selection, kept across tab switches. */
  readonly tierPick = signal<{ source: TierSource; position: string; rank: string }>({
    source: 'lolalytics',
    position: 'middle',
    rank: 'emerald_plus',
  });
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
      if (new URLSearchParams(location.search).get('scene') === 'swiftplay') {
        snap.status.phase = 'Lobby';
        snap.loading = null;
        snap.overlay = null;
        snap.rec = null;
        snap.lastImport = null;
        snap.swiftplay = demoSwiftplay();
      }
      if (new URLSearchParams(location.search).get('scene') === 'postgame') {
        snap.status.phase = 'EndOfGame';
        snap.loading = null;
        snap.overlay = null;
        snap.rec = null;
        snap.postGame = demoPostGame();
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
      listen<SwiftplaySlot[]>('swiftplay', (e) => this.swiftplay.set(e.payload)),
      listen<OverlayState | null>('overlay', (e) => this.overlay.set(e.payload)),
      listen<RecState | null>('recommendation', (e) => this.rec.set(e.payload)),
      listen<PostGame | null>('post-game', (e) => this.postGame.set(e.payload)),
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
    this.swiftplay.set(s.swiftplay);
    this.overlay.set(s.overlay);
    this.rec.set(s.rec);
    this.postGame.set(s.postGame);
    const p: Record<string, Profile> = {};
    for (const x of s.profiles) p[x.puuid] = x;
    this.profiles.set(p);
  }

  /** The player's key for an ability ("Q" → "A" if they rebound it). */
  abilityKey(k: string): string {
    const keys = this.config()?.abilityKeys;
    return keys?.[k.toLowerCase() as keyof AbilityKeys] || k;
  }

  champName(id: number): string {
    return this.champById().get(id) ?? (id > 0 ? `#${id}` : '');
  }

  /** Base-skin splash art for hero cards; '' for League Classic copies and unknown ids. */
  champSplash(id: number): string {
    const c = this.statics()?.champions.find((x) => x.id === id);
    return c && !c.classic ? championSplash(c.alias) : '';
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
    if (this.demo) return Promise.resolve('Set "League Bro: Ahri Mid" (OP.GG) · Flash + Ignite · build added to the shop');
    return invoke<string>('import_runes_now');
  }

  /** Imports runes (and spells, if on) into every Swiftplay lobby slot with a champion. */
  importSwiftplayNow(): Promise<ImportEvent[]> {
    if (this.demo) {
      return Promise.resolve(
        this.swiftplay().filter((s) => s.championId).map((s) => ({
          ok: true,
          championId: s.championId,
          message: 'Swiftplay ' + positionLabel(s.position) + ' runes (OP.GG) · Flash + Ignite',
        })),
      );
    }
    return invoke<ImportEvent[]>('import_swiftplay_now');
  }

  /** OP.GG's recommendation for any champion (Champions tab). Position: top|jungle|middle|bottom|utility. */
  async lookupRec(championId: number, position: string, gameMode: 'ranked' | 'aram'): Promise<Recommendation> {
    if (this.demo) {
      await new Promise((r) => setTimeout(r, 300));
      const rec = demoRec().rec!;
      return { ...rec, championId, position, gameMode };
    }
    return invoke<Recommendation>('lookup_rec', { championId, position, gameMode });
  }

  async previewOverlay(show: boolean): Promise<void> {
    this.overlayPreview.set(show);
    if (!this.demo) await invoke('preview_overlay', { show });
  }

  async setOverlayLocked(locked: boolean): Promise<void> {
    this.overlayLocked.set(locked);
    if (!this.demo) await invoke('set_overlay_locked', { locked });
  }

  async getMyProfile(): Promise<MyProfile> {
    if (this.demo) {
      await new Promise((r) => setTimeout(r, 300));
      return demoProfile();
    }
    return invoke<MyProfile>('get_my_profile');
  }

  /** Full scoreboard of one of your past games. */
  async getMatch(gameId: number, queueName: string): Promise<PostGame> {
    if (this.demo) {
      await new Promise((r) => setTimeout(r, 300));
      return { ...demoPostGame(), gameId, queueName };
    }
    return invoke<PostGame>('get_match', { gameId, queueName });
  }

  listPatches(): Promise<PatchInfo[]> {
    if (this.demo) return Promise.resolve(demoPatchList());
    return invoke<PatchInfo[]>('list_patches');
  }

  getPatch(url: string): Promise<PatchNotes> {
    if (this.demo) return Promise.resolve(demoPatch(url));
    return invoke<PatchNotes>('get_patch', { url });
  }

  /** One lane's tier list. Position: top|jungle|middle|bottom|utility; rank is a filter like "emerald_plus" for either source. */
  async getTierList(source: TierSource, position: string, rank: string): Promise<TierList> {
    if (this.demo) {
      await new Promise((r) => setTimeout(r, 250));
      return demoTierList(source, position, rank);
    }
    return invoke<TierList>('get_tier_list', { source, position, rank });
  }

  private demoCache: CacheInfo = demoCacheInfo();

  cacheInfo(): Promise<CacheInfo> {
    if (this.demo) return Promise.resolve(structuredClone(this.demoCache));
    return invoke<CacheInfo>('cache_info');
  }

  /** Deletes one cache and returns what's left in both. */
  clearCache(which: CacheName): Promise<CacheInfo> {
    if (this.demo) {
      this.demoCache[which] = { files: 0, bytes: 0, inMemory: 0 };
      return this.cacheInfo();
    }
    return invoke<CacheInfo>('clear_cache', { which });
  }

  /** Opens a github.com/doliaro/leaguebro/issues link in the default browser. */
  async openIssuePage(url: string): Promise<void> {
    if (this.demo) {
      window.open(url, '_blank', 'noopener');
      return;
    }
    await invoke('open_issue_page', { url });
  }

  private lastButtonRect = '';
  setOverlayButton(rect: [number, number, number, number] | null): void {
    if (this.demo || this.windowLabel() !== 'overlay') return;
    const key = JSON.stringify(rect);
    if (key === this.lastButtonRect) return;
    this.lastButtonRect = key;
    invoke('set_overlay_button', { rect }).catch(() => (this.lastButtonRect = ''));
  }
}
