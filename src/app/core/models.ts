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
  /** League's game window mode, from its settings; null until read. Fullscreen hides the overlay. */
  windowMode: 'fullscreen' | 'windowed' | 'borderless' | null;
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

/** A rank at one time, for the LP graph. */
export interface LpPoint {
  /** Unix ms. */
  at: number;
  tier: string;
  division: string;
  lp: number;
  /** Wins + losses then; null for OP.GG's points. */
  games: number | null;
}

/** Oldest first. Saved by League Bro on each profile load and after each game, plus OP.GG's Solo/Duo points. */
export interface LpHistory {
  solo: LpPoint[];
  flex: LpPoint[];
}

/** One of your past games (custom, Brawl and League Classic games are left out). */
export interface MatchLine {
  gameId: number;
  queueId: number;
  gameMode: string;
  /** Unix ms. */
  created: number;
  /** Seconds. */
  duration: number;
  result: 'win' | 'loss' | 'remake';
  championId: number;
  /** Champion level at the end of the game. */
  level: number;
  kills: number;
  deaths: number;
  assists: number;
  cs: number;
  gold: number;
  damage: number;
  vision: number;
  /** item0..item6; the last one is the trinket. */
  items: number[];
  spells: [number, number];
  /** The enemy in your position, when the client's lane data makes that clear (Summoner's Rift only). */
  laneOpponent: number | null;
  /** Enemy champion ids; empty if the game's full record didn't load. */
  enemies: number[];
}

/** Games and your wins/KDA with a champion, or against one. */
export interface ChampStat {
  championId: number;
  games: number;
  wins: number;
  kills: number;
  deaths: number;
  assists: number;
}

export interface QueueStat {
  queueId: number;
  games: number;
  wins: number;
}

/** Totals over counted games (remakes left out). */
export interface Insights {
  games: number;
  wins: number;
  kills: number;
  deaths: number;
  assists: number;
  csPerMin: number;
  damagePerMin: number;
  goldPerMin: number;
  visionPerGame: number;
  /** Positive = win streak, negative = loss streak. */
  streak: number;
  champions: ChampStat[];
  queues: QueueStat[];
  /** Lane opponents you've lost to more often than beaten (2+ games), worst 5 first. */
  toughestLanes: ChampStat[];
  /** The same for any enemy champion. */
  toughestEnemies: ChampStat[];
}

export interface ModeInsights {
  queueId: number;
  insights: Insights;
}

