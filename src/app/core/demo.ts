// Sample data used when the UI runs in a plain browser (`npm start`)
// instead of inside the Tauri app, so the layout can be worked on
// without League running.
import {
  CacheInfo,
  ChampSelectView,
  PickSuggestions,
  ChampStat,
  Guide,
  GuideAbility,
  GoldPoint,
  Config,
  Insights,
  ItemEffect,
  ItemInfo,
  GamePlayer,
  MatchLine,
  MatchupState,
  LpChange,
  LpPoint,
  MyProfile,
  PlayerRef,
  QueueStat,
  PatchInfo,
  PatchNotes,
  PostGame,
  PostPlayer,
  Profile,
  RecChoice,
  RecState,
  Recommendation,
  RuneRec,
  Snapshot,
  SpellOption,
  StaticData,
  SwiftplaySlot,
  SituationalState,
  SituationTag,
  TierEntry,
  TierList,
  TierSource,
} from './models';

const champs: [number, string][] = [
  [103, 'Ahri'], [64, 'Lee Sin'], [222, 'Jinx'], [412, 'Thresh'], [122, 'Darius'],
  [238, 'Zed'], [254, 'Vi'], [157, 'Yasuo'], [99, 'Lux'], [145, "Kai'Sa"],
  [516, 'Ornn'], [89, 'Leona'], [555, 'Pyke'], [1, 'Annie'], [84, 'Akali'],
  [7, 'LeBlanc'], [91, 'Talon'], [134, 'Syndra'],
  [90, 'Malzahar'], [127, 'Lissandra'], [711, 'Vex'], [3, 'Galio'], [10, 'Kayle'], [80, 'Pantheon'], [61, 'Orianna'],
];

function profile(puuid: string, tier: string, div: string, lp: number, w: number, l: number, main: number[]): Profile {
  const games = Array.from({ length: 10 }, (_, i) => ({
    championId: main[i % main.length],
    win: (i * 7 + lp) % 3 !== 0,
    kills: 3 + ((i * 5) % 9),
    deaths: 2 + ((i * 3) % 6),
    assists: 4 + ((i * 7) % 10),
    queueId: 420,
    created: Date.now() - i * 3_600_000,
  }));
  const wins = games.filter((g) => g.win).length;
  return {
    puuid,
    solo: tier ? { tier, division: div, lp, wins: w, losses: l } : null,
    flex: null,
    recentGames: games.length,
    recentWins: wins,
    avgKills: games.reduce((a, g) => a + g.kills, 0) / games.length,
    avgDeaths: games.reduce((a, g) => a + g.deaths, 0) / games.length,
    avgAssists: games.reduce((a, g) => a + g.assists, 0) / games.length,
    topChamps: main.slice(0, 3).map((c, i) => ({ championId: c, games: 6 - i * 2, wins: 4 - i })),
    lastGames: games,
    error: null,
  };
}

export function demoSnapshot(): Snapshot {
  return {
    status: { connected: true, phase: 'InProgress', summoner: { puuid: 'me', name: 'Dom#NA1' }, message: '', windowMode: 'borderless' },
    champSelect: null,
    loading: {
      gameId: 1,
      queueName: 'Ranked Solo/Duo',
      allies: [
        { puuid: 'a1', name: 'TreeHugger#NA1', championId: 516, position: 'TOP', isMe: false },
        { puuid: 'a2', name: 'Gank Plank#0001', championId: 64, position: 'JUNGLE', isMe: false },
        { puuid: 'me', name: 'Dom#NA1', championId: 103, position: 'MIDDLE', isMe: true },
        { puuid: 'a4', name: 'Cannon Minion#7777', championId: 222, position: 'BOTTOM', isMe: false },
        { puuid: null, name: null, championId: 412, position: 'UTILITY', isMe: false },
      ],
      enemies: [
        { puuid: 'e1', name: 'Noxian Pride#EUW', championId: 122, position: 'TOP', isMe: false },
        { puuid: 'e2', name: 'Punch First#NA1', championId: 254, position: 'JUNGLE', isMe: false },
        { puuid: 'e3', name: 'Shadow Step#ZED', championId: 238, position: 'MIDDLE', isMe: false },
        { puuid: 'e4', name: 'Void Hunter#NA1', championId: 145, position: 'BOTTOM', isMe: false },
        { puuid: 'e5', name: 'Hook City#NA1', championId: 555, position: 'UTILITY', isMe: false },
      ],
    },
    profiles: [
      profile('a1', 'GOLD', 'I', 64, 48, 41, [516, 122]),
      profile('a2', 'PLATINUM', 'IV', 12, 70, 66, [64, 254, 157]),
      profile('a4', 'GOLD', 'III', 0, 22, 25, [222, 145]),
      profile('e1', 'EMERALD', 'IV', 33, 101, 90, [122]),
      profile('e2', 'PLATINUM', 'II', 77, 55, 47, [254, 64]),
      profile('e3', 'GOLD', 'II', 20, 12, 9, [238, 84, 157]),
      profile('e4', '', '', 0, 0, 0, [145, 222]),
      profile('e5', 'SILVER', 'I', 91, 30, 37, [555, 412]),
    ],
    lastImport: { ok: true, championId: 103, message: 'Set "League Bro: Ahri Mid" (OP.GG) · Flash + Ignite · build added to the shop' },
    overlay: {
      gameTime: 742,
      gameMode: 'CLASSIC',
      championName: 'Ahri',
      gold: 1310,
      kills: 3,
      deaths: 1,
      assists: 5,
      cs: 90,
      timers: [
        { key: 'dragon', label: 'Dragon', spawnAt: 860, side: 'neutral' },
        { key: 'baron', label: 'Baron', spawnAt: 1200, side: 'neutral' },
        { key: 'inhib', label: 'Enemy Mid inhib', spawnAt: 1012, side: 'enemy' },
      ],
      nextItems: [
        {
          id: 4645, name: 'Shadowflame', price: 3200, affordable: false,
          components: [
            { id: 3145, name: 'Hextech Alternator', price: 1100, affordable: true },
            { id: 1058, name: 'Needlessly Large Rod', price: 1200, affordable: true },
          ],
        },
        { id: 3157, name: "Zhonya's Hourglass", price: 3250, affordable: false },
        { id: 3089, name: "Rabadon's Deathcap", price: 3600, affordable: false },
        { id: 3135, name: 'Void Staff', price: 3000, affordable: false },
      ],
      buyNow: [
        { id: 1058, name: 'Needlessly Large Rod', count: 1, price: 1200 },
      ],
      hasBuild: true,
      skillMax: ['Q', 'W', 'E'],
      nextSkill: 'Q',
      skillLevels: [4, 2, 1, 1],
      lane: {
        opponent: 'Zed', championId: 238, mine: 5350, theirs: 3967,
        foes: [
          { opponent: 'Darius', championId: 122, position: 'TOP', theirs: 4875 },
          { opponent: 'Vi', championId: 254, position: 'JUNGLE', theirs: 4100 },
          { opponent: 'Zed', championId: 238, position: 'MIDDLE', theirs: 3967 },
          { opponent: "Kai'Sa", championId: 145, position: 'BOTTOM', theirs: 6200 },
          { opponent: 'Pyke', championId: 555, position: 'UTILITY', theirs: 3500 },
        ],
      },
      team: { ours: 21400, theirs: 22650 },
      allyChampions: [516, 64, 103, 222, 412],
      enemyChampions: [122, 254, 238, 145, 555],
      // Priced like the engine does; Void Staff's Blasting Wand is owned.
      situational: demoSituational(true).items.map((it) => {
        const price = { 3102: 3000, 3135: 2150, 3165: 2950 }[it.id] ?? 0;
        return { ...it, price, affordable: price > 0 && price <= 1310 };
      }),
    },
    rec: demoRec(),
    postGame: null,
    swiftplay: [],
    situational: demoSituational(true),
  };
}

