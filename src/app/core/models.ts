// Shapes of the data sent by the Rust side (see src-tauri/src/engine.rs).

export interface Summoner {
  puuid: string;
  name: string;
}

export interface Status {
  connected: boolean;
  phase: string;
  summoner: Summoner | null;
  message: string;
}

export interface CsPlayer {
  cellId: number;
  championId: number;
  pickIntent: number;
  position: string;
  isMe: boolean;
  visible: boolean;
  name: string | null;
  puuid: string | null;
}

export interface ChampSelectView {
  queueId: number;
  myChampionId: number;
  myPosition: string;
  locked: boolean;
  allies: CsPlayer[];
  enemies: CsPlayer[];
  bans: number[];
  timerPhase: string;
}

export interface LoadPlayer {
  puuid: string | null;
  name: string | null;
  championId: number;
  position: string;
  isMe: boolean;
}

export interface LoadingView {
  gameId: number;
  queueName: string;
  allies: LoadPlayer[];
  enemies: LoadPlayer[];
}

export interface RankLine {
  tier: string;
  division: string;
  lp: number;
  wins: number;
  losses: number;
}

export interface GameLine {
  championId: number;
  win: boolean;
  kills: number;
  deaths: number;
  assists: number;
  queueId: number;
  created: number;
}

export interface ChampLine {
  championId: number;
  games: number;
  wins: number;
}

export interface Profile {
  puuid: string;
  solo: RankLine | null;
  flex: RankLine | null;
  recentGames: number;
  recentWins: number;
  avgKills: number;
  avgDeaths: number;
  avgAssists: number;
  topChamps: ChampLine[];
  lastGames: GameLine[];
  error: string | null;
}

export interface ImportEvent {
  ok: boolean;
  championId: number;
  message: string;
}

export interface Timer {
  key: string;
  label: string;
  spawnAt: number;
  side: 'ally' | 'enemy' | 'neutral';
}

export interface NextItem {
  id: number;
  name: string;
  price: number;
  affordable: boolean;
}

export interface RuneRec {
  primaryStyleId: number;
  subStyleId: number;
  perkIds: number[];
  keystoneName: string;
  primaryName: string;
  secondaryName: string;
  perkNames: string[];
  games: number;
  winRate: number;
  /** Share of the champion's games that used this page (0–1). */
  pickRate: number;
}

export interface ItemSet {
  ids: number[];
  names: string[];
  games: number;
  winRate: number;
  /** Share of the champion's games that bought this (0–1). */
  pickRate: number;
}

export interface PickStats {
  games: number;
  winRate: number;
  pickRate: number;
}

export interface Recommendation {
  championId: number;
  position: string;
  gameMode: string;
  runes: RuneRec | null;
  spells: number[];
  spellStats: PickStats | null;
  skillMax: string[];
  skillStats: PickStats | null;
  /** "AD", "AP" or "BOTH"; empty when OP.GG doesn't say. */
  damageType: string;
  skillOrder: string[];
  starter: ItemSet | null;
  boots: ItemSet | null;
  core: ItemSet | null;
  later: ItemSet[][];
  buildOrder: number[];
  games: number;
  source: string;
}

export interface RecState {
  championId: number;
  position: string;
  loading: boolean;
  rec: Recommendation | null;
  error: string | null;
}

export interface OverlayState {
  gameTime: number;
  gameMode: string;
  championName: string;
  gold: number;
  kills: number;
  deaths: number;
  assists: number;
  timers: Timer[];
  nextItems: NextItem[];
  hasBuild: boolean;
  buildSource: string;
  skillMax: string[];
  nextSkill: string | null;
}

export interface Snapshot {
  status: Status;
  champSelect: ChampSelectView | null;
  loading: LoadingView | null;
  profiles: Profile[];
  lastImport: ImportEvent | null;
  overlay: OverlayState | null;
  rec: RecState | null;
  postGame: PostGame | null;
}

export interface PostPlayer {
  puuid: string;
  /** Riot ID, or null for bots and hidden players. */
  name: string | null;
  isMe: boolean;
  championId: number;
  level: number;
  kills: number;
  deaths: number;
  assists: number;
  cs: number;
  gold: number;
  damage: number;
  vision: number;
  /** item0..item6; 0 = empty slot, the last one is the trinket. */
  items: number[];
  spells: [number, number];
}

