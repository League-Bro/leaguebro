// Sample data used when the UI runs in a plain browser (`npm start`)
// instead of inside the Tauri app, so the layout can be worked on
// without League running.
import { ChampSelectView, Config, PostGame, PostPlayer, Profile, RecState, Snapshot, StaticData } from './models';

const champs: [number, string][] = [
  [103, 'Ahri'], [64, 'Lee Sin'], [222, 'Jinx'], [412, 'Thresh'], [122, 'Darius'],
  [238, 'Zed'], [254, 'Vi'], [157, 'Yasuo'], [99, 'Lux'], [145, "Kai'Sa"],
  [516, 'Ornn'], [89, 'Leona'], [555, 'Pyke'], [1, 'Annie'], [84, 'Akali'],
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
    status: { connected: true, phase: 'InProgress', summoner: { puuid: 'me', name: 'Dom#NA1' }, message: '' },
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
    lastImport: { ok: true, championId: 103, message: 'Set "League Buddy: Ahri Mid" (OP.GG) · Flash + Ignite' },
    overlay: {
      gameTime: 742,
      gameMode: 'CLASSIC',
      championName: 'Ahri',
      gold: 1310,
      kills: 3,
      deaths: 1,
      assists: 5,
      timers: [
        { key: 'dragon', label: 'Dragon', spawnAt: 860, side: 'neutral' },
        { key: 'baron', label: 'Baron', spawnAt: 1200, side: 'neutral' },
        { key: 'inhib', label: 'Enemy Mid inhib', spawnAt: 1012, side: 'enemy' },
      ],
      nextItems: [
        { id: 4645, name: 'Shadowflame', price: 3200, affordable: false },
        { id: 3157, name: "Zhonya's Hourglass", price: 3250, affordable: false },
      ],
      hasBuild: true,
      buildSource: 'OP.GG',
      skillMax: ['Q', 'W', 'E'],
      nextSkill: 'Q',
    },
    rec: demoRec(),
    postGame: null,
  };
}

export function demoPostGame(): PostGame {
  const p = (
    puuid: string, name: string | null, championId: number, k: number, d: number, a: number,
    cs: number, gold: number, damage: number, vision: number, items: number[], isMe = false,
  ): PostPlayer => ({
    puuid, name, isMe, championId, level: 13 + ((k + a) % 5), kills: k, deaths: d, assists: a, cs, gold, damage, vision,
    items: [...items, 0, 0, 0, 0, 0, 0].slice(0, 6).concat(3340), spells: [4, 14],
  });
  return {
    gameId: 1,
    queueId: 420,
    queueName: 'Ranked Solo/Duo',
    gameMode: 'CLASSIC',
    duration: 1834,
    result: 'win',
    teams: [
      {
        teamId: 100, win: true, isMine: true, kills: 31, gold: 61200, dragons: 3, barons: 1, towers: 9,
        players: [
          p('a1', 'TreeHugger#NA1', 516, 2, 4, 9, 198, 10900, 14200, 18, [3020, 1058]),
          p('a2', 'Gank Plank#0001', 64, 7, 5, 12, 41, 11800, 17600, 39, [3135]),
          p('me', 'Dom#NA1', 103, 11, 2, 9, 226, 14650, 32400, 22, [3118, 3020, 4645, 3157, 1058], true),
          p('a4', 'Cannon Minion#7777', 222, 10, 3, 8, 245, 14100, 29800, 14, [3089, 3020]),
          p('', null, 412, 1, 6, 21, 33, 9750, 6100, 71, [2003]),
        ],
      },
      {
        teamId: 200, win: false, isMine: false, kills: 20, gold: 52300, dragons: 1, barons: 0, towers: 3,
        players: [
          p('e1', 'Noxian Pride#EUW', 122, 6, 7, 3, 201, 11200, 21900, 12, [3020]),
          p('e2', 'Punch First#NA1', 254, 4, 8, 8, 52, 9900, 15300, 33, []),
          p('e3', 'Shadow Step#ZED', 238, 7, 6, 4, 188, 11000, 23700, 17, [1058]),
          p('e4', 'Void Hunter#NA1', 145, 3, 6, 6, 214, 11400, 19800, 11, [3135]),
          p('e5', 'Hook City#NA1', 555, 0, 4, 11, 29, 8800, 7400, 58, [2003]),
        ],
      },
    ],
  };
}