/** The demo snapshot for `?scene=` (champselect, pick, swiftplay, bots, postgame, postgame-bad, early-back, idle, queue, offline); in game otherwise. */
export function demoScene(scene: string | null): Snapshot {
  const snap = demoSnapshot();
  const away = { loading: null, overlay: null };
  switch (scene) {
    case 'pick': {
      // Still picking: the pick suggestions show at the top.
      const cs = demoChampSelect();
      const allies = cs.allies.map((p) => (p.isMe ? { ...p, championId: 0, pickIntent: 103 } : p));
      return { ...snap, ...away, status: { ...snap.status, phase: 'ChampSelect' }, rec: null, lastImport: null,
        champSelect: { ...cs, locked: false, myChampionId: 103, allies, enemies: cs.enemies.map((e, i) => (i === 2 ? { ...e, championId: 254 } : e)) },
        situational: demoSituational(false) };
    }
    case 'champselect':
      return { ...snap, ...away, status: { ...snap.status, phase: 'ChampSelect' }, champSelect: demoChampSelect(), situational: demoSituational(false) };
    case 'idle':
    case 'queue':
      // Nothing on the Live tab: the radar, saying what it's waiting on.
      return { ...snap, ...away, status: { ...snap.status, phase: scene === 'queue' ? 'Matchmaking' : 'None' }, rec: null, lastImport: null };
    case 'offline':
      return { ...snap, ...away, status: { ...snap.status, connected: false, phase: 'None', summoner: null }, rec: null, lastImport: null };
    case 'swiftplay':
      return { ...snap, ...away, status: { ...snap.status, phase: 'Lobby' }, rec: null, lastImport: null, swiftplay: demoSwiftplay() };
    case 'bots':
      // A custom game: the loading screen list only has you; the rest come from the scoreboard (friends by name, bots as "Bot").
      return {
        ...snap,
        loading: snap.loading && { ...snap.loading, allies: snap.loading.allies.filter((p) => p.isMe), enemies: [] },
        overlay: snap.overlay && {
          ...snap.overlay,
          playerNames: { 516: 'hubcus#NA1', 64: 'urbanfox#8108', 222: 'Jinxed#EUW', 412: 'hookcity#NA1' },
          bots: snap.overlay.enemyChampions ?? [],
        },
      };
    case 'postgame':
    case 'postgame-bad':
      return { ...snap, ...away, status: { ...snap.status, phase: 'EndOfGame' }, rec: null, postGame: demoPostGame(scene === 'postgame-bad') };
    case 'early-back':
      // Back at level 3 with 530 gold: no Pickaxe or Noonquiver yet, so the overlay says what does fit.
      return {
        ...snap,
        overlay: {
          ...snap.overlay!,
          gameTime: 266,
          gold: 530,
          cs: 30,
          nextItems: [
            {
              id: 6673, name: 'Immortal Shieldbow', price: 3000, affordable: false,
              components: [
                { id: 1037, name: 'Pickaxe', price: 875, affordable: false },
                { id: 6670, name: 'Noonquiver', price: 1300, affordable: false },
              ],
            },
            { id: 3006, name: "Berserker's Greaves", price: 1100, affordable: false },
          ],
          buyNow: [
            { id: 1036, name: 'Long Sword', count: 1, price: 350 },
          ],
        },
      };
    default:
      return snap;
  }
}

/**
 * Ahri's situational items: in champ select from the enemy picks (Darius, Zed),
 * in game from the scoreboard (Zed ahead, Darius and Vi building sustain and Magic Resist).
 */
export function demoSituational(live: boolean): SituationalState {
  const banshee = { id: 3102, name: "Banshee's Veil", tag: 'survive' as const, label: 'Survive burst', started: false, offPool: false, games: 210, winRate: 112 / 210 };
  if (!live) {
    return {
      championId: 103,
      live: false,
      threats: [{ tag: 'survive', label: 'Survive burst', level: 0.8, detail: 'Burst from Zed' }],
      items: [{ ...banshee, reason: 'Burst from Zed', score: 1.1 }],
    };
  }
  return {
    championId: 103,
    live: true,
    threats: [
      { tag: 'survive', label: 'Survive burst', level: 2.2, detail: 'Burst from Zed (assassin, 7/2)' },
      { tag: 'magicPen', label: 'Magic pen', level: 1.4, detail: 'Magic Resist on Vi (55 Magic Resist from items) and Darius (40 Magic Resist from items)' },
      { tag: 'antiHeal', label: 'Anti-heal', level: 1.2, detail: 'Healing from Darius (Ravenous Hydra) and Vi (Sundered Sky)' },
    ],
    items: [
      { ...banshee, reason: 'Burst from Zed (assassin, 7/2)', score: 2.5 },
      {
        id: 3135, name: 'Void Staff', tag: 'magicPen', label: 'Magic pen', score: 1.8, started: true, offPool: false, games: 247, winRate: 138 / 247,
        reason: 'Magic Resist on Vi (55 Magic Resist from items) and Darius (40 Magic Resist from items)',
      },
      {
        id: 3165, name: 'Morellonomicon', tag: 'antiHeal', label: 'Anti-heal', score: 1.3, started: false, offPool: false, games: 120, winRate: 61 / 120,
        reason: 'Healing from Darius (Ravenous Hydra) and Vi (Sundered Sky)',
      },
    ],
  };
}

/** A Swiftplay lobby with a champion picked for both positions. */
export function demoSwiftplay(): SwiftplaySlot[] {
  const choice = { runes: 0, spells: 0, core: 0, boots: 0 };
  return [
    { championId: 103, position: 'middle', choice },
    { championId: 64, position: 'jungle', choice },
  ];
}

export function demoProfile(): MyProfile {
  const rows: [number, number, MatchLine['result'], number, number, number, number, number, number | null][] = [
    // queue, champion, result, K, D, A, CS, minutes, lane opponent
    [420, 103, 'win', 11, 2, 9, 226, 31, 91], [420, 103, 'win', 7, 3, 8, 201, 28, 238], [420, 238, 'loss', 4, 7, 3, 174, 33, 238],
    [400, 103, 'win', 9, 4, 11, 189, 27, 91], [480, 157, 'remake', 0, 0, 0, 8, 3, null], [420, 103, 'loss', 3, 5, 6, 198, 30, 238],
    [420, 238, 'win', 13, 4, 5, 211, 29, 7], [480, 157, 'win', 8, 6, 4, 176, 22, 238], [400, 99, 'loss', 2, 6, 14, 41, 34, 555],
    [420, 103, 'win', 6, 1, 10, 233, 26, 134], [450, 84, 'win', 14, 9, 22, 61, 19, null], [420, 238, 'loss', 5, 8, 2, 162, 32, 7],
  ];
  const builds: Record<number, number[]> = { 103: [3118, 3020, 4645, 3157], 238: [3020, 3135], 157: [3020, 1058], 99: [3089], 84: [3157, 3020] };
  // Pyke (555) shows up in most of the losses.
  const pool = [122, 64, 222, 412, 254, 516, 145, 89];
  const enemies = (i: number, lane: number | null): number[] => {
    const rest = [0, 1, 2, 3, 4].map((k) => pool[(i + k) % pool.length]);
    if ([0, 2, 5, 11].includes(i)) rest[0] = 555;
    return (lane ? [lane, ...rest] : rest).slice(0, 5);
  };
  const names = ['Hubcus#NA1', 'Big Hub#777', 'Tylor#NA1', 'xX Midkid Xx#0420', 'Wardbot#NA1', 'Gank Plank#0001', 'Sleepy Jg#EUW', 'pyke main#hook',
    'Lil Baron#NA1', 'Smolder Fan#NA1', 'TiltProof#NA1', 'Shy Support#123', 'Flash on D#NA1', 'Mr Farm#NA1'];
  const player = (championId: number, k: number) => ({ championId, name: names[k % names.length], puuid: `demo-${k % names.length}`, isMe: false });
  const teams = (i: number, championId: number, foes: number[], result: MatchLine['result']): GamePlayer[][] => {
    if (result === 'remake') return [];
    const mine = [86, 64, 0, 51, 412].map((c, k) => (k === 2 ? { championId, name: 'Dom#NA1', puuid: 'me', isMe: true } : player(c, i + k)));
    return [mine, foes.map((c, k) => player(c, i * 3 + k + 5))];
  };
  const matches: MatchLine[] = rows.map(([queueId, championId, result, kills, deaths, assists, cs, min, lane], i) => ({
    gameId: 1000 + i, queueId, gameMode: queueId === 450 ? 'ARAM' : queueId === 480 ? 'SWIFTPLAY' : 'CLASSIC',
    created: Date.now() - (i * 5 + 1) * 3_600_000, duration: min * 60, result, championId, kills, deaths, assists, cs,
    gold: min * 420, damage: min * 850 + kills * 600, vision: Math.round(min * 0.8), level: Math.min(18, 6 + Math.round(min / 3)),
    items: [...(builds[championId] ?? []), 0, 0, 0, 0, 0, 0].slice(0, 6).concat(3340), spells: [4, 14],
    laneOpponent: lane, enemies: enemies(i, lane), teams: teams(i, championId, enemies(i, lane), result), lpChange: demoLpChange(i, queueId, result),
  }));
  const queueIds = [...new Set(matches.map((m) => m.queueId))];
  const modes = queueIds
    .map((queueId) => ({ queueId, insights: demoInsights(matches.filter((m) => m.queueId === queueId)) }))
    .sort((a, b) => b.insights.games - a.insights.games);
  return {
    puuid: 'me', name: 'Dom#NA1', iconId: 938, level: 214,
    solo: { tier: 'GOLD', division: 'II', lp: 47, wins: 38, losses: 31 }, flex: null,
    matches, insights: demoInsights(matches), modes, currentQueueId: 420, error: null,
    source: 'client', updatedAt: null, renewableAt: null,
    lpHistory: { solo: demoLpHistory(), flex: [] },
  };
}

