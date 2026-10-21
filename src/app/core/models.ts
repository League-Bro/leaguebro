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

export interface OverlayState {
  gameTime: number;
  gameMode: string;
  championName: string;
  gold: number;
  kills: number;
  deaths: number;
  assists: number;
  cs: number;
  timers: Timer[];
  nextItems: NextItem[];
  hasBuild: boolean;
}

export interface Snapshot {
  status: Status;
  champSelect: ChampSelectView | null;
  loading: LoadingView | null;
  profiles: Profile[];
  lastImport: ImportEvent | null;
  overlay: OverlayState | null;
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
  scoutInChampSelect: boolean;
  scoutOnLoading: boolean;
  overlayEnabled: boolean;
  overlayX: number | null;
  overlayY: number | null;
  overlayOpacity: number;
  timers: TimerConfig;
  installDir: string | null;
}
