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
import { assetUrl, championSplash, positionLabel } from './assets';
import {
  demoCacheInfo,
  demoConfig,
  demoPatch,
  demoPatchList,
  demoPostGame,
  demoProfile,
  demoRec,
  demoScene,
  demoStatic,
  demoTierList,
} from './demo';

export function inTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

@Injectable({ providedIn: 'root' })
export class RiftService {
  readonly status = signal<Status>({ connected: false, phase: '', summoner: null, message: 'Starting…', windowMode: null });
  /** League is set to Fullscreen, which covers the overlay window. */
  readonly fullscreenHint = computed(
    () => this.status().connected && this.status().windowMode === 'fullscreen' && (this.config()?.overlayEnabled ?? true),
  );
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
      const params = new URLSearchParams(location.search);
      this.windowLabel.set(params.get('window') ?? 'main');
      const snap = demoScene(params.get('scene'));
      // ?fullscreen previews the "switch League to Borderless" hint.
      if (params.has('fullscreen')) snap.status.windowMode = 'fullscreen';
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

  itemIcon(id: number): string {
    return id > 0 ? assetUrl(this.itemById().get(id)?.iconPath) : '';
  }

  itemName(id: number): string {
    return this.itemById().get(id)?.name ?? '';
  }

  /** For an icon's (error) handler: hides an image CommunityDragon doesn't have. */
  hideImg(e: Event): void {
    (e.target as HTMLElement).style.display = 'none';
  }

  /** Runs a backend command, or `demo` in the browser demo (after `delayMs`, like a real lookup). */
  private async call<T>(cmd: string, args: Record<string, unknown>, demo: () => T, delayMs = 0): Promise<T> {
    if (!this.demo) return invoke<T>(cmd, args);
    if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
    return demo();
  }

  async saveConfig(config: Config): Promise<void> {
    await this.call('save_config', { config }, () => undefined);
    this.config.set(config);
  }

  async updateConfig(fn: (c: Config) => Config): Promise<void> {
    const c = this.config();
    if (!c) return;
    await this.saveConfig(fn(structuredClone(c)));
  }

  importRunesNow(): Promise<string> {
    return this.call('import_runes_now', {}, () => 'Set "League Bro: Ahri Mid" (OP.GG) · Flash + Ignite · build added to the shop');
  }

  /** Imports runes (and spells, if on) into every Swiftplay lobby slot with a champion. */
  importSwiftplayNow(): Promise<ImportEvent[]> {
    return this.call('import_swiftplay_now', {}, () =>
      this.swiftplay()
        .filter((s) => s.championId)
        .map((s) => ({ ok: true, championId: s.championId, message: `Swiftplay ${positionLabel(s.position)} runes (OP.GG) · Flash + Ignite` })),
    );
  }

  /** OP.GG's recommendation for any champion (Champions tab). Position: top|jungle|middle|bottom|utility. */
  lookupRec(championId: number, position: string, gameMode: 'ranked' | 'aram'): Promise<Recommendation> {
    return this.call('lookup_rec', { championId, position, gameMode }, () => ({ ...demoRec().rec!, championId, position, gameMode }), 300);
  }

  async previewOverlay(show: boolean): Promise<void> {
    this.overlayPreview.set(show);
    await this.call('preview_overlay', { show }, () => undefined);
  }

  async setOverlayLocked(locked: boolean): Promise<void> {
    this.overlayLocked.set(locked);
    await this.call('set_overlay_locked', { locked }, () => undefined);
  }

  getMyProfile(): Promise<MyProfile> {
    return this.call('get_my_profile', {}, demoProfile, 300);
  }

  /** Full scoreboard of one of your past games. */
  getMatch(gameId: number, queueName: string): Promise<PostGame> {
    return this.call('get_match', { gameId, queueName }, () => ({ ...demoPostGame(), gameId, queueName }), 300);
  }

  listPatches(): Promise<PatchInfo[]> {
    return this.call('list_patches', {}, demoPatchList);
  }

  getPatch(url: string): Promise<PatchNotes> {
    return this.call('get_patch', { url }, () => demoPatch(url));
  }

  /** One lane's tier list. Position: top|jungle|middle|bottom|utility; rank is a filter like "emerald_plus" for either source. */
  getTierList(source: TierSource, position: string, rank: string): Promise<TierList> {
    return this.call('get_tier_list', { source, position, rank }, () => demoTierList(source, position, rank), 250);
  }

  private demoCache: CacheInfo = demoCacheInfo();

  cacheInfo(): Promise<CacheInfo> {
    return this.call('cache_info', {}, () => structuredClone(this.demoCache));
  }

  /** Deletes one cache and returns what's left in both. */
  clearCache(which: CacheName): Promise<CacheInfo> {
    return this.call('clear_cache', { which }, () => {
      this.demoCache[which] = { files: 0, bytes: 0, inMemory: 0 };
      return structuredClone(this.demoCache);
    });
  }

  /** Opens a github.com/doliaro/leaguebro/issues link in the default browser. */
  async openIssuePage(url: string): Promise<void> {
    await this.call('open_issue_page', { url }, () => void window.open(url, '_blank', 'noopener'));
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