/** Someone else's profile: the demo profile under their name, with no LP tracked. */
export function demoPlayerProfile(who: PlayerRef): MyProfile {
  const p = demoProfile();
  return {
    ...p, puuid: who.puuid ?? 'demo-player', name: who.riotId ?? 'Gank Plank#0001', iconId: 4568, level: 87, currentQueueId: null,
    solo: { tier: 'PLATINUM', division: 'III', lp: 12, wins: 51, losses: 44 },
    matches: p.matches.map((m) => ({ ...m, lpChange: null })), lpHistory: { solo: [], flex: [] },
  };
}

/** Silver I up to Gold I, then back down to where the demo profile is (Gold II 47 LP). */
function demoLpHistory(): LpPoint[] {
  const steps: [string, string, number][] = [
    ['SILVER', 'I', 62], ['SILVER', 'I', 81], ['SILVER', 'I', 64], ['GOLD', 'IV', 0], ['GOLD', 'IV', 21], ['GOLD', 'IV', 43],
    ['GOLD', 'IV', 66], ['GOLD', 'III', 4], ['GOLD', 'III', 27], ['GOLD', 'III', 49], ['GOLD', 'III', 72], ['GOLD', 'II', 12],
    ['GOLD', 'II', 35], ['GOLD', 'II', 58], ['GOLD', 'II', 79], ['GOLD', 'I', 3], ['GOLD', 'II', 84], ['GOLD', 'II', 65], ['GOLD', 'II', 47],
  ];
  // ?lp=N: only the last N points (0 and 1 show the division meter); past 19, a longer made-up climb before them.
  const n = Number(new URLSearchParams(location.search).get('lp') ?? steps.length);
  while (steps.length < n) {
    const [tier, division, lp] = steps[0];
    const score = ['IV', 'III', 'II', 'I'].indexOf(division) * 100 + lp - (steps.length % 3 === 0 ? -17 : 21);
    const t = score < 0 ? 'BRONZE' : tier;
    const s = (score + 400) % 400;
    steps.unshift([t, ['IV', 'III', 'II', 'I'][Math.floor(s / 100)], s % 100]);
  }
  const shown = steps.slice(steps.length - Math.max(0, n));
  return shown.map(([tier, division, lp], i) => ({ at: Date.now() - (shown.length - i) * 20 * 3_600_000, tier, division, lp, games: 50 + i }));
}

/** The profile as OP.GG has it (?profile=opgg): last updated two days ago, no enemy data or vision. */
export function demoOpggProfile(): MyProfile {
  const p = demoProfile();
  const matches = p.matches.slice(2).map((m) => ({
    ...m, created: m.created - 2 * 86_400_000, vision: 0, laneOpponent: null, enemies: [], teams: [],
    queueId: m.queueId === 400 ? 0 : m.queueId, gameMode: m.queueId === 400 ? 'NORMAL' : m.gameMode,
  }));
  const queueIds = [...new Set(matches.map((m) => m.queueId))];
  const modes = queueIds
    .map((queueId) => ({ queueId, insights: demoInsights(matches.filter((m) => m.queueId === queueId)) }))
    .sort((a, b) => b.insights.games - a.insights.games);
  return {
    ...p, matches, insights: demoInsights(matches), modes, currentQueueId: null,
    solo: { tier: 'GOLD', division: 'II', lp: 21, wins: 36, losses: 31 },
    // One point so far: shows the graph's "fills in as you play" state.
    lpHistory: { solo: [{ at: Date.now() - 2 * 86_400_000, tier: 'GOLD', division: 'II', lp: 21, games: null }], flex: [] },
    source: 'opgg', updatedAt: Date.now() - 2 * 86_400_000, renewableAt: Date.now() - 60_000,
  };
}

function demoToughest(stats: Map<number, ChampStat>): ChampStat[] {
  const net = (c: ChampStat) => c.games - 2 * c.wins;
  return [...stats.values()].filter((c) => c.games >= 2 && net(c) > 0).sort((a, b) => net(b) - net(a) || b.games - a.games).slice(0, 5);
}

function demoInsights(matches: MatchLine[]): Insights {
  const counted = matches.filter((m) => m.result !== 'remake');
  const sum = (f: (m: MatchLine) => number) => counted.reduce((a, m) => a + f(m), 0);
  const minutes = sum((m) => m.duration / 60) || 1;
  const champs = new Map<number, ChampStat>();
  const queues = new Map<number, QueueStat>();
  const lanes = new Map<number, ChampStat>();
  const enemies = new Map<number, ChampStat>();
  const add = (stats: Map<number, ChampStat>, championId: number, m: MatchLine) => {
    const c = stats.get(championId) ?? { championId, games: 0, wins: 0, kills: 0, deaths: 0, assists: 0 };
    const win = m.result === 'win' ? 1 : 0;
    stats.set(championId, { ...c, games: c.games + 1, wins: c.wins + win, kills: c.kills + m.kills, deaths: c.deaths + m.deaths, assists: c.assists + m.assists });
  };
  for (const m of counted) {
    const win = m.result === 'win' ? 1 : 0;
    add(champs, m.championId, m);
    if (m.laneOpponent) add(lanes, m.laneOpponent, m);
    for (const e of m.enemies) add(enemies, e, m);
    const q = queues.get(m.queueId) ?? { queueId: m.queueId, games: 0, wins: 0 };
    queues.set(m.queueId, { ...q, games: q.games + 1, wins: q.wins + win });
  }
  const first = counted[0]?.result;
  const streakLen = counted.findIndex((m) => m.result !== first);
  const len = streakLen < 0 ? counted.length : streakLen;
  return {
    games: counted.length, wins: counted.filter((m) => m.result === 'win').length,
    kills: sum((m) => m.kills), deaths: sum((m) => m.deaths), assists: sum((m) => m.assists),
    csPerMin: sum((m) => m.cs) / minutes, damagePerMin: sum((m) => m.damage) / minutes, goldPerMin: sum((m) => m.gold) / minutes,
    visionPerGame: sum((m) => m.vision) / (counted.length || 1),
    streak: first === 'win' ? len : -len,
    champions: [...champs.values()].sort((a, b) => b.games - a.games || b.wins - a.wins),
    queues: [...queues.values()].sort((a, b) => b.games - a.games),
    toughestLanes: demoToughest(lanes),
    toughestEnemies: demoToughest(enemies),
  };
}