export interface MyProfile {
  puuid: string;
  name: string;
  iconId: number;
  level: number;
  solo: RankLine | null;
  flex: RankLine | null;
  /** Newest first. */
  matches: MatchLine[];
  /** All queues together. */
  insights: Insights;
  /** Per queue, most played first. */
  modes: ModeInsights[];
  /** The queue of the lobby, champ select or game you're in. */
  currentQueueId: number | null;
  error: string | null;
  /** 'client' = the League client's match history; 'opgg' = looked up by Riot ID while it isn't running. */
  source: 'client' | 'opgg';
  /** When OP.GG last fetched this player from Riot (unix ms; OP.GG only). */
  updatedAt: number | null;
  /** When OP.GG next allows an update (unix ms; OP.GG only). */
  renewableAt: number | null;
  lpHistory: LpHistory;
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

/** A Swiftplay lobby slot: the champion picked for one of your two positions. */
export interface SwiftplaySlot {
  championId: number;
  /** Lowercase client position, e.g. "utility". */
  position: string;
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

export interface StarterItem {
  id: number;
  name: string;
  count: number;
  price: number;
}

export interface NextItem {
  id: number;
  name: string;
  price: number;
  affordable: boolean;
  /** What's left to buy toward it, in recipe order; only on the first item. */
  components?: NextItem[];
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
  /** Every 4th–6th item option with enough games, most played first: what situational picks rank. */
  situationalPool: ItemSet[];
  buildOrder: number[];
  games: number;
  source: string;
  /** Alternatives to pick from, most played first (index 0 = the default). */
  runeOptions: RuneRec[];
  spellOptions: SpellOption[];
  coreOptions: ItemSet[];
  bootsOptions: ItemSet[];
}

export interface SpellOption {
  ids: number[];
  games: number;
  winRate: number;
  pickRate: number;
}

/** OP.GG pages with fewer games than this are noise (same as opgg::MIN_GAMES in Rust). */
export const MIN_GAMES = 20;

/** Which option is picked in each section (index into the `*Options` lists). */
export interface RecChoice {
  runes: number;
  spells: number;
  core: number;
  boots: number;
  /** Use OP.GG's build against the lane opponent (champ select only). */
  matchup?: boolean;
}

/** OP.GG's lane guide for a matchup. Sides are "you", "them", "even" or "". */
export interface MatchupTip {
  text: string;
  laneAdvantage: string;
  soloKills: string;
  /** "aggressive", "even" or "defensive". */
  playStyle: string;
}

export interface Matchup {
  championId: number;
  opponentId: number;
  position: string;
  /** Head-to-head on OP.GG (0 games when it has none). */
  games: number;
  winRate: number;
  /** OP.GG's runes, spells and build in this matchup only. */
  rec: Recommendation | null;
  tip: MatchupTip | null;
  opponentDamageType: string;
}

export interface MatchupState {
  /** 0 = no lane opponent (none guessed or picked yet). */
  opponentId: number;
  guessed: boolean;
  loading: boolean;
  matchup: Matchup | null;
  error: string | null;
  /** Your recent games against them in lane. */
  myRecord: ChampStat | null;
}

export interface RecState {
  championId: number;
  position: string;
  loading: boolean;
  /** With the picked options already in place. */
  rec: Recommendation | null;
  error: string | null;
  choice: RecChoice;
  matchup?: MatchupState | null;
}

/** Total cost of the items each of you holds (the game doesn't share enemy gold). */
export interface LaneDiff {
  opponent: string;
  /** For the icon; 0 if it couldn't be matched. */
  championId?: number;
  mine: number;
  theirs: number;
}

export interface TeamDiff {
  ours: number;
  theirs: number;
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
  /** Everything left of the recommended build, in purchase order (owned items drop off). */
  /** Recommended starting items, until bought or ~2:30 in. */
  starter?: StarterItem[];
  nextItems: NextItem[];
  hasBuild: boolean;
  skillMax: string[];
  nextSkill: string | null;
  /** Your item value vs your lane opponent's; null without roles (ARAM etc.). */
  lane: LaneDiff | null;
  /** Your team's item value against the enemy team's. */
  team?: TeamDiff | null;
  /** Champion ids on each team, bots included, for the Live tab's damage bars. */
  allyChampions?: number[];
  enemyChampions?: number[];
  /** Situational items for this game, best first (empty when off in Settings). */
  situational: SituationalPick[];
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
  swiftplay: SwiftplaySlot[];
  situational: SituationalState | null;
}

/** What an item is good against (`situational.rs`). */
export type SituationTag =
  | 'antiHeal'
  | 'armorPen'
  | 'magicPen'
  | 'antiShield'
  | 'antiTank'
  | 'armor'
  | 'magicResist'
  | 'survive'
  | 'cleanse';

/** One kind of threat on the enemy team, e.g. healing. */
export interface Threat {
  tag: SituationTag;
  /** Short name for a chip, e.g. "Anti-heal". */
  label: string;
  /** Roughly 1 = worth answering, 2+ = a lot of it. */
  level: number;
  /** Who it comes from, e.g. "Healing from Soraka and Draven (Bloodthirster)". */
  detail: string;
}

export interface SituationalItem {
  id: number;
  name: string;
  tag: SituationTag;
  label: string;
  /** Why, naming the enemies. */
  reason: string;
  score: number;
  /** You own a component that builds into it. */
  started: boolean;
  /** Not one of OP.GG's options for your champion (anti-heal fallback). */
  offPool: boolean;
  games: number;
  winRate: number;
}

/** A situational item on the overlay, with what's left to pay for it. */
export interface SituationalPick extends SituationalItem {
  price: number;
  affordable: boolean;
}

/** Situational items for the current game: champ select picks, then the live scoreboard. */
export interface SituationalState {
  championId: number;
  live: boolean;
  threats: Threat[];
  items: SituationalItem[];
}

export interface PostPlayer {
  puuid: string;
  /** Riot ID, or null for bots and hidden players. */
  name: string | null;
  isMe: boolean;
  /** Null outside a 5v5 on Summoner's Rift or when it's unclear. */
  position: 'top' | 'jungle' | 'mid' | 'adc' | 'support' | null;
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
  /** The same text split into passives and actives (the item tooltip). */
  effects: ItemEffect[];
  /** Client shop categories, e.g. ["SpellDamage", "Mana"]. */
  categories: string[];
  /** Items this one builds into. */
  into: number[];
  /** Items this one is built from. */
  from: number[];
  /** What it's good against, e.g. ["antiHeal"]. */
  situations: SituationTag[];
}

export interface ItemEffect {
  /** '' for text that isn't under a Passive/Active heading. */
  kind: 'passive' | 'active' | '';
  name: string;
  text: string;
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

/** Item sets other apps put in League's Config\Global\Recommended (shown for every champion). */
export interface GlobalSets {
  /** Titles currently shown for every champion. */
  found: string[];
  /** Titles League Bro moved aside earlier. */
  moved: string[];
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

export interface TimerConfig {
  firstDragon: number;
  firstBaron: number;
  dragonRespawn: number;
  elderRespawn: number;
  baronRespawn: number;
  inhibRespawn: number;
}

export interface AbilityKeys {
  q: string;
  w: string;
  e: string;
  r: string;
}

export interface Config {
  autoImportRunes: boolean;
  importOnHover: boolean;
  keepMyPagesWhenFull: boolean;
  recSource: 'opgg' | 'client';
  setSummonerSpells: boolean;
  setItemSets: boolean;
  useRecommendedBuilds: boolean;
  showSkillHint: boolean;
  /** Objective timers on the overlay (the Live tab always shows them). */
  showTimers: boolean;
  /** Item value vs your lane opponent on the overlay. */
  showLaneDiff: boolean;
  /** The top situational item (and a "more" list) on the overlay. */
  showSituational: boolean;
  /** The player's ability keybinds, shown in place of Q/W/E/R. */
  abilityKeys: AbilityKeys;
  scoutInChampSelect: boolean;
  scoutOnLoading: boolean;
  /** The trash-talk card ("The Bro's review") in post-game summaries. */
  showRoasts: boolean;
  /** One anonymous "app open" ping a day (random install ID + app version). */
  shareUsageStats: boolean;
  overlayEnabled: boolean;
  overlayX: number | null;
  overlayY: number | null;
  overlayOpacity: number;
  /** Overlay width in CSS pixels; the height follows the content. */
  overlayWidth: number;
  /** Overlay zoom, 1 = normal. */
  overlayScale: number;
  timers: TimerConfig;
  /** Champion ids starred in the Champions tab, pinned to the top of its list. */
  favoriteChampions: number[];
  installDir: string | null;
  /** Your Riot ID ("Name#TAG") for the Profile page while the client isn't running. */
  riotId: string | null;
  /** OP.GG region code for riotId ("na", "euw"…). */
  region: string;
}

/** Where a tier list comes from (tierlist.rs `Source`). */
export type TierSource = 'lolalytics' | 'opgg';

export interface TierEntry {
  championId: number;
  name: string;
  /** The row it goes in. */
  tier: 'S' | 'A' | 'B' | 'C' | 'D';
  /** The source's own label: "S+" … "D-" (Lolalytics) or "OP", "1" … "5" (OP.GG). */
  label: string;
  rank: number;
  /** Places moved up (negative = down) since the source's previous ranking. */
  rankChange: number | null;
  /** Percentages. */
  winRate: number;
  pickRate: number;
  banRate: number;
  games: number;
}

export interface TierList {
  source: TierSource;
  /** top | jungle | middle | bottom | utility */
  position: string;
  /** Rank filter, e.g. "emerald_plus". */
  rank: string;
  /** e.g. "16.21" (OP.GG only; Lolalytics uses the current patch but doesn't say which). */
  patch: string | null;
  gamesAnalysed: number | null;
  fetchedAt: number;
  entries: TierEntry[];
}

/** A beginner's guide to a champion (`champion_guide`, the Champions tab's Guide view). */
export interface Guide {
  championId: number;
  name: string;
  title: string;
  bio: string;
  /** Riot's 1 (easy) to 3 (hard); 0 when unknown. */
  difficulty: number;
  /** "AD", "AP", "BOTH" or "". */
  damageType: string;
  /** "melee" or "ranged". */
  attackType: string;
  roles: string[];
  /** The client's 0–3 ratings. */
  playstyle: { damage: number; durability: number; crowdControl: number; mobility: number; utility: number };
  /** Passive first, then Q, W, E, R. */
  abilities: GuideAbility[];
  tips: string[];
  counterTips: string[];
}

export interface GuideAbility {
  /** "P", "Q", "W", "E" or "R". */
  key: string;
  name: string;
  description: string;
  /** Client asset path. */
  icon: string;
  /** Riot's preview clip and its poster image (full URLs). */
  video: string | null;
  poster: string | null;
}
