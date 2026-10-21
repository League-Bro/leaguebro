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
}

export interface ItemSet {
  ids: number[];
  names: string[];
  games: number;
  winRate: number;
}

export interface Recommendation {
  championId: number;
  position: string;
  gameMode: string;
  runes: RuneRec | null;
  spells: number[];
  skillMax: string[];
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
}

export interface ItemInfo {
  id: number;
  name: string;
  priceTotal: number;
  iconPath: string;
}

export interface PerkInfo {
  id: number;
  name: string;
  iconPath: string;
}

export interface StaticData {
  champions: ChampInfo[];
  items: ItemInfo[];
  perks: PerkInfo[];
  styles: PerkInfo[];
  spells: PerkInfo[];
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