/** A made-up per-minute gold lead for a finished game, ending on `final`. */
function demoGoldLead(duration: number, final: number): GoldPoint[] {
  const points: GoldPoint[] = [];
  const lead = (t: number) => final * (t / duration) ** 1.6 - Math.sin((Math.PI * t) / (duration * 0.6)) * 1800 * Math.sign(final);
  for (let t = 0; t < duration; t += 60) points.push({ t, lead: Math.round(lead(t)) });
  points.push({ t: duration, lead: final });
  return points;
}

/** The post-game summary demo: a good game, or with `bad`, one worth roasting. */
export function demoPostGame(bad = false): PostGame {
  const lanes = ['top', 'jungle', 'mid', 'adc', 'support'] as const;
  const p = (
    puuid: string, name: string | null, championId: number, k: number, d: number, a: number,
    cs: number, gold: number, damage: number, vision: number, items: number[], isMe = false,
  ): PostPlayer => ({
    puuid, name, isMe, position: null, championId, level: 13 + ((k + a) % 5), kills: k, deaths: d, assists: a, cs, gold, damage, vision,
    items: [...items, 0, 0, 0, 0, 0, 0].slice(0, 6).concat(3340), spells: [4, 14],
  });
  const me = bad
    ? p('me', 'Dom#NA1', 103, 2, 11, 3, 128, 8400, 9100, 41, [3118, 3020, 1058], true)
    : p('me', 'Dom#NA1', 103, 11, 2, 9, 226, 14650, 32400, 22, [3118, 3020, 4645, 3157, 1058], true);
  const [mineKills, theirKills] = bad ? [22, 31] : [31, 20];
  const mine = [
    p('a1', 'TreeHugger#NA1', 516, 2, 4, 9, 198, 10900, 14200, 18, [3020, 1058]),
    p('a2', 'Gank Plank#0001', 64, 7, 5, 12, 41, 11800, 17600, 39, [3135]),
    me,
    p('a4', 'Cannon Minion#7777', 222, 10, 3, 8, 245, 14100, 29800, 14, [3089, 3020]),
    p('', null, 412, 1, 6, 21, 33, 9750, 6100, 71, [2003]),
  ];
  const theirs = [
    p('e1', 'Noxian Pride#EUW', 122, 6, 7, 3, 201, 11200, 21900, 12, [3020]),
    p('e2', 'Punch First#NA1', 254, 4, 8, 8, 52, 9900, 15300, 33, []),
    p('e3', 'Shadow Step#ZED', 238, 7, 6, 4, 188, 11000, 23700, 17, [1058]),
    p('e4', 'Void Hunter#NA1', 145, 3, 6, 6, 214, 11400, 19800, 11, [3135]),
    p('e5', 'Hook City#NA1', 555, 0, 4, 11, 29, 8800, 7400, 58, [2003]),
  ];
  // Team gold is the players' gold added up, and the lead graph ends on the difference, like the real summary.
  const gold = (ps: PostPlayer[]) => ps.reduce((a, x) => a + x.gold, 0);
  for (const team of [mine, theirs]) team.forEach((x, i) => (x.position = lanes[i]));
  return {
    gameId: bad ? 2 : 1,
    queueId: 420,
    queueName: 'Ranked Solo/Duo',
    gameMode: 'CLASSIC',
    duration: 1834,
    result: bad ? 'loss' : 'win',
    goldLead: demoGoldLead(1834, gold(mine) - gold(theirs)),
    lpChange: bad ? { delta: -19, tier: 'GOLD', division: 'II', lp: 47, moved: '' } : { delta: 22, tier: 'GOLD', division: 'I', lp: 3, moved: 'up' },
    teams: [
      {
        teamId: 100, win: !bad, isMine: true, kills: mineKills, gold: gold(mine), dragons: 3, barons: 1, towers: 9,
        players: mine,
      },
      {
        teamId: 200, win: bad, isMine: false, kills: theirKills, gold: gold(theirs), dragons: 1, barons: 0, towers: 3,
        players: theirs,
      },
    ],
  };
}

const roles: Record<number, string[]> = {
  103: ['mage', 'assassin'], 64: ['fighter', 'assassin'], 222: ['marksman'], 412: ['support', 'tank'],
  122: ['fighter', 'tank'], 238: ['assassin'], 254: ['fighter', 'assassin'], 157: ['fighter', 'assassin'],
  99: ['mage', 'support'], 145: ['marksman'], 516: ['tank', 'fighter'], 89: ['tank', 'support'],
  555: ['support', 'assassin'], 1: ['mage', 'support'], 84: ['assassin'],
};

function demoItem(
  id: number, name: string, priceTotal: number, file: string, stats: string[], desc: string, categories: string[], situations: SituationTag[] = [],
): ItemInfo {
  // Demo descriptions alternate heading and text lines, like the client's tooltips.
  const lines = desc ? desc.split('\n') : [];
  const effects: ItemEffect[] = [];
  for (let i = 0; i < lines.length; i += 2) {
    effects.push({ kind: categories.includes('Active') && i === 0 ? 'active' : 'passive', name: lines[i], text: lines[i + 1] ?? '' });
  }
  const from = demoFrom[id] ?? [];
  const into = Object.entries(demoFrom).filter(([, f]) => f.includes(id)).map(([k]) => Number(k));
  return { id, name, priceTotal, iconPath: `/lol-game-data/assets/ASSETS/Items/Icons2D/${file}`, stats, desc, effects, categories, into, from, situations };
}

const demoFrom: Record<number, number[]> = {
  6655: [1058], 3089: [1058, 1058], 3157: [1058], 4645: [1058], 3135: [1058], 3102: [1058], 3100: [1058],
};

