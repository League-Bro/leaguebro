/**
 * What the enemy team is built around, and which picks answer it, for the
 * champ select pick suggestions. Hand-made from how kits work (like
 * `damage.ts`), not measured: it only nudges OP.GG's numbers, never replaces
 * them. Keyed by lowercase client alias.
 */

export type EnemyTrait = 'tanks' | 'dive' | 'poke' | 'squishy';

/** Champions whose kits go through tanks: % health or true damage, or they shred armor or magic resist. */
const SHREDS_TANKS = new Set([
  'vayne', 'kogmaw', 'fiora', 'gwen', 'brand', 'varus', 'trundle', 'kayle', 'masteryi', 'belveth', 'camille',
  'chogath', 'lillia', 'kindred', 'olaf', 'darius', 'garen', 'aphelios', 'zeri', 'sylas', 'mordekaiser', 'drmundo',
  'kaisa', 'azir', 'cassiopeia', 'vladimir', 'ryze', 'aurelionsol', 'yone', 'gragas',
]);

/** Champions that stop divers: point-and-click or instant CC, self-peel or disengage. */
const STOPS_DIVE = new Set([
  'lissandra', 'malzahar', 'anivia', 'galio', 'janna', 'lulu', 'taric', 'braum', 'poppy', 'vex', 'annie', 'morgana',
  'zilean', 'renata', 'milio', 'maokai', 'jax', 'swain', 'thresh', 'rell', 'ornn', 'fiddlesticks', 'kayle', 'zyra',
  'cassiopeia', 'syndra', 'orianna', 'ashe', 'jinx', 'caitlyn', 'shen', 'malphite', 'warwick', 'singed', 'teemo',
]);

/** Champions that start fights from far away, which poke teams can't keep off. */
const HARD_ENGAGE = new Set([
  'malphite', 'leona', 'nautilus', 'amumu', 'sejuani', 'zac', 'rell', 'alistar', 'jarvaniv', 'hecarim', 'vi',
  'rakan', 'diana', 'kennen', 'ornn', 'gragas', 'sion', 'monkeyking', 'skarner', 'nocturne', 'galio', 'rammus',
  'camille', 'kled', 'xinzhao', 'irelia', 'yasuo', 'yone', 'akali', 'katarina', 'fizz', 'kassadin', 'pyke', 'maokai',
]);

/** Champions that delete squishy targets before they can act. */
const BURSTS_SQUISHIES = new Set([
  'zed', 'talon', 'khazix', 'rengar', 'leblanc', 'fizz', 'evelynn', 'qiyana', 'naafiri', 'syndra', 'veigar', 'annie',
  'akali', 'katarina', 'pyke', 'nocturne', 'kayn', 'diana', 'ekko', 'kassadin', 'shaco', 'graves', 'pantheon',
  'brand', 'zoe', 'lux', 'xerath', 'draven', 'samira', 'nidalee', 'elise',
]);

/** Enemy divers that aren't client "assassins": they jump on your backline. */
const DIVERS = new Set([
  'vi', 'jarvaniv', 'hecarim', 'irelia', 'camille', 'diana', 'xinzhao', 'wukong', 'monkeyking', 'rengar', 'khazix',
  'nocturne', 'kled', 'yasuo', 'yone', 'briar', 'leesin', 'reksai', 'pantheon', 'ambessa', 'riven', 'gwen', 'malphite',
  'leona', 'nautilus', 'rell', 'rakan', 'amumu', 'zac', 'sejuani', 'skarner',
]);

/** Enemies that fight from range with long skillshots or siege. */
const POKE = new Set([
  'xerath', 'jayce', 'zoe', 'ziggs', 'velkoz', 'lux', 'varus', 'ezreal', 'nidalee', 'hwei', 'corki', 'karma',
  'caitlyn', 'mel', 'senna', 'jhin', 'syndra', 'viktor', 'azir', 'orianna', 'heimerdinger', 'zyra', 'brand', 'kennen',
  'kogmaw', 'aurelionsol', 'smolder', 'quinn', 'teemo',
]);

export interface CompChamp {
  alias: string;
  roles: string[];
}

function key(alias: string): string {
  return alias.toLowerCase().replace(/^jade_/, '');
}

/** What the enemy picks so far add up to. Needs 2 of a kind, and 3 picks with no tank to call them squishy. */
export function enemyTraits(enemies: CompChamp[]): { trait: EnemyTrait; count: number }[] {
  const count = (f: (c: CompChamp, k: string) => boolean) => enemies.filter((c) => f(c, key(c.alias))).length;
  const tanks = count((c) => c.roles[0] === 'tank');
  const dive = count((c, k) => c.roles[0] === 'assassin' || DIVERS.has(k));
  const poke = count((_, k) => POKE.has(k));
  const out: { trait: EnemyTrait; count: number }[] = [];
  if (tanks >= 2) out.push({ trait: 'tanks', count: tanks });
  if (dive >= 2) out.push({ trait: 'dive', count: dive });
  if (poke >= 2) out.push({ trait: 'poke', count: poke });
  // Bruisers like Wukong list "tank" second; only real tanks keep a team from being squishy.
  if (enemies.length >= 3 && tanks === 0) out.push({ trait: 'squishy', count: enemies.length });
  return out;
}

/** The tag a pick gets for answering one enemy trait, or '' if it doesn't. */
export function answers(trait: EnemyTrait, alias: string): string {
  const k = key(alias);
  switch (trait) {
    case 'tanks':
      return SHREDS_TANKS.has(k) ? 'Shreds tanks' : '';
    case 'dive':
      return STOPS_DIVE.has(k) ? 'Stops dive' : '';
    case 'poke':
      return HARD_ENGAGE.has(k) ? 'Engages on poke' : '';
    case 'squishy':
      return BURSTS_SQUISHIES.has(k) ? 'Bursts squishies' : '';
  }
}

export const TRAIT_LABELS: Record<EnemyTrait, string> = {
  tanks: 'tanky',
  dive: 'dive',
  poke: 'poke',
  squishy: 'squishy',
};
