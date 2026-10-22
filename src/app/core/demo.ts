// Sample data used when the UI runs in a plain browser (`npm start`)
// instead of inside the Tauri app, so the layout can be worked on
// without League running.
import {
  CacheInfo,
  ChampSelectView,
  Config,
  ItemInfo,
  PatchInfo,
  PatchNotes,
  PostGame,
  PostPlayer,
  Profile,
  RecState,
  Snapshot,
  StaticData,
} from './models';

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
    lastImport: { ok: true, championId: 103, message: 'Set "League Bro: Ahri Mid" (OP.GG) · Flash + Ignite · build added to the shop' },
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
      lane: { opponent: 'Zed', mine: 5350, theirs: 3967 },
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

const roles: Record<number, string[]> = {
  103: ['mage', 'assassin'], 64: ['fighter', 'assassin'], 222: ['marksman'], 412: ['support', 'tank'],
  122: ['fighter', 'tank'], 238: ['assassin'], 254: ['fighter', 'assassin'], 157: ['fighter', 'assassin'],
  99: ['mage', 'support'], 145: ['marksman'], 516: ['tank', 'fighter'], 89: ['tank', 'support'],
  555: ['support', 'assassin'], 1: ['mage', 'support'], 84: ['assassin'],
};

function demoItem(id: number, name: string, priceTotal: number, file: string, stats: string[], desc: string, categories: string[]): ItemInfo {
  return { id, name, priceTotal, iconPath: `/lol-game-data/assets/ASSETS/Items/Icons2D/${file}`, stats, desc, categories };
}

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
      demoItem(3020, "Sorcerer's Shoes", 1100, '3020_Mage_T2_SorcererShoes.png', ['12 Magic Penetration', '45 Move Speed'], '', ['Boots', 'MagicPenetration']),
      demoItem(6655, "Luden's Companion", 2850, '6655_Mage_T4_LudensCompanion.png', ['100 Ability Power', '600 Mana', '10 Ability Haste'], 'Echo\nDamaging abilities fire bonus magic damage at the target and nearby enemies.', ['SpellDamage', 'Mana', 'AbilityHaste']),
      demoItem(1058, 'Needlessly Large Rod', 1200, '1058_Mage_T1_NeedlesslyLargeRod.png', ['60 Ability Power'], '', ['SpellDamage']),
      demoItem(3089, "Rabadon's Deathcap", 3600, '3089_Mage_T3_RabadonsDeathcap.png', ['130 Ability Power'], 'Magical Opus\nIncreases your total Ability Power.', ['SpellDamage']),
      demoItem(3157, "Zhonya's Hourglass", 3250, '3157_Mage_T3_ZhonyasHourglass.png', ['105 Ability Power', '50 Armor'], 'Time Stop\nBecome invulnerable and untargetable for a short time, but unable to act.', ['SpellDamage', 'Armor', 'Active']),
      demoItem(3118, 'Malignance', 2700, '3118_Mage_T3_Malignance.png', ['80 Ability Power', '600 Mana', '25 Ability Haste'], 'Scorn\nGain Ultimate Ability Haste.\nHatefog\nYour ultimate burns the ground and lowers Magic Resist of enemies inside.', ['SpellDamage', 'Mana', 'AbilityHaste']),
      demoItem(4645, 'Shadowflame', 3200, '4645_Mage_T3_Shadowflame.png', ['110 Ability Power', '15 Magic Penetration'], 'Cinderbloom\nMagic and true damage crit against low health enemies.', ['SpellDamage', 'MagicPenetration']),
      demoItem(3135, 'Void Staff', 3000, '3135_Mage_T3_VoidStaff.png', ['95 Ability Power', '40% Magic Penetration'], '', ['SpellDamage', 'MagicPenetration']),
      demoItem(1056, "Doran's Ring", 400, '1056_Mage_T1_DoransRing.png', ['18 Ability Power', '90 Health'], 'Focus\nAttacks deal bonus damage to minions.\nDrain\nRestore mana over time.', ['Health', 'SpellDamage', 'ManaRegen', 'Lane']),
      demoItem(2003, 'Health Potion', 50, '2003_Class_T1_HealthPotion.png', [], 'Click to consume: restore health over 15 seconds.', ['Consumable', 'HealthRegen', 'Active']),
    ],
    perks: [
      [8112, 'Electrocute', 'Domination/Electrocute/Electrocute.png', 'Hitting a champion with 3 separate attacks or abilities in 3s deals bonus adaptive damage.', 'Combo Damage'],
      [8139, 'Taste of Blood', 'Domination/TasteOfBlood/GreenTerror_TasteOfBlood.png', 'Heal when you damage an enemy champion.', 'Healing'],
      [8140, 'Grisly Mementos', 'Domination/GrislyMementos/GrislyMementos.png', 'Gain Ability Haste for each champion takedown.', 'Ability Haste'],
      [8106, 'Ultimate Hunter', 'Domination/UltimateHunter/UltimateHunter.png', 'Your ultimate gains haste for each unique champion takedown.', 'Ultimate Cooldown'],
      [8210, 'Transcendence', 'Sorcery/Transcendence/Transcendence.png', 'Gain Ability Haste at levels 5 and 8; takedowns refund basic ability cooldowns at level 11.', 'Ability Haste'],
      [8226, 'Manaflow Band', 'Sorcery/ManaflowBand/ManaflowBand.png', 'Hitting champions with abilities permanently increases maximum mana.', 'Mana'],
      [5005, 'Attack Speed', 'StatMods/StatModsAttackSpeedIcon.png', '+10% Attack Speed', ''],
      [5008, 'Adaptive Force', 'StatMods/StatModsAdaptiveForceIcon.png', '+9 Adaptive Force', ''],
      [5001, 'Health Scaling', 'StatMods/StatModsHealthScalingIcon.png', '+10-180 Health (based on level)', ''],
    ].map(([id, name, path, desc, tag]) => ({
      id: id as number, name: name as string, iconPath: `/lol-game-data/assets/v1/perk-images/Styles/${path}`, desc: desc as string, tag: tag as string,
    })),
    spells: [
      { id: 4, name: 'Flash', iconPath: '/lol-game-data/assets/DATA/Spells/Icons2D/Summoner_flash.png', desc: 'Teleports your champion a short distance toward your cursor.', tag: '' },
      { id: 14, name: 'Ignite', iconPath: '/lol-game-data/assets/DATA/Spells/Icons2D/SummonerIgnite.png', desc: 'Ignites a target enemy champion, dealing true damage over 5 seconds and reducing healing.', tag: '' },
    ],
    styles: [
      { id: 8100, name: 'Domination', iconPath: '', desc: '', tag: '' },
      { id: 8200, name: 'Sorcery', iconPath: '', desc: '', tag: '' },
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
    setItemSets: true,
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

/** Real OP.GG answer for Ahri mid (from the probe), as League Bro shows it. */
export function demoRec(): RecState {
  const total = 10962;
  const set = (ids: number[], names: string[], games: number, wins: number) => ({ ids, names, games, winRate: wins / games, pickRate: games / total });
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
        pickRate: 3764 / total,
      },
      spells: [4, 14],
      spellStats: { games: 6120, winRate: 0.512, pickRate: 0.56 },
      skillMax: ['Q', 'W', 'E'],
      skillStats: { games: 8810, winRate: 0.509, pickRate: 0.8 },
      damageType: 'AP',
      skillOrder: ['W', 'Q', 'E', 'Q', 'Q', 'R', 'Q', 'W', 'Q', 'W', 'R', 'W', 'W', 'E', 'E'],
      starter: set([1056, 2003, 2003], ["Doran's Ring", 'Health Potion', 'Health Potion'], 7944, 4084),
      boots: set([3020], ["Sorcerer's Shoes"], 4455, 2271),
      core: set([3118, 4645, 3157], ['Malignance', 'Shadowflame', "Zhonya's Hourglass"], 619, 328),
      later: [
        [set([3089], ["Rabadon's Deathcap"], 212, 113), set([3135], ['Void Staff'], 140, 77)],
        [set([3135], ['Void Staff'], 98, 52)],
      ],
      buildOrder: [3118, 3020, 4645, 3157, 3089, 3135],
      games: 3764,
      source: 'OP.GG',
    },
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