export function demoStatic(): StaticData {
  return {
    champions: [
      ...champs.map(([id, name]) => ({ id, name, alias: name.replace(/[^A-Za-z]/g, ''), roles: roles[id] ?? [], classic: false })),
      // League Classic copies, as the client lists them (id + 60000, alias Jade_…).
      ...champs
        .filter(([id]) => [1, 64, 84, 89, 99, 103].includes(id))
        .map(([id, name]) => ({ id: 60000 + id, name, alias: `Jade_${name.replace(/[^A-Za-z]/g, '')}`, roles: roles[id] ?? [], classic: true })),
    ],
    items: [
      demoItem(3020, "Sorcerer's Shoes", 1100, '3020_Class_T2_SorcerersShoes.png', ['12 Magic Penetration', '45 Move Speed'], '', ['Boots', 'MagicPenetration']),
      demoItem(6655, "Luden's Companion", 2850, '6655_Mage_T4_LudensTempest.png', ['100 Ability Power', '600 Mana', '10 Ability Haste'], 'Echo\nDamaging abilities fire bonus magic damage at the target and nearby enemies.', ['SpellDamage', 'Mana', 'AbilityHaste']),
      demoItem(1058, 'Needlessly Large Rod', 1200, '1058_Mage_T1_LargeRod.png', ['60 Ability Power'], '', ['SpellDamage']),
      demoItem(3089, "Rabadon's Deathcap", 3600, '3089_Mage_T3_Deathcap.png', ['130 Ability Power'], 'Magical Opus\nIncreases your total Ability Power.', ['SpellDamage']),
      demoItem(3157, "Zhonya's Hourglass", 3250, '3157_Mage_T3_ZhonyasHourglass.png', ['105 Ability Power', '50 Armor'], 'Time Stop\nBecome invulnerable and untargetable for a short time, but unable to act.', ['SpellDamage', 'Armor', 'Active'], ['armor', 'survive']),
      demoItem(3118, 'Malignance', 2700, '3118_Malignance.png', ['80 Ability Power', '600 Mana', '25 Ability Haste'], 'Scorn\nGain Ultimate Ability Haste.\nHatefog\nYour ultimate burns the ground and lowers Magic Resist of enemies inside.', ['SpellDamage', 'Mana', 'AbilityHaste']),
      demoItem(4645, 'Shadowflame', 3200, '4645_Shadowflame.png', ['110 Ability Power', '15 Magic Penetration'], 'Cinderbloom\nMagic and true damage crit against low health enemies.', ['SpellDamage', 'MagicPenetration']),
      demoItem(3135, 'Void Staff', 3000, '3135_Mage_T3_VoidStaff.png', ['95 Ability Power', '40% Magic Penetration'], '', ['SpellDamage', 'MagicPenetration'], ['magicPen']),
      demoItem(3102, "Banshee's Veil", 3000, '3102_Mage_T3_BansheesVeil.png', ['105 Ability Power', '40 Magic Resist'], 'Annul\nGrants a Spell Shield that blocks the next enemy ability.', ['SpellDamage', 'SpellBlock'], ['magicResist', 'survive']),
      demoItem(3165, 'Morellonomicon', 2950, '3165_Mage_T3_Morellonomicon.png', ['75 Ability Power', '350 Health'], 'Affliction\nDealing magic damage applies 40% Grievous Wounds to enemy champions.', ['SpellDamage', 'Health'], ['antiHeal']),
      demoItem(3100, 'Lich Bane', 3200, '3100_Mage_T3_Lichbane.png', ['100 Ability Power', '10% Move Speed'], 'Spellblade\nYour next attack after using an ability deals bonus magic damage.', ['SpellDamage', 'NonbootsMovement']),
      demoItem(3158, 'Ionian Boots of Lucidity', 900, '3158_Class_T2_IonianBootsofLucidity.png', ['10 Ability Haste', '45 Move Speed'], '', ['Boots', 'AbilityHaste']),
      demoItem(3111, "Mercury's Treads", 1250, '3111_Class_T2_MercurysTreads.png', ['20 Magic Resist', '45 Move Speed', '30% Tenacity'], '', ['Boots', 'SpellBlock', 'Tenacity']),
      demoItem(1056, "Doran's Ring", 400, '1056_Mage_T1_DoransRing.png', ['18 Ability Power', '90 Health'], 'Focus\nAttacks deal bonus damage to minions.\nDrain\nRestore mana over time.', ['Health', 'SpellDamage', 'ManaRegen', 'Lane']),
      demoItem(3340, 'Stealth Ward', 0, '3340_Class_T1_WardingTotem.png', [], 'Place an invisible ward that reveals the surrounding area.', ['Trinket', 'Active', 'Vision']),
      demoItem(2003, 'Health Potion', 50, '2003_Class_T1_HealthPotion.png', [], 'Click to consume: restore health over 15 seconds.', ['Consumable', 'HealthRegen', 'Active']),
    ],
    perks: [
      [8112, 'Electrocute', 'Domination/Electrocute/Electrocute.png', 'Hitting a champion with 3 separate attacks or abilities in 3s deals bonus adaptive damage.', 'Combo Damage',
        'Hitting a champion with 3 separate attacks or abilities within 3s deals bonus adaptive damage.\nDamage: 30 - 220 (+0.1 bonus AD, +0.05 AP)\nCooldown: 25 - 20s'],
      [8139, 'Taste of Blood', 'Domination/TasteOfBlood/GreenTerror_TasteOfBlood.png', 'Heal when you damage an enemy champion.', 'Healing'],
      [8140, 'Grisly Mementos', 'Domination/GrislyMementos/GrislyMementos.png', 'Gain Ability Haste for each champion takedown.', 'Ability Haste'],
      [8106, 'Ultimate Hunter', 'Domination/UltimateHunter/UltimateHunter.png', 'Your ultimate gains haste for each unique champion takedown.', 'Ultimate Cooldown'],
      [8210, 'Transcendence', 'Sorcery/Transcendence/Transcendence.png', 'Gain Ability Haste at levels 5 and 8; takedowns refund basic ability cooldowns at level 11.', 'Ability Haste'],
      [8226, 'Manaflow Band', 'Sorcery/ManaflowBand/ManaflowBand.png', 'Hitting champions with abilities permanently increases maximum mana.', 'Mana'],
      [8229, 'Arcane Comet', 'Sorcery/ArcaneComet/ArcaneComet.png', 'Damaging a champion with an ability hurls a comet at their location.', 'Poke'],
      [8237, 'Scorch', 'Sorcery/Scorch/Scorch.png', 'Your next ability hit sets champions on fire, dealing bonus magic damage after 1s.', 'Poke'],
      [8135, 'Treasure Hunter', 'Domination/TreasureHunter/TreasureHunter.png', 'Gain gold for each unique champion takedown.', 'Gold'],
      [9111, 'Triumph', 'Precision/Triumph.png', 'Takedowns restore health and grant extra gold.', 'Healing'],
      [8014, 'Coup de Grace', 'Precision/CoupDeGrace/CoupDeGrace.png', 'Deal more damage to low health champions.', 'Damage'],
      [5005, 'Attack Speed', 'StatMods/StatModsAttackSpeedIcon.png', '+10% Attack Speed', ''],
      [5008, 'Adaptive Force', 'StatMods/StatModsAdaptiveForceIcon.png', '+9 Adaptive Force', ''],
      [5001, 'Health Scaling', 'StatMods/StatModsHealthPlusIcon.png', '+10-180 Health (based on level)', ''],
    ].map(([id, name, path, desc, tag, long]) => ({
      longDesc: long as string | undefined,
      id: id as number, name: name as string, iconPath: `/lol-game-data/assets/v1/perk-images/${(path as string).startsWith('StatMods/') ? '' : 'Styles/'}${path}`, desc: desc as string, tag: tag as string,
    })),
    spells: [
      { id: 4, name: 'Flash', iconPath: '/lol-game-data/assets/DATA/Spells/Icons2D/Summoner_flash.png', desc: 'Teleports your champion a short distance toward your cursor.', tag: '' },
      { id: 12, name: 'Teleport', iconPath: '/lol-game-data/assets/DATA/Spells/Icons2D/Summoner_Teleport_New.png', desc: 'After channeling, teleports your champion to a target allied structure.', tag: '' },
      { id: 3, name: 'Exhaust', iconPath: '/lol-game-data/assets/DATA/Spells/Icons2D/Summoner_exhaust.png', desc: 'Slows an enemy champion and reduces their damage dealt.', tag: '' },
      { id: 14, name: 'Ignite', iconPath: '/lol-game-data/assets/DATA/Spells/Icons2D/SummonerIgnite.png', desc: 'Ignites a target enemy champion, dealing true damage over 5 seconds and reducing healing.', tag: '' },
    ],
    styles: (
      [
        [8000, 'Precision', '7201_Precision.png', [[8005, 8008, 8021, 8010], [9101, 9111, 8009], [9104, 9105, 9103], [8014, 8017, 8299]]],
        [8100, 'Domination', '7200_Domination.png', [[8112, 8128, 9923], [8126, 8139, 8143], [8137, 8140, 8141], [8135, 8105, 8106]]],
        [8200, 'Sorcery', '7202_Sorcery.png', [[8214, 8229, 8230], [8224, 8226, 8275], [8210, 8234, 8233], [8237, 8232, 8236]]],
        [8400, 'Resolve', '7204_Resolve.png', [[8437, 8439, 8465], [8446, 8463, 8401], [8429, 8444, 8473], [8451, 8453, 8242]]],
        [8300, 'Inspiration', '7203_Whimsy.png', [[8351, 8360, 8369], [8306, 8304, 8321], [8313, 8352, 8345], [8347, 8410, 8316]]],
      ] as [number, string, string, number[][]][]
    ).map(([id, name, icon, rows]) => ({
      id, name, iconPath: `/lol-game-data/assets/v1/perk-images/Styles/${icon}`, desc: '', tag: '',
      // The shard rows are the same in every tree.
      slots: [
        ...rows.map((perks, i) => ({ kind: i ? ('regular' as const) : ('keystone' as const), perks })),
        { kind: 'shard' as const, perks: [5008, 5005, 5007] },
        { kind: 'shard' as const, perks: [5008, 5010, 5001] },
        { kind: 'shard' as const, perks: [5011, 5013, 5001] },
      ],
      subStyles: [8000, 8100, 8200, 8300, 8400].filter((s) => s !== id),
    })),
  };
}

