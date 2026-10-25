/**
 * Rough damage split per champion, as [AD, AP, true] percentages of what the
 * champion usually deals in a game. Hand-made from how their kits and common
 * builds work, not measured, so treat team totals as "mostly AD" or "mixed"
 * rather than exact numbers. Keyed by lowercase client alias.
 */
const SPLITS: Record<string, [number, number, number]> = {
  aatrox: [97, 3, 0], ahri: [3, 85, 12], akali: [15, 85, 0], akshan: [95, 5, 0], alistar: [10, 90, 0],
  ambessa: [95, 5, 0], amumu: [10, 90, 0], anivia: [3, 97, 0], annie: [3, 97, 0], aphelios: [95, 5, 0],
  ashe: [95, 5, 0], aurelionsol: [3, 97, 0], aurora: [3, 97, 0], azir: [10, 90, 0], bard: [20, 80, 0],
  belveth: [80, 10, 10], blitzcrank: [15, 85, 0], brand: [3, 97, 0], braum: [25, 75, 0], briar: [95, 5, 0],
  caitlyn: [97, 3, 0], camille: [60, 5, 35], cassiopeia: [5, 95, 0], chogath: [10, 65, 25], corki: [25, 75, 0],
  darius: [85, 0, 15], diana: [10, 90, 0], drmundo: [45, 55, 0], draven: [97, 3, 0], ekko: [10, 90, 0],
  elise: [10, 90, 0], evelynn: [10, 90, 0], ezreal: [70, 30, 0], fiddlesticks: [3, 97, 0], fiora: [60, 5, 35],
  fizz: [10, 90, 0], galio: [10, 90, 0], gangplank: [70, 15, 15], garen: [65, 0, 35], gnar: [90, 10, 0],
  gragas: [10, 90, 0], graves: [97, 3, 0], gwen: [5, 75, 20], hecarim: [90, 10, 0], heimerdinger: [5, 95, 0],
  hwei: [3, 97, 0], illaoi: [95, 5, 0], irelia: [85, 15, 0], ivern: [10, 90, 0], janna: [10, 90, 0],
  jarvaniv: [95, 5, 0], jax: [55, 45, 0], jayce: [95, 5, 0], jhin: [97, 3, 0], jinx: [97, 3, 0],
  kaisa: [55, 45, 0], kalista: [97, 3, 0], karma: [5, 95, 0], karthus: [3, 97, 0], kassadin: [5, 95, 0],
  katarina: [20, 80, 0], kayle: [35, 60, 5], kayn: [92, 3, 5], kennen: [10, 90, 0], khazix: [97, 3, 0],
  kindred: [95, 5, 0], kled: [97, 3, 0], kogmaw: [55, 40, 5], ksante: [85, 15, 0], leblanc: [3, 97, 0],
  leesin: [95, 5, 0], leona: [10, 90, 0], lillia: [3, 97, 0], lissandra: [3, 97, 0], lucian: [95, 5, 0],
  lulu: [10, 90, 0], lux: [3, 97, 0], malphite: [20, 80, 0], malzahar: [3, 97, 0], maokai: [10, 90, 0],
  masteryi: [70, 0, 30], mel: [3, 97, 0], milio: [10, 90, 0], missfortune: [92, 8, 0], monkeyking: [95, 5, 0],
  mordekaiser: [5, 95, 0], morgana: [3, 97, 0], naafiri: [97, 3, 0], nami: [10, 90, 0], nasus: [95, 5, 0],
  nautilus: [20, 80, 0], neeko: [3, 97, 0], nidalee: [15, 85, 0], nilah: [95, 5, 0], nocturne: [95, 5, 0],
  nunu: [10, 90, 0], olaf: [70, 0, 30], orianna: [3, 97, 0], ornn: [40, 60, 0], pantheon: [97, 3, 0],
  poppy: [95, 5, 0], pyke: [95, 5, 0], qiyana: [97, 3, 0], quinn: [97, 3, 0], rakan: [10, 90, 0],
  rammus: [20, 80, 0], reksai: [85, 0, 15], rell: [10, 90, 0], renata: [10, 90, 0], renekton: [97, 3, 0],
  rengar: [97, 3, 0], riven: [97, 3, 0], rumble: [3, 97, 0], ryze: [3, 97, 0], samira: [97, 3, 0],
  sejuani: [15, 85, 0], senna: [97, 3, 0], seraphine: [3, 97, 0], sett: [75, 0, 25], shaco: [60, 40, 0],
  shen: [45, 55, 0], shyvana: [40, 60, 0], singed: [3, 97, 0], sion: [85, 15, 0], sivir: [97, 3, 0],
  skarner: [55, 45, 0], smolder: [85, 5, 10], sona: [3, 97, 0], soraka: [3, 97, 0], swain: [3, 97, 0],
  sylas: [3, 97, 0], syndra: [3, 92, 5], tahmkench: [15, 85, 0], taliyah: [3, 97, 0], talon: [97, 3, 0],
  taric: [20, 80, 0], teemo: [10, 90, 0], thresh: [15, 85, 0], tristana: [70, 30, 0], trundle: [95, 5, 0],
  tryndamere: [97, 3, 0], twistedfate: [15, 85, 0], twitch: [80, 5, 15], udyr: [45, 55, 0], urgot: [97, 3, 0],
  varus: [55, 45, 0], vayne: [65, 0, 35], veigar: [3, 97, 0], velkoz: [3, 62, 35], vex: [3, 97, 0],
  vi: [97, 3, 0], viego: [95, 5, 0], viktor: [3, 97, 0], vladimir: [3, 97, 0], volibear: [40, 60, 0],
  warwick: [55, 45, 0], xayah: [97, 3, 0], xerath: [3, 97, 0], xinzhao: [95, 5, 0], yasuo: [97, 3, 0],
  yone: [55, 45, 0], yorick: [90, 10, 0], yunara: [95, 5, 0], yuumi: [3, 97, 0], zac: [10, 90, 0],
  zed: [97, 3, 0], zeri: [90, 10, 0], ziggs: [3, 97, 0], zilean: [3, 97, 0], zoe: [3, 97, 0], zyra: [3, 97, 0],
};