export function demoStatic(): StaticData {
  return {
    champions: champs.map(([id, name]) => ({ id, name, alias: name.replace(/[^A-Za-z]/g, '') })),
    items: [
      { id: 3020, name: "Sorcerer's Shoes", priceTotal: 1100, iconPath: '/lol-game-data/assets/ASSETS/Items/Icons2D/3020_Mage_T2_SorcererShoes.png' },
      { id: 6655, name: "Luden's Companion", priceTotal: 2850, iconPath: '/lol-game-data/assets/ASSETS/Items/Icons2D/6655_Mage_T4_LudensCompanion.png' },
      { id: 1058, name: 'Needlessly Large Rod', priceTotal: 1200, iconPath: '/lol-game-data/assets/ASSETS/Items/Icons2D/1058_Mage_T1_NeedlesslyLargeRod.png' },
      { id: 3089, name: "Rabadon's Deathcap", priceTotal: 3600, iconPath: '/lol-game-data/assets/ASSETS/Items/Icons2D/3089_Mage_T3_RabadonsDeathcap.png' },
      { id: 3157, name: "Zhonya's Hourglass", priceTotal: 3250, iconPath: '/lol-game-data/assets/ASSETS/Items/Icons2D/3157_Mage_T3_ZhonyasHourglass.png' },
      { id: 3118, name: 'Malignance', priceTotal: 2700, iconPath: '/lol-game-data/assets/ASSETS/Items/Icons2D/3118_Mage_T3_Malignance.png' },
      { id: 4645, name: 'Shadowflame', priceTotal: 3200, iconPath: '/lol-game-data/assets/ASSETS/Items/Icons2D/4645_Mage_T3_Shadowflame.png' },
      { id: 3135, name: 'Void Staff', priceTotal: 3000, iconPath: '/lol-game-data/assets/ASSETS/Items/Icons2D/3135_Mage_T3_VoidStaff.png' },
      { id: 1056, name: "Doran's Ring", priceTotal: 400, iconPath: '/lol-game-data/assets/ASSETS/Items/Icons2D/1056_Mage_T1_DoransRing.png' },
      { id: 2003, name: 'Health Potion', priceTotal: 50, iconPath: '/lol-game-data/assets/ASSETS/Items/Icons2D/2003_Class_T1_HealthPotion.png' },
    ],
    perks: [
      [8112, 'Electrocute', 'Domination/Electrocute/Electrocute.png'],
      [8139, 'Taste of Blood', 'Domination/TasteOfBlood/GreenTerror_TasteOfBlood.png'],
      [8140, 'Grisly Mementos', 'Domination/GrislyMementos/GrislyMementos.png'],
      [8106, 'Ultimate Hunter', 'Domination/UltimateHunter/UltimateHunter.png'],
      [8210, 'Transcendence', 'Sorcery/Transcendence/Transcendence.png'],
      [8226, 'Manaflow Band', 'Sorcery/ManaflowBand/ManaflowBand.png'],
      [5005, 'Attack Speed', 'StatMods/StatModsAttackSpeedIcon.png'],
      [5008, 'Adaptive Force', 'StatMods/StatModsAdaptiveForceIcon.png'],
      [5001, 'Health Scaling', 'StatMods/StatModsHealthScalingIcon.png'],
    ].map(([id, name, path]) => ({ id: id as number, name: name as string, iconPath: `/lol-game-data/assets/v1/perk-images/Styles/${path}` })),
    spells: [
      { id: 4, name: 'Flash', iconPath: '/lol-game-data/assets/DATA/Spells/Icons2D/Summoner_flash.png' },
      { id: 14, name: 'Ignite', iconPath: '/lol-game-data/assets/DATA/Spells/Icons2D/SummonerIgnite.png' },
    ],
    styles: [
      { id: 8100, name: 'Domination', iconPath: '' },
      { id: 8200, name: 'Sorcery', iconPath: '' },
    ],
  };
}

export function demoConfig(): Config {
  return {
    autoImportRunes: true,
    importOnHover: false,
    reuseCurrentPageWhenFull: false,
    runeOverrides: {
      '103': { name: 'Electrocute Ahri', primaryStyleId: 8100, subStyleId: 8200, selectedPerkIds: [8112, 8139, 8138, 8135, 8226, 8237, 5008, 5008, 5001] },
    },
    builds: {},
    recSource: 'opgg',
    setSummonerSpells: true,
    useRecommendedBuilds: true,
    showSkillHint: true,
    scoutInChampSelect: true,
    scoutOnLoading: true,
    overlayEnabled: true,
    overlayX: null,
    overlayY: null,
    overlayOpacity: 0.9,
    timers: { firstDragon: 300, firstBaron: 1200, dragonRespawn: 300, elderRespawn: 360, baronRespawn: 360, inhibRespawn: 300 },
    installDir: null,
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

/** Real OP.GG answer for Ahri mid (from the probe), as League Buddy shows it. */
export function demoRec(): RecState {
  const set = (ids: number[], names: string[], games: number, wins: number) => ({ ids, names, games, winRate: wins / games });
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
        keystoneName: 'Electrocute',
        primaryName: 'Domination',
        secondaryName: 'Sorcery',
        perkNames: ['Electrocute', 'Taste of Blood', 'Grisly Mementos', 'Ultimate Hunter', 'Transcendence', 'Manaflow Band'],
        games: 3764,
        winRate: 1930 / 3764,
      },
      spells: [4, 14],
      skillMax: ['Q', 'W', 'E'],
      skillOrder: ['W', 'Q', 'E', 'Q', 'Q', 'R', 'Q', 'W', 'Q', 'W', 'R', 'W', 'W', 'E', 'E'],
      starter: set([1056, 2003, 2003], ["Doran's Ring", 'Health Potion', 'Health Potion'], 7944, 4084),
      boots: set([3020], ["Sorcerer's Shoes"], 4455, 2271),
      core: set([3118, 4645, 3157], ['Malignance', 'Shadowflame', "Zhonya's Hourglass"], 619, 328),
      later: [],
      buildOrder: [3118, 3020, 4645, 3157, 3089, 3135],
      games: 3764,
      source: 'OP.GG',
    },
  };
}