export function demoConfig(): Config {
  return {
    autoImportRunes: true,
    importOnHover: false,
    keepMyPagesWhenFull: false,
    recSource: 'opgg',
    setSummonerSpells: true,
    setItemSets: true,
    useRecommendedBuilds: true,
    showSkillHint: true,
    showTimers: true,
    showLaneDiff: true,
    showSituational: true,
    showTeamDiff: true,
    showCs: true,
    showBuyNow: true,
    abilityKeys: { q: 'Q', w: 'W', e: 'E', r: 'R' },
    scoutInChampSelect: true,
    scoutOnLoading: true,
    showRoasts: true,
    shareUsageStats: true,
    overlayEnabled: true,
    overlayX: null,
    overlayY: null,
    overlayBottom: null,
    overlayGrowUp: false,
    overlayOpacity: 0.9,
    overlayWidth: 340,
    overlayScale: 1,
    timers: { firstDragon: 300, firstBaron: 1200, dragonRespawn: 300, elderRespawn: 360, baronRespawn: 360, inhibRespawn: 300 },
    favoriteChampions: [103, 222],
    installDir: null,
    riotId: 'Dom#NA1',
    region: 'na',
  };
}

export function demoChampSelect(): ChampSelectView {
  const hidden = (cellId: number, pos: string, champ = 0) => ({
    cellId, championId: champ, pickIntent: 0, position: pos, isMe: false, visible: false, name: null, puuid: null,
  });
  return {
    queueId: 420,
    myChampionId: 103,
    myPosition: 'middle',
    locked: true,
    allies: [
      hidden(0, 'top', 516),
      { cellId: 1, championId: 0, pickIntent: 64, position: 'jungle', isMe: false, visible: true, name: 'Gank Plank#0001', puuid: 'a2' },
      { cellId: 2, championId: 103, pickIntent: 0, position: 'middle', isMe: true, visible: true, name: 'Dom#NA1', puuid: 'me' },
      hidden(3, 'bottom'),
      hidden(4, 'utility'),
    ],
    enemies: [5, 6, 7, 8, 9].map((c, i) => ({ ...hidden(c, ''), championId: [122, 238, 0, 0, 0][i] })),
    bans: [157, 555, 84, 99],
    timerPhase: 'BAN_PICK',
  };
}

/**
 * Real OP.GG answer for Ahri mid (website API, October 2026), as League Bro
 * shows it. Like that API it has no names; the UI takes them from the client's data.
 */
export function demoRec(withMatchup = true): RecState {
  const total = 12836;
  const set = (ids: number[], games: number, wins: number) => ({ ids, names: [], games, winRate: wins / games, pickRate: games / total });
  return {
    championId: 103,
    position: 'mid',
    loading: false,
    error: null,
    rec: {
      championId: 103,
      position: 'mid',
      gameMode: 'ranked',
      runes: {
        primaryStyleId: 8100,
        subStyleId: 8200,
        perkIds: [8112, 8139, 8140, 8106, 8210, 8226, 5005, 5008, 5001],
        keystoneName: '',
        primaryName: '',
        secondaryName: '',
        perkNames: [],
        games: 9482,
        winRate: 4833 / 9482,
        pickRate: 0.7386,
      },
      spells: [4, 14],
      spellStats: { games: 8890, winRate: 4576 / 8890, pickRate: 0.6925 },
      skillMax: ['Q', 'W', 'E'],
      skillStats: { games: 7944, winRate: 4646 / 7944, pickRate: 0.9184 },
      damageType: 'AP',
      skillOrder: ['W', 'Q', 'E', 'Q', 'Q', 'R', 'Q', 'W', 'Q', 'W', 'R', 'W', 'W', 'E', 'E'],
      starter: set([1056, 2003, 2003], 12729, 6517),
      boots: set([3020], 7253, 3743),
      core: set([3118, 4645, 3157], 971, 502),
      later: [
        [set([3089], 950, 540), set([3157], 739, 446), set([3135], 247, 138)],
        [set([3089], 148, 96), set([3135], 126, 64), set([3157], 116, 64)],
      ],
      situationalPool: [set([3089], 950, 540), set([3157], 739, 446), set([3135], 247, 138), set([3102], 210, 112), set([3165], 120, 61), set([3100], 90, 47)],
      buildOrder: [3118, 3020, 4645, 3157, 3089, 3135],
      games: 9482,
      source: 'OP.GG',
      runeOptions: [
        // One page per keystone + secondary tree, with that group's numbers.
        rune(8100, 8200, [8112, 8139, 8140, 8106, 8210, 8226, 5005, 5008, 5001], 9482, 4833),
        rune(8200, 8100, [8229, 8226, 8210, 8237, 8139, 8135, 5005, 5008, 5001], 1444, 753),
        rune(8100, 8400, [8112, 8139, 8140, 8106, 8451, 8473, 5005, 5008, 5001], 743, 379),
        rune(8100, 8300, [8112, 8139, 8140, 8106, 8345, 8347, 5005, 5008, 5001], 621, 300),
      ],
      spellOptions: [spell([4, 14], 8890, 4576), spell([4, 12], 3639, 1890), spell([3, 4], 175, 91)],
      coreOptions: [set([3118, 4645, 3157], 971, 502), set([3118, 4645, 3089], 588, 310), set([3118, 3100, 3089], 344, 180)],
      bootsOptions: [set([3020], 7253, 3743), set([3158], 3728, 1930), set([3111], 1330, 670)],
    },
    choice: { runes: 0, spells: 0, core: 0, boots: 0 },
    matchup: withMatchup ? demoMatchup() : null,
  };

  function rune(primaryStyleId: number, subStyleId: number, perkIds: number[], games: number, wins: number): RuneRec {
    return { primaryStyleId, subStyleId, perkIds, keystoneName: '', primaryName: '', secondaryName: '', perkNames: [], games, winRate: wins / games, pickRate: games / total };
  }
  function spell(ids: number[], games: number, wins: number): SpellOption {
    return { ids, games, winRate: wins / games, pickRate: games / total };
  }
}

/** Real OP.GG numbers for Ahri mid vs Zed (website API + MCP lane guide, October 2026). */
export function demoMatchup(opponentId = 238, guessed = true): MatchupState {
  const total = 1028;
  const set = (ids: number[], games: number, wins: number) => ({ ids, names: [], games, winRate: wins / games, pickRate: games / total });
  const spell = (ids: number[], games: number, wins: number): SpellOption => ({ ids, games, winRate: wins / games, pickRate: games / total });
  const overall = demoRecBase();
  const runes = { ...overall.runes!, games: 545, winRate: 265 / 545, pickRate: 0.53 };
  const comet: RuneRec = { ...overall.runeOptions[1], games: 121, winRate: 0.512, pickRate: 0.118 };
  const core = [set([3118, 4645, 3157], 86, 41), set([3118, 3157, 4645], 48, 24), set([3118, 3100, 3157], 41, 19)];
  const boots = [set([3020], 512, 254), set([3111], 301, 156), set([3158], 160, 77)];
  const spells = [spell([4, 14], 738, 369), spell([4, 12], 231, 111), spell([3, 4], 43, 21)];
  const rec: Recommendation = {
    ...overall, runes, games: 545, spells: [4, 14], spellStats: { games: 738, winRate: 0.5, pickRate: 0.718 },
    core: core[0], boots: boots[0], runeOptions: [runes, comet], spellOptions: spells, coreOptions: core, bootsOptions: boots,
    buildOrder: [3118, 3020, 4645, 3157, 3089, 3135],
  };
  if (opponentId !== 238) {
    return { opponentId, guessed, loading: false, tipLoading: false, error: null, myRecord: { championId: opponentId, games: 0, wins: 0, kills: 0, deaths: 0, assists: 0 },
      matchup: { championId: 103, opponentId, position: 'mid', games: 214, winRate: 0.537, rec: null, tip: null, opponentDamageType: 'AD' } };
  }
  return {
    opponentId,
    guessed,
    loading: false,
    tipLoading: false,
    error: null,
    myRecord: { championId: 238, games: 3, wins: 1, kills: 14, deaths: 13, assists: 9 },
    matchup: {
      championId: 103, opponentId: 238, position: 'mid', games: 949, winRate: 468 / 949, rec, opponentDamageType: 'AD',
      tip: {
        text: 'Do not use Charm [E] until Zed closes in using Living Shadow (W). If Zed has Death Mark (R) off cooldown, try to use Charm [E] after he reappears when he uses Death Mark (R).',
        laneAdvantage: 'them', soloKills: 'them', playStyle: 'even',
      },
    },
  };
}

