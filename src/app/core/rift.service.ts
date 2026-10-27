import { Injectable, computed, signal } from '@angular/core';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { LogicalSize, PhysicalPosition, getCurrentWindow } from '@tauri-apps/api/window';
import {
  AbilityKeys,
  CacheInfo,
  CacheName,
  GlobalSets,
  Guide,
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
  RecChoice,
  RecState,
  Recommendation,
  Snapshot,
  SituationalState,
  StaticData,
  SwiftplaySlot,
  Status,
  TierList,
  TierSource,
  MIN_GAMES,
} from './models';
import { assetUrl, championSplash, positionLabel } from './assets';
import {
  demoCacheInfo,
  demoConfig,
  demoPatch,
  demoPatchList,
  demoPostGame,
  demoProfile,
  demoOpggProfile,
  demoMatchup,
  demoGuide,
  demoRec,
  demoWithChoice,
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
  /** Situational items for the current game (champ select picks, then the live scoreboard). */
  readonly situational = signal<SituationalState | null>(null);
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
  /** The Champions tab's view of the picked champion. */
  readonly championsView = signal<'build' | 'guide'>('build');
  /** Tier List tab selection, kept across tab switches. */
  readonly tierPick = signal<{ source: TierSource; position: string; rank: string }>({
    source: 'lolalytics',
    position: 'middle',
    rank: 'emerald_plus',
  });
  readonly overlayPreview = signal(false);
  readonly overlayLocked = signal(false);
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
      // ?profile=opgg / ?profile=setup: the Profile page without the League client.
      const profile = params.get('profile');
      if (profile === 'opgg' || profile === 'setup') snap.status = { ...snap.status, connected: false, phase: '', summoner: null, message: 'Waiting for the League client' };
      this.applySnapshot(snap);
      this.statics.set(demoStatic());
      this.config.set(profile === 'setup' ? { ...demoConfig(), riotId: null } : demoConfig());
      return;
    }
    this.windowLabel.set(getCurrentWindow().label);
    await Promise.all([
      listen<Status>('status', (e) => this.status.set(e.payload)),
      listen<ChampSelectView | null>('champ-select', (e) => this.champSelect.set(e.payload)),
      listen<LoadingView | null>('loading', (e) => this.loading.set(e.payload)),
      listen<Profile>('scout', (e) => this.profiles.update((p) => ({ ...p, [e.payload.puuid]: e.payload }))),
      listen('scout-cleared', () => this.profiles.set({})),
      listen<ImportEvent>('rune-import', (e) => this.lastImport.set(e.payload)),
      listen<SwiftplaySlot[]>('swiftplay', (e) => this.swiftplay.set(e.payload)),
      listen<OverlayState | null>('overlay', (e) => this.overlay.set(e.payload)),
      listen<RecState | null>('recommendation', (e) => this.rec.set(e.payload)),
      listen<PostGame | null>('post-game', (e) => this.postGame.set(e.payload)),
      listen<SituationalState | null>('situational', (e) => this.situational.set(e.payload)),
      listen<boolean>('overlay-preview', (e) => this.overlayPreview.set(e.payload)),
      listen<boolean>('overlay-locked', (e) => this.overlayLocked.set(e.payload)),
      listen<Config>('config', (e) => this.config.set(e.payload)),
      listen<StaticData>('static', (e) => this.statics.set(e.payload)),
    ]);
    const [snapshot, config, statics] = await Promise.all([
      invoke<Snapshot>('get_snapshot'),
      invoke<Config>('get_config'),
      invoke<StaticData | null>('get_static'),
    ]);
    this.applySnapshot(snapshot);
    this.config.set(config);
    this.statics.set(statics ?? null);
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
    this.situational.set(s.situational);
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
    const url = id > 0 ? assetUrl(this.itemById().get(id)?.iconPath) : '';
    return this.brokenIcons().has(url) ? '' : url;
  }

  itemName(id: number): string {
    return this.itemById().get(id)?.name ?? '';
  }

  /** Icon URLs CommunityDragon didn't have, so `itemIcon` can fall back to the item's name. */
  private readonly brokenIcons = signal(new Set<string>());

  /** For an icon's (error) handler: hides an image CommunityDragon doesn't have. */
  hideImg(e: Event): void {
    const img = e.target as HTMLImageElement;
    img.style.display = 'none';
    const src = img.getAttribute('src');
    if (src && !this.brokenIcons().has(src)) this.brokenIcons.update((s) => new Set(s).add(src));
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
  /** Picks a different rune page, spells or build for champ select's champion; imported right away there. */
  chooseRecOption(choice: RecChoice): Promise<string> {
    return this.call(
      'choose_rec_option',
      { choice },
      () => {
        const s = this.rec();
        const vs = choice.matchup ? s?.matchup?.matchup?.rec : null;
        const base = vs && vs.games >= MIN_GAMES ? vs : demoRec(false).rec!;
        if (s?.rec) this.rec.set({ ...s, choice, rec: demoWithChoice(base, choice) });
        return 'Set "League Bro: Ahri Mid" (OP.GG) · Flash + Ignite · build added to the shop';
      },
      300,
    );
  }

  /** Sets your lane opponent (an enemy champion id; 0 = none) instead of the guess. */
  chooseLaneOpponent(championId: number): Promise<void> {
    return this.call('choose_lane_opponent', { championId }, () => {
      const s = this.rec();
      if (!s) return;
      const matchup = championId ? demoMatchup(championId, false) : { ...demoMatchup(), opponentId: 0, guessed: false, matchup: null, myRecord: null };
      const choice = { runes: 0, spells: 0, core: 0, boots: 0 };
      this.rec.set({ ...s, matchup, choice, rec: demoRec(false).rec });
    }, 300);
  }

  /** A looked-up recommendation with picks in place (the Champions tab; nothing is imported). */
  recWithChoice(rec: Recommendation, choice: RecChoice): Promise<Recommendation> {
    return this.call('rec_with_choice', { rec, choice }, () => demoWithChoice(rec, choice));
  }

  lookupRec(championId: number, position: string, gameMode: 'ranked' | 'aram'): Promise<Recommendation> {
    return this.call('lookup_rec', { championId, position, gameMode }, () => ({ ...demoRec().rec!, championId, position, gameMode }), 300);
  }

  /** A beginner's guide: abilities with Riot's clips, difficulty, tips. */
  championGuide(championId: number): Promise<Guide> {
    return this.call('champion_guide', { championId }, () => demoGuide(championId, this.champName(championId)), 300);
  }

  /** Opens a YouTube search for the champion's beginner guides in the default browser. */
  async openGuideVideos(champion: string): Promise<void> {
    const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(`${champion} beginner guide league of legends`)}`;
    await this.call('open_guide_videos', { champion }, () => void window.open(url, '_blank', 'noopener'));
  }

  async previewOverlay(show: boolean): Promise<void> {
    this.overlayPreview.set(show);
    await this.call('preview_overlay', { show }, () => undefined);
  }

  async setOverlayLocked(locked: boolean): Promise<void> {
    this.overlayLocked.set(locked);
    await this.call('set_overlay_locked', { locked }, () => undefined);
  }

  /** From the League client while it's running, else from OP.GG by the Riot ID in settings. */
  getMyProfile(): Promise<MyProfile> {
    // Browser demo: ?profile=opgg shows the OP.GG version, ?profile=setup the Riot ID form.
    const opgg = this.demo && ['opgg', 'setup'].includes(new URLSearchParams(location.search).get('profile') ?? '');
    return this.call('get_my_profile', {}, opgg ? demoOpggProfile : demoProfile, 300);
  }

  /** OP.GG's "Update": has it fetch your latest games and rank, then loads the profile again. `updatedAt` is the shown profile's. */
  renewProfile(updatedAt: number | null): Promise<MyProfile> {
    return this.call('renew_profile', { updatedAt }, () => ({ ...demoOpggProfile(), updatedAt: Date.now(), renewableAt: Date.now() + 120_000 }), 1500);
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

  private demoGlobal: GlobalSets = { found: ['Blitz: Bruiser Sylas', 'Blitz: AP Sylas'], moved: [] };

  /** Other apps' item sets that show in the shop for every champion. */
  globalItemSets(): Promise<GlobalSets> {
    return this.call('global_item_sets', {}, () => structuredClone(this.demoGlobal));
  }
  moveGlobalItemSets(): Promise<GlobalSets> {
    return this.call('move_global_item_sets', {}, () => {
      this.demoGlobal = { found: [], moved: [...this.demoGlobal.moved, ...this.demoGlobal.found] };
      return structuredClone(this.demoGlobal);
    });
  }
  restoreGlobalItemSets(): Promise<GlobalSets> {
    return this.call('restore_global_item_sets', {}, () => {
      this.demoGlobal = { found: [...this.demoGlobal.found, ...this.demoGlobal.moved], moved: [] };
      return structuredClone(this.demoGlobal);
    });
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

  private lastButtonRects = '';
  /** Where the overlay's buttons are (padlock, "show more"), so they stay clickable while locked. */
  setOverlayButtons(rects: [number, number, number, number][]): void {
    if (this.demo || this.windowLabel() !== 'overlay') return;
    const key = JSON.stringify(rects);
    if (key === this.lastButtonRects) return;
    this.lastButtonRects = key;
    invoke('set_overlay_buttons', { rects }).catch(() => (this.lastButtonRects = ''));
  }

  private lastOverlaySize = [0, 0];
  private fitting: Promise<void> = Promise.resolve();
  /**
   * Sizes the overlay window to its contents (CSS px), so nothing is cut off at the bottom.
   * With "grow upward" on, it also moves up or down by the change so the bottom edge stays put.
   */
  fitOverlay(width: number, height: number): void {
    if (this.demo || this.windowLabel() !== 'overlay') return;
    const [w, h] = [Math.ceil(width), Math.ceil(height)];
    if (w <= 0 || h <= 0 || (w === this.lastOverlaySize[0] && h === this.lastOverlaySize[1])) return;
    this.lastOverlaySize = [w, h];
    const growUp = !!this.config()?.overlayGrowUp;
    // One at a time, so a quick second resize measures the window after the first.
    this.fitting = this.fitting
      .then(async () => {
        const win = getCurrentWindow();
        if (!growUp) return win.setSize(new LogicalSize(w, h));
        const [pos, before] = await Promise.all([win.outerPosition(), win.outerSize()]);
        await win.setSize(new LogicalSize(w, h));
        const after = await win.outerSize();
        if (after.height !== before.height) {
          await win.setPosition(new PhysicalPosition(pos.x, pos.y + before.height - after.height));
        }
      })
      .catch(() => {
        this.lastOverlaySize = [0, 0];
      });
  }
}