export interface DamageSplit {
  ad: number;
  ap: number;
  true: number;
  /** How many champions went into it. */
  counted: number;
}

/** A champion missing from the table (a brand new one): guessed from its client roles. */
function guess(roles: string[]): [number, number, number] {
  if (roles.includes('mage')) return [5, 95, 0];
  if (roles.includes('support') || roles.includes('tank')) return [25, 75, 0];
  return [90, 10, 0];
}

/** One champion's split, from the table or guessed from its roles. League Classic copies use the normal one. */
export function championSplit(alias: string, roles: string[]): [number, number, number] {
  return SPLITS[alias.toLowerCase().replace(/^jade_/, '')] ?? guess(roles);
}

/** A team's split: each champion counts the same, rounded so it adds up to 100. */
export function teamSplit(splits: [number, number, number][]): DamageSplit | null {
  if (!splits.length) return null;
  const sum = splits.reduce((a, s) => [a[0] + s[0], a[1] + s[1], a[2] + s[2]], [0, 0, 0]);
  const total = sum[0] + sum[1] + sum[2] || 1;
  const ad = Math.round((sum[0] / total) * 100);
  const tr = Math.round((sum[2] / total) * 100);
  return { ad, ap: 100 - ad - tr, true: tr, counted: splits.length };
}

/** A short tip for the side being looked at, or '' when it's balanced. */
export function damageTip(s: DamageSplit, enemy: boolean): string {
  if (s.counted < 3) return '';
  if (enemy) {
    if (s.ad >= 70) return 'Mostly AD. Armor goes a long way this game.';
    if (s.ap >= 70) return 'Mostly AP. Magic resist goes a long way this game.';
    if (s.true >= 20) return 'Lots of true damage. Health beats resists.';
    return '';
  }
  if (s.ad >= 75) return 'Heavy AD. One armor item can shut your team down.';
  if (s.ap >= 75) return 'Heavy AP. One MR item can shut your team down.';
  return '';
}
