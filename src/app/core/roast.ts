import { PostGame, PostPlayer, PostTeam } from './models';

/** One bit of post-game trash talk about something you did badly. */
export interface Roast {
  kind: 'cs' | 'fight' | 'damage' | 'deaths';
  /** Short stat for the chip, e.g. "4.1 CS/min". */
  stat: string;
  /** What counts as bad here, e.g. "Under 5.5 CS/min for a mid laner". */
  why: string;
  line: string;
}

type Vars = Record<string, string | number>;

const LINES: Record<string, string[]> = {
  cs: [
    'Your CS is trash. {cs} a minute, bro.',
    '{cs} CS/min. The minions are not gonna hit themselves, genius.',
    '{cs} CS/min. Caster minions out here living rent free because of you.',
    'Bro farmed like the gold was taxed at 90%. {cs} CS/min.',
    '{cs} CS/min. Last hitting is a skill issue and you have the issue.',
    '{cs} CS/min. Intro bots farm better than this, no cap.',
    'Whole waves dying under your tower and you just vibing. {cs} CS/min.',
  ],
  csJungle: [
    '{cs} CS/min in the jungle. Your camps respawned so often they started paying rent.',
    '{cs} CS/min. Gromp had a better game than you, fr.',
    'Free gold sitting in the jungle and you said nah. {cs} CS/min.',
    '{cs} CS/min. You were clearing camps or just walking past them to say hi?',
  ],
  fightAbsent: [
    '{kp}% kill participation. Were you even in this game or just spectating?',
    '{kp}% KP. Your team thought you disconnected, ngl.',
    'Fights happen at objectives. You happened somewhere else. {kp}% KP.',
    '{kp}% KP. Split pushing is a strategy. Hiding in a bush is not.',
    'Your team got {teamKills} kills and you showed up for {kp}% of them. Shy little guy.',
    '{kp}% KP. Bro was playing a single player game.',
  ],
  fightLost: [
    '{kda} KDA. You took every fight like it owed you money and lost every single one.',
    '{kda} KDA. You weren\'t the frontline, you were the appetizer.',
    '{kda} KDA. You showed up to the fights, which is honestly worse.',
    '{kda} KDA. Every fight you joined, the enemy team said thank you.',
  ],
  damage: [
    '{dmg}% of your team\'s damage. Your abilities were just for decoration huh.',
    '{dmg}% damage share. Were you hitting them with a pool noodle?',
    '{dmgK} damage in {min} minutes. That\'s a love tap a minute.',
    '{dmg}% damage share. The enemy took more damage from walking past your fountain.',
    '{dmg}% damage share. Did you forget which buttons do the damage?',
    '{dmg}% damage. Bro was doing ASMR on the enemy team.',
  ],
  damageSupport: [
    '{dmg}% damage share. Even for a support that\'s a shit poke game.',
    '{dmg}% of team damage. Your auto attacks were basically high fives.',
    '{dmg}% damage share. Supports are allowed to hit people too, you know.',
  ],
  deaths: [
    'Stop dying, little bitch. {deaths} deaths.',
    '{deaths} deaths. You die like a rat.',
    '{deaths} deaths. Running it down or just really bad at walking?',
    'You died {deaths} times. That\'s not a KDA, that\'s a donation drive.',
    '{deaths} deaths. The enemy team should split their gold with you.',
    '{deaths} deaths in {min} minutes. You fed them like an all-you-can-eat buffet.',
    '{deaths} deaths. Grey screen main.',
    '{deaths} deaths. Touch grass, then touch your keyboard less.',
  ],
};

const LANE_NAME: Record<string, string> = {
  top: 'a top laner',
  jungle: 'a jungler',
  mid: 'a mid laner',
  adc: 'an ADC',
  support: 'a support',
};

/** Too short to judge (and remakes): no roasting. */
const MIN_SECONDS = 10 * 60;

/**
 * Trash talk for what you did badly in a game, at most one line per kind.
 * Thresholds depend on your position (unknown in ARAM and other modes) and
 * the game's length; lines are picked by game id, so they stay put on reopen.
 */
export function roasts(game: PostGame): Roast[] {
  const team = game.teams.find((t) => t.isMine);
  const me = team?.players.find((p) => p.isMe);
  if (!team || !me || game.result === 'remake' || game.duration < MIN_SECONDS) return [];
  const min = game.duration / 60;
  const pos = me.position;
  const who = pos ? LANE_NAME[pos] : 'this mode';
  const kda = (me.kills + me.assists) / Math.max(1, me.deaths);
  const vars: Vars = {
    min: Math.round(min),
    cs: (me.cs / min).toFixed(1),
    kp: team.kills ? Math.round(((me.kills + me.assists) / team.kills) * 100) : 0,
    teamKills: team.kills,
    kda: kda.toFixed(2),
    deaths: me.deaths,
    dmg: Math.round(damageShare(me, team) * 100),
    dmgK: me.damage >= 1000 ? `${(me.damage / 1000).toFixed(1)}k` : me.damage,
  };
  const out: Roast[] = [];
  const add = (kind: Roast['kind'], pool: string, stat: string, why: string) =>
    out.push({ kind, stat, why, line: fill(pick(LINES[pool], game.gameId, pool), vars) });

  // CS only means something with a known lane, and supports don't farm.
  if (pos && pos !== 'support') {
    const bar = pos === 'jungle' ? 4.5 : 5.5;
    if (me.cs / min < bar) add('cs', pos === 'jungle' ? 'csJungle' : 'cs', `${vars['cs']} CS/min`, `Under ${bar} CS/min for ${who}`);
  }

  const deathsPer10 = (me.deaths / min) * 10;
  const aram = !pos && game.gameMode === 'ARAM';
  const [deathBar, per10Bar] = aram ? [12, 4.5] : [8, 3];
  const fed = me.deaths >= deathBar && deathsPer10 >= per10Bar;

  // Kill participation needs enough kills to mean anything.
  const kpBar = pos === 'jungle' || pos === 'support' ? 40 : aram ? 45 : 30;
  if (team.kills >= 8 && (vars['kp'] as number) < kpBar) {
    add('fight', 'fightAbsent', `${vars['kp']}% KP`, `Under ${kpBar}% kill participation for ${who}`);
  } else if (kda < 1 && me.deaths >= 5 && !fed) {
    add('fight', 'fightLost', `${vars['kda']} KDA`, 'Under 1.0 KDA');
  }

  const dmgBar = pos === 'support' ? 7 : pos === 'jungle' ? 12 : pos ? 15 : 13;
  if ((vars['dmg'] as number) < dmgBar) {
    add('damage', pos === 'support' ? 'damageSupport' : 'damage', `${vars['dmg']}% dmg`, `Under ${dmgBar}% of your team's damage for ${who}`);
  }

  if (fed) {
    add('deaths', 'deaths', `${me.deaths} deaths`, `${deathBar}+ deaths and ${per10Bar}+ every 10 minutes`);
  }
  return out;
}

function damageShare(me: PostPlayer, team: PostTeam): number {
  const total = team.players.reduce((a, p) => a + p.damage, 0);
  return total > 0 ? me.damage / total : 0;
}

/** A line from the pool, the same one every time for the same game. */
function pick(pool: string[], gameId: number, salt: string): string {
  let h = gameId | 0;
  for (const c of salt) h = Math.imul(h ^ c.charCodeAt(0), 0x5bd1e995) >>> 0;
  return pool[((h ^ (h >>> 15)) >>> 0) % pool.length];
}

function fill(line: string, vars: Vars): string {
  return line.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ''));
}