export interface PostTeam {
  teamId: number;
  win: boolean;
  isMine: boolean;
  kills: number;
  gold: number;
  dragons: number;
  barons: number;
  towers: number;
  players: PostPlayer[];
}

export interface PostGame {
  gameId: number;
  queueId: number;
  queueName: string;
  gameMode: string;
  /** Seconds. */
  duration: number;
  result: 'win' | 'loss' | 'remake';
  /** Your team first. */
  teams: PostTeam[];
}

export interface ChampInfo {
  id: number;
  name: string;
  alias: string;
  /** Client roles, e.g. ["mage", "assassin"]. */
  roles: string[];
  /** A League Classic copy of a champion (id = 60000 + the normal id). */
  classic: boolean;
}

export interface ItemInfo {
  id: number;
  name: string;
  priceTotal: number;
  iconPath: string;
  /** Stat lines, e.g. ["100 Ability Power", "600 Mana"]. */
  stats: string[];
  /** Passive/active text, one line per paragraph. */
  desc: string;
  /** Client shop categories, e.g. ["SpellDamage", "Mana"]. */
  categories: string[];
}

export interface PerkInfo {
  id: number;
  name: string;
  iconPath: string;
  /** One-line summary (runes: shortDesc, spells: description). */
  desc: string;
  /** The client's short label for a rune, e.g. "Combo Damage". */
  tag: string;
}

export interface StaticData {
  champions: ChampInfo[];
  items: ItemInfo[];
  perks: PerkInfo[];
  styles: PerkInfo[];
  spells: PerkInfo[];
}

// Saved downloads (see cache_info / clear_cache in src-tauri/src/lib.rs).

export interface CacheUsage {
  files: number;
  bytes: number;
  /** Entries held in memory; more than `files` when saving to disk fails. */
  inMemory: number;
}

export interface CacheInfo {
  patchNotes: CacheUsage;
  /** OP.GG recommendations: rune pages, spells, skill order, builds. */
  runes: CacheUsage;
}

export type CacheName = keyof CacheInfo;

// Patch notes (see src-tauri/src/patch.rs).

export interface PatchInfo {
  version: string;
  title: string;
  url: string;
  published: string;
}

export type PatchEffect = 'buff' | 'nerf' | '';
export type PatchVerdict = 'buff' | 'nerf' | 'adjusted' | 'new' | 'removed' | '';

export interface ChangeLine {
  label: string;
  before: string;
  after: string;
  text: string;
  effect: PatchEffect;
}

export interface ChangeGroup {
  title: string;
  lines: ChangeLine[];
}

export interface PatchEntry {
  name: string;
  context: string;
  verdict: PatchVerdict;
  groups: ChangeGroup[];
}

export interface PatchSection {
  title: string;
  kind: 'champion' | 'item' | 'rune' | 'other';
  notes: string[];
  entries: PatchEntry[];
}

export interface PatchNotes {
  info: PatchInfo;
  sections: PatchSection[];
}

export interface RunePage {
  name: string;
  primaryStyleId: number;
  subStyleId: number;
  selectedPerkIds: number[];
}

export interface TimerConfig {
  firstDragon: number;
  firstBaron: number;
  dragonRespawn: number;
  elderRespawn: number;
  baronRespawn: number;
  inhibRespawn: number;
}

export interface Config {
  autoImportRunes: boolean;
  importOnHover: boolean;
  reuseCurrentPageWhenFull: boolean;
  runeOverrides: Record<string, RunePage>;
  builds: Record<string, number[]>;
  recSource: 'opgg' | 'client';
  setSummonerSpells: boolean;
  setItemSets: boolean;
  useRecommendedBuilds: boolean;
  showSkillHint: boolean;
  scoutInChampSelect: boolean;
  scoutOnLoading: boolean;
  overlayEnabled: boolean;
  overlayX: number | null;
  overlayY: number | null;
  overlayOpacity: number;
  timers: TimerConfig;
  installDir: string | null;
}