function demoRecBase(): Recommendation {
  return demoRec(false).rec!;
}

/** The browser demo's stand-in for the Rust `with_choice`: the picked options in place. */
export function demoWithChoice(rec: Recommendation, c: RecChoice): Recommendation {
  const picked = rec.runeOptions[c.runes] ?? rec.runes;
  const runes = c.custom
    ? { ...(picked as RuneRec), ...c.custom, keystoneName: '', primaryName: '', secondaryName: '', perkNames: [], games: 0, winRate: 0, pickRate: 0, custom: true }
    : picked;
  const sp = rec.spellOptions[c.spells];
  const core = rec.coreOptions[c.core] ?? rec.core;
  const boots = rec.bootsOptions[c.boots] ?? rec.boots;
  const order: number[] = [];
  const add = (id: number | undefined) => id !== undefined && !order.includes(id) && order.push(id);
  add(core?.ids[0]);
  boots?.ids.forEach(add);
  core?.ids.slice(1).forEach(add);
  for (const opts of rec.later) add(opts.flatMap((o) => o.ids).find((id) => !order.includes(id)));
  return {
    ...rec,
    runes,
    spells: sp ? sp.ids : rec.spells,
    spellStats: sp ? { games: sp.games, winRate: sp.winRate, pickRate: sp.pickRate } : rec.spellStats,
    core,
    boots,
    buildOrder: order,
  };
}

const PATCH_URL = 'https://www.leagueoflegends.com/en-us/news/game-updates/league-of-legends-patch-26-21-notes';

export function demoCacheInfo(): CacheInfo {
  return {
    patchNotes: { files: 4, bytes: 186_400, inMemory: 2 },
    runes: { files: 23, bytes: 97_300, inMemory: 1 },
  };
}

export function demoPatchList(): PatchInfo[] {
  return [
    { version: '26.21', title: 'League of Legends Patch 26.21 Notes', url: PATCH_URL, published: '2026-10-20T18:00:00.000Z' },
    { version: '26.20', title: 'League of Legends Patch 26.20 Notes', url: PATCH_URL.replace('26-21', '26-20'), published: '2026-10-06T18:00:00.000Z' },
  ];
}

/** Made-up changes in the shape the Rust side sends, for the browser preview. */
export function demoPatch(url: string): PatchNotes {
  const info = demoPatchList().find((p) => p.url === url) ?? demoPatchList()[0];
  const line = (label: string, before: string, after: string, effect: 'buff' | 'nerf' | '' = '') => ({ label, before, after, text: '', effect });
  const text = (t: string) => ({ label: '', before: '', after: '', text: t, effect: '' as const });
  return {
    info,
    sections: [
      { title: 'Patch Highlights', kind: 'other', notes: ['Demo data: in the app this page shows the real notes from leagueoflegends.com.'], entries: [] },
      {
        title: 'Champions', kind: 'champion', notes: [], entries: [
          { name: 'Ahri', verdict: 'buff', context: 'Ahri has been struggling to find kills in mid lane, so her charm lasts a little longer.', groups: [
            { title: 'E - Charm', lines: [line('Charm Duration', '1.4 - 2 seconds', '1.5 - 2.1 seconds', 'buff')] },
          ] },
          { name: 'Zed', verdict: 'nerf', context: 'Zed escapes too easily after an all-in.', groups: [
            { title: 'W - Living Shadow', lines: [line('Cooldown', '20 / 18.5 / 17 / 15.5 / 14 seconds', '22 / 20 / 18 / 16 / 14 seconds', 'nerf')] },
          ] },
          { name: 'Jinx', verdict: 'nerf', context: '', groups: [
            { title: 'Base Stats', lines: [line('Base Attack Damage', '59', '57', 'nerf')] },
          ] },
          { name: 'Lee Sin', verdict: 'adjusted', context: 'Moving power from his early game into his late game.', groups: [
            { title: 'Q - Sonic Wave', lines: [line('Base Damage', '55 / 80 / 105 / 130 / 155', '50 / 80 / 110 / 140 / 170')] },
            { title: 'R - Dragon\'s Rage', lines: [text('Now knocks back slightly further at max rank.')] },
          ] },
          { name: "Kai'Sa", verdict: 'buff', context: '', groups: [
            { title: 'Base Stats', lines: [line('Health Growth', '102', '108', 'buff')] },
          ] },
        ],
      },
      {
        title: 'Items', kind: 'item', notes: [], entries: [
          { name: 'Shadowflame', verdict: 'buff', context: 'A little more damage for mages who rush it.', groups: [
            { title: '', lines: [line('Ability Power', '110', '115', 'buff'), line('Total Cost', '3200', '3100', 'buff')] },
          ] },
          { name: 'Void Staff', verdict: 'nerf', context: '', groups: [{ title: '', lines: [line('Magic Penetration', '40%', '35%', 'nerf')] }] },
        ],
      },
      {
        title: 'Arena', kind: 'other', notes: ['A few augment changes.'], entries: [
          { name: 'Big Brain', verdict: 'new', context: 'Back from an earlier season.', groups: [{ title: '', lines: [text('Gain a shield that scales with Ability Power.')] }] },
        ],
      },
      {
        title: 'Bugfixes & QoL Changes', kind: 'other', notes: [], entries: [
          { name: 'Bugfixes', verdict: '', context: '', groups: [{ title: '', lines: [text('Fixed a demo bug.'), text('Fixed another demo bug.')] }] },
        ],
      },
    ],
  };
}

const TIER_LANES: Record<string, [number, string][]> = {
  top: [[54, 'Malphite'], [875, 'Sett'], [98, 'Shen'], [41, 'Gangplank'], [58, 'Renekton'], [122, 'Darius'], [266, 'Aatrox'], [86, 'Garen'], [114, 'Fiora'], [164, 'Camille'], [24, 'Jax'], [516, 'Ornn'], [82, 'Mordekaiser'], [897, "K'Sante"], [17, 'Teemo']],
  jungle: [[64, 'Lee Sin'], [254, 'Vi'], [121, "Kha'Zix"], [104, 'Graves'], [234, 'Viego'], [56, 'Nocturne'], [141, 'Kayn'], [120, 'Hecarim'], [32, 'Amumu'], [19, 'Warwick'], [245, 'Ekko'], [233, 'Briar'], [76, 'Nidalee'], [59, 'Jarvan IV'], [60, 'Elise']],
  middle: [[103, 'Ahri'], [245, 'Ekko'], [4, 'Twisted Fate'], [157, 'Yasuo'], [55, 'Katarina'], [127, 'Lissandra'], [7, 'LeBlanc'], [777, 'Yone'], [134, 'Syndra'], [711, 'Vex'], [84, 'Akali'], [101, 'Xerath'], [238, 'Zed'], [99, 'Lux'], [112, 'Viktor']],
  bottom: [[222, 'Jinx'], [145, "Kai'Sa"], [81, 'Ezreal'], [51, 'Caitlyn'], [21, 'Miss Fortune'], [202, 'Jhin'], [22, 'Ashe'], [67, 'Vayne'], [236, 'Lucian'], [901, 'Smolder'], [119, 'Draven'], [15, 'Sivir'], [498, 'Xayah'], [29, 'Twitch'], [96, "Kog'Maw"]],
  utility: [[412, 'Thresh'], [40, 'Janna'], [89, 'Leona'], [99, 'Lux'], [12, 'Alistar'], [53, 'Blitzcrank'], [111, 'Nautilus'], [117, 'Lulu'], [267, 'Nami'], [555, 'Pyke'], [497, 'Rakan'], [16, 'Soraka'], [902, 'Milio'], [43, 'Karma'], [201, 'Braum']],
};
const LOLA_LABELS = ['S+', 'S', 'S-', 'A+', 'A', 'A-', 'B+', 'B', 'B-', 'C+', 'C', 'C-', 'D+', 'D', 'D-'];

/** Made-up tier list in the shape tierlist.rs sends. */
export function demoTierList(source: TierSource, position: string, rank: string): TierList {
  const lane = TIER_LANES[position] ?? TIER_LANES['middle'];
  const opgg = source === 'opgg';
  // Each lane's numbers are a little different, so the Champions tab's All view doesn't repeat itself.
  const j = Math.max(0, Object.keys(TIER_LANES).indexOf(position));
  const entries: TierEntry[] = lane.map(([championId, name], i) => {
    const step = opgg ? Math.min(4, Math.floor(i / 3)) : Math.min(14, i);
    // OP.GG's top pick is in its "OP" tier, as in real lists.
    const label = opgg ? (i === 0 ? 'OP' : String(step + 1)) : LOLA_LABELS[step];
    return {
      championId,
      name,
      tier: (opgg ? 'SABCD'[step] : label[0]) as TierEntry['tier'],
      label,
      rank: i + 1,
      rankChange: opgg ? ((i * 7) % 5) - 2 : null,
      winRate: (opgg ? 52.6 : 53.4) - i * 0.37 - j * 0.23 + ((i * 5 + j * 3) % 7) * 0.04,
      pickRate: 9.5 - i * 0.5 - j * 0.55 + ((i + j * 2) % 3) * 0.2,
      banRate: ((i * 13 + j * 7) % 17) + j * 0.4 + 0.3,
      games: (opgg ? 9800 : 98000) - i * (opgg ? 450 : 4500) - j * (opgg ? 310 : 3100),
    };
  });
  return {
    source,
    position,
    rank,
    patch: opgg ? '16.21' : null,
    gamesAnalysed: opgg ? 1_211_088 : 1_484_916,
    fetchedAt: Math.floor(Date.now() / 1000) - 600,
    // Lolalytics rates no one in Challenger.
    entries: !opgg && rank === 'challenger' ? [] : entries,
  };
}

export function demoGuide(championId: number, name: string): Guide {
  const clip = (k: string) => `https://d28xe8vt774jo5.cloudfront.net/champion-abilities/0103/ability_0103_${k}1`;
  const icon = (k: string) => `/lol-game-data/assets/ASSETS/Characters/Ahri/HUD/Icons2D/Icons_Ahri_${k === 'P' ? 'Passive' : k}.png`;
  const ability = (key: string, abilityName: string, description: string): GuideAbility => ({
    key, name: abilityName, description, icon: icon(key), video: `${clip(key)}.webm`, poster: `${clip(key)}.jpg`,
  });
  return {
    championId,
    name,
    title: 'the Nine-Tailed Fox',
    bio: 'Innately connected to the magic of the spirit realm, Ahri is a fox-like vastaya who can manipulate her prey\'s emotions and consume their essence.',
    difficulty: 2,
    damageType: 'AP',
    attackType: 'ranged',
    roles: ['mage', 'assassin'],
    playstyle: { damage: 3, durability: 1, crowdControl: 2, mobility: 3, utility: 1 },
    abilities: [
      ability('P', 'Essence Theft', 'After killing 9 minions or monsters, Ahri heals.\nAfter taking down an enemy champion, Ahri heals for a greater amount.'),
      ability('Q', 'Orb of Deception', 'Ahri sends out and pulls back her orb, dealing magic damage on the way out and true damage on the way back.'),
      ability('W', 'Fox-Fire', 'Ahri gains a brief burst of Move Speed and releases three fox-fires that lock onto and attack nearby enemies.'),
      ability('E', 'Charm', 'Ahri blows a kiss that damages and charms an enemy it encounters, causing them to walk harmlessly towards her.'),
      ability('R', 'Spirit Rush', 'Ahri dashes forward and fires essence bolts, damaging nearby enemies. Spirit Rush can be cast up to three times before going on cooldown.'),
    ],
    tips: [
      'Use Charm to set up your combos, it will make landing Orb of Deception and Fox-Fire dramatically easier.',
      'Initiate team fights using Charm, and chase down stragglers with Spirit Rush.',
      'Spirit Rush enables Ahri\'s abilities, it opens up paths for Charm, helps double hitting with Orb of Deception, and closes to make use of Fox-Fire.',
    ],
    counterTips: [
      'Ahri\'s survivability is dramatically reduced when her Ultimate, Spirit Rush, is down.',
      'Stay behind minions to make Charm difficult to land, this will reduce Ahri\'s damage potential significantly.',
    ],
  };
}

/** A made-up team gold lead up to `now`: ahead early, then behind, ending on the snapshot's 21,400 vs 22,650. */
export function demoGoldHistory(now: number): GoldPoint[] {
  const points: GoldPoint[] = [];
  const lead = (t: number) => -1250 * (t / now) ** 2 + Math.sin(t / 60) * 900 * Math.sin((Math.PI * t) / now);
  for (let t = 0; t < now; t += 15) points.push({ t, lead: Math.round(lead(t)) });
  points.push({ t: now, lead: -1250 });
  return points;
}

/** Picks against Zed mid, as `picks.rs` sends them (numbers made up, shaped like OP.GG's). */
export function demoPickSuggestions(): PickSuggestions {
  const pick = (championId: number, vsGames: number, vsWinRate: number, winRate: number, tier: string, masteryPoints = 0, masteryLevel = 0) =>
    ({ championId, vsGames, vsWinRate, winRate, tier, masteryPoints, masteryLevel, score: (vsWinRate * vsGames + 100 * winRate) / (vsGames + 100) });
  return {
    position: 'middle',
    opponentId: 238,
    guessed: true,
    loading: false,
    error: null,
    picks: [
      pick(90, 1840, 0.559, 0.521, '1'),
      pick(127, 1210, 0.551, 0.508, '2', 18400, 4),
      pick(711, 2330, 0.546, 0.517, '1'),
      pick(3, 980, 0.548, 0.503, '3'),
      pick(10, 610, 0.552, 0.514, '2'),
      pick(1, 1420, 0.538, 0.512, '2', 6200, 2),
      pick(80, 720, 0.536, 0.498, '3'),
      pick(103, 3120, 0.529, 0.511, '2', 214000, 7),
      pick(134, 1650, 0.524, 0.503, '3', 48700, 5),
      pick(61, 2010, 0.512, 0.497, '4', 15300, 4),
    ],
  };
}

/** Ranked Solo/Duo games get an LP change, except the oldest (League Bro wasn't running); one was a promotion. */
function demoLpChange(i: number, queueId: number, result: MatchLine['result']): LpChange | null {
  if (queueId !== 420 || result === 'remake' || i > 9) return null;
  const delta = result === 'win' ? 19 + (i % 4) : -(15 + (i % 5));
  return { delta, tier: 'GOLD', division: i === 6 ? 'I' : 'II', lp: i === 6 ? 2 : 47, moved: i === 6 ? 'up' : '' };
}
