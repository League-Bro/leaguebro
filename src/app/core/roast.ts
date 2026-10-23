import { PostGame, PostPlayer, PostTeam } from './models';

/** One bit of post-game trash talk about something done badly, or praise for something done well. */
export interface Roast {
  kind: 'cs' | 'fight' | 'damage' | 'deaths' | 'vision';
  /** A highlight (funny praise), shown in green; otherwise bad, in red. */
  good: boolean;
  /** Short stat for the chip, e.g. "4.1 CS/min". */
  stat: string;
  /** What triggered it, e.g. "Under 5.5 CS/min for a mid laner". */
  why: string;
  line: string;
}

type Vars = Record<string, string | number>;

/**
 * A line is built as `lead jab [tail]`: the lead states the stat, the jab is
 * the joke and the optional tail is a sign-off, so a pool of a few leads and
 * a dozen jabs makes hundreds of lines. `whole` lines are used as they are.
 * No swear words, and never call the player "bro" (the app is the Bro).
 */
interface Pool {
  leads: string[];
  jabs: string[];
  whole?: string[];
}

const BAD_TAILS = [
  'No cap.',
  'Respectfully.',
  'Just saying.',
  'Be better.',
  'We\'ll pretend this never happened.',
  'Tragic, honestly.',
  'Do with that what you will.',
  'Thoughts and prayers.',
  'It\'s giving Iron IV.',
  'The Bro has seen enough.',
  'Rough one, chief.',
  'Next game, maybe.',
];

const GOOD_TAILS = [
  'No notes.',
  'Chef\'s kiss.',
  'Respect.',
  'Keep cooking.',
  'Absolute cinema.',
  'The Bro approves.',
  'Frame it.',
  'Huge.',
  'Certified.',
  'Run it back.',
];

const POOLS: Record<string, Pool> = {
  // ---- Bad (red) ----
  cs: {
    leads: ['{cs} CS/min.', 'Only {cs} CS a minute.', '{cs} CS/min on {champ}.', '{csTotal} CS in {min} minutes.'],
    jabs: [
      'The minions are not gonna hit themselves, genius.',
      'Caster minions out here living rent free because of you.',
      'Last hitting is a skill issue and you have the issue.',
      'Intro bots farm better than this, no cap.',
      'You treated the minion wave like a petting zoo.',
      'Your lane opponent sends their thanks and their extra item.',
      'Gold doesn\'t grow on trees, it grows on minions. Hit them.',
      'That\'s not farming, that\'s community gardening.',
      'Did your mouse have a cooldown?',
      'The minions unionized and you\'re still their favorite boss.',
      'Every minion that walked past you lived a full, happy life.',
      'Your gold income is a lemonade stand in winter.',
      'The cannon minion went home and told its family about you.',
      'You missed more last hits than a stormtrooper.',
      'Minions were dying of old age in your lane.',
      'Your item build was mostly hopes and dreams.',
    ],
    whole: [
      'Your CS is trash. {cs} a minute, buddy.',
      'You farmed like the gold was taxed at 90%. {cs} CS/min.',
      'Whole waves dying under your tower and you just vibing. {cs} CS/min.',
      'POV: {min} minutes in and you still can\'t afford boots. {cs} CS/min.',
    ],
  },
  csAwful: {
    leads: ['{cs} CS/min.', 'A whole {cs} CS a minute.', '{csTotal} CS in {min} minutes.'],
    jabs: [
      'Were you playing with your monitor off?',
      'That\'s support numbers. Are you lost?',
      'At this point just buy a support item and commit to the bit.',
      'Genuinely impressive. Like, how?',
      'You\'re not behind on farm, you\'re in a different game.',
      'The minions thought you were a ward.',
      'Somewhere a farming tutorial is crying.',
      'Your wallet filed for bankruptcy around minute ten.',
    ],
    whole: ['The cannon minion has more gold than you. {cs} CS/min.'],
  },
  csJungle: {
    leads: ['{cs} CS/min in the jungle.', '{cs} CS/min.', 'Only {cs} CS a minute, jungler.', '{csTotal} CS in {min} minutes of jungling.'],
    jabs: [
      'Your camps respawned so often they started paying rent.',
      'Gromp had a better game than you, fr.',
      'Were you clearing camps or just walking past them to say hi?',
      'Your Smite was a decoration.',
      'The enemy jungler farmed your camps and left a thank-you note.',
      'You were a tourist in your own jungle.',
      'The Krugs are still waiting for you to show up.',
      'Full clear? You barely did a half clear.',
      'The Raptors had a group chat about you. It wasn\'t nice.',
      'Your jungle had more wildlife than a nature documentary, all of it alive.',
      'Scuttle crab got away again, didn\'t it?',
    ],
    whole: ['Free gold sitting in the jungle and you said nah. {cs} CS/min.'],
  },
  fightAbsent: {
    leads: ['{kp}% KP.', '{kp}% kill participation.', 'Your team got {teamKills} kills and you were in {kp}% of them.'],
    jabs: [
      'Were you even in this game or just spectating?',
      'Your team thought you disconnected, ngl.',
      'Split pushing is a strategy. Hiding in a bush is not.',
      'You were playing a single player game.',
      'Your team was fighting 4v5 and you were fighting the wave.',
      'Main character energy, background extra participation.',
      'You got ghosted by every teamfight.',
      'Next time bring a map, the fights were over there.',
      'Your teammates filed a missing person report.',
      'Hide and seek champion, League of Legends spectator.',
      'You showed up to the fights like a group project partner.',
      'The fights had a guest list and you weren\'t on it.',
      'You were technically in the game. Technically.',
    ],
    whole: [
      'Fights happen at objectives. You happened somewhere else. {kp}% KP.',
      'Your team got {teamKills} kills and you showed up for {kp}% of them. Shy little guy.',
    ],
  },
  fightLost: {
    leads: ['{kda} KDA.', 'A {kda} KDA.', '{kills}/{deaths}/{assists}.'],
    jabs: [
      'You took every fight like it owed you money and lost every single one.',
      'You weren\'t the frontline, you were the appetizer.',
      'You showed up to the fights, which is honestly worse.',
      'Every fight you joined, the enemy team said thank you.',
      'You fought like your keyboard was unplugged.',
      'Confidence of a Challenger, results of an Iron IV.',
      'You flashed in, they flashed you a grey screen.',
      'Every fight was a jumpscare and you were the victim.',
      'You\'re in the enemy team\'s highlight reel. As the highlight.',
      'You brought a spoon to a sword fight.',
      'Bold plays, wrong outcomes.',
    ],
  },
  damage: {
    leads: ['{dmg}% damage share.', '{dmg}% of your team\'s damage.', '{dmgK} damage on {champ}.', 'Only {dmg}% of the damage.'],
    jabs: [
      'Your abilities were just for decoration, huh.',
      'Were you hitting them with a pool noodle?',
      'The enemy took more damage from walking past your fountain.',
      'Did you forget which buttons do the damage?',
      'You were doing ASMR on the enemy team.',
      'You did the damage of a stiff breeze.',
      'That\'s not a champion, that\'s a ward with legs.',
      'Were your abilities on cooldown the whole game?',
      'Your {champ} was set to gentle mode.',
      'Ask Riot for a refund.',
      'Your spells were hitting minions and vibes.',
      'The enemy team thought you were a cosmetic.',
      'You tickled them. Aggressively.',
      'Your combo was mostly emotes.',
    ],
    whole: [
      '{dmgK} damage in {min} minutes. That\'s a love tap a minute.',
      '{dmgK} damage in {min} minutes. The enemies thought you were the support.',
    ],
  },
  damageSupport: {
    leads: ['{dmg}% damage share.', '{dmg}% of team damage.', '{dmgK} damage from the support slot.'],
    jabs: [
      'Even for a support, that poke game was tragic.',
      'Your auto attacks were basically high fives.',
      'Supports are allowed to hit people too, you know.',
      'The ward did more damage than you, and it\'s a ward.',
      'You were a cheerleader, not a support.',
      'Even enchanters poke sometimes, bestie.',
      'Your support item was doing all the work.',
      'You hit them with the power of friendship.',
    ],
  },
  deaths: {
    leads: ['{deaths} deaths.', '{deaths} deaths in {min} minutes.', 'Died {deaths} times.', '{deaths} deaths on {champ}.'],
    jabs: [
      'You die like a rat.',
      'Running it down or just really bad at walking?',
      'That\'s not a KDA, that\'s a donation drive.',
      'The enemy team should split their gold with you.',
      'You fed them like an all-you-can-eat buffet.',
      'Grey screen main.',
      'Touch grass, then touch your keyboard less.',
      'Your respawn timer got more screen time than you did.',
      'You were the enemy team\'s favorite ATM.',
      'You died like it was a side hustle.',
      'Every death was a little gift with a bow on it.',
      'Were you speedrunning the death recap?',
      'Fountain to grave pipeline.',
      'That champion deserves a restraining order against you.',
      'The enemy team should put you on their payroll.',
      'You know the fountain heals you, right? Stay there longer.',
      'Your death recap is a novel now.',
    ],
    whole: ['Stop dying, little buddy. {deaths} deaths.'],
  },
  deathsAwful: {
    leads: ['{deaths} deaths.', '{deaths} deaths in {min} minutes.', 'Died {deaths} times.'],
    jabs: [
      'That\'s not inting, that\'s a lifestyle.',
      'The enemy got so much gold off you they paid off their student loans.',
      'Genuinely, uninstall and go outside.',
      'The death recap needs a scroll bar now.',
      'Are you okay? Blink twice if your little brother is playing.',
      'The enemy team is naming their firstborn after you.',
      'At some point it stops being a game and starts being a charity.',
    ],
  },
  vision: {
    leads: ['{vision} vision score.', '{vision} vision.', 'A {vision} vision score as a support.'],
    jabs: [
      'You bought a support item and forgot about the wards, huh?',
      'The map was dark and so is your future.',
      'Wards are free. Free!',
      'Your team played the whole game with the lights off.',
      'Even Lee Sin had better vision than your team.',
      'Your wards are still in your inventory, aren\'t they?',
      'The enemy jungler sends their thanks.',
    ],
  },

  // ---- Highlights (green, funny praise) ----
  csGood: {
    leads: ['{cs} CS/min.', '{csTotal} CS in {min} minutes.', '{cs} CS/min on {champ}.'],
    jabs: [
      'Minions saw you coming and lined up to pay their taxes.',
      'Farming so clean the wave should be leaving you a tip.',
      'Certified farmer. Stardew Valley wants you on the cover.',
      'Every last hit, on time, like a Swiss watch.',
      'Your gold income has its own zip code.',
      'That\'s not farming, that\'s agribusiness.',
      'The minions respect you. Honestly, so do we.',
      'Your wallet is thicker than the enemy\'s frontline.',
      'Full build by minute 25, probably.',
    ],
  },
  fightGood: {
    leads: ['{kp}% KP.', '{kp}% kill participation.', 'In on {kp}% of your team\'s kills.'],
    jabs: [
      'Every fight had your name on the guest list.',
      'Teamwork makes the dream work and you were the dream.',
      'If there was a fight, you were in it. Love that for you.',
      'You showed up for your team like a real one.',
      'Group chat MVP, but for teamfights.',
      'Everywhere at once. Are there two of you?',
      'Your team never had to fight alone.',
    ],
  },
  kdaGood: {
    leads: ['{kda} KDA.', 'A {kda} KDA.', '{kills}/{deaths}/{assists}.'],
    jabs: [
      'Absolutely cooking. Somebody get this player a chef\'s hat.',
      'Clean. Like, freshly-ironed-shirt clean.',
      'Screenshot this and frame it.',
      'The enemy team is going to be thinking about you tonight.',
      'Main character energy, and you earned it.',
      'Built different, played different.',
      'That\'s a highlight reel, not a scoreboard.',
      'The enemy team wants a rematch. They won\'t get one.',
    ],
  },
  damageGood: {
    leads: ['{dmg}% damage share.', '{dmg}% of the team\'s damage.', '{dmgK} damage on {champ}.'],
    jabs: [
      'You carried harder than a moving truck.',
      'Your teammates owe you dinner.',
      'The enemy healer needs a vacation after that.',
      'You said "I got this" and you meant it.',
      'Pure, uncut menace. Beautiful.',
      'Your {champ} was in full beast mode.',
      'The enemy team felt that one in their soul.',
      'Somebody call the fire department, you were on fire.',
    ],
  },
  damageGoodSupport: {
    leads: ['{dmg}% damage as a support.', '{dmgK} damage from the support slot.', '{dmg}% damage share.'],
    jabs: [
      'Your ADC is impressed and a little scared.',
      'Support by role, carry by choice.',
      'Supports can carry, and you just proved it.',
      'Healing is nice, but have you tried winning fights yourself? You did.',
      'The enemy bot lane wants to know what happened.',
    ],
  },
  deathsGood: {
    leads: ['{deathsText}.', 'Only {deathsText}.', '{deathsText} in {min} minutes.'],
    jabs: [
      'Untouchable. Were you even on the same map as their team?',
      'The death recap has nothing to say about you.',
      'You protected that gold like it was your last slice of pizza.',
      'Slippery like a bar of soap.',
      'The enemy team spent the whole game trying and failing.',
      'Survival instincts of a cockroach, the good kind.',
      'Your respawn timer forgot what you look like.',
      'Plot armor, activated.',
    ],
  },
  visionGood: {
    leads: ['{vision} vision score.', '{vision} vision.'],
    jabs: [
      'You saw it all. Basically a psychic.',
      'Lighting up the map like it\'s the holidays.',
      'Your wards had better map awareness than most players.',
      'Nothing happened on this map without you knowing.',
      'The enemy jungler had nowhere to hide.',
      'Map hack energy, all legal.',
    ],
  },
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
/** Highlights shown at most, so a good game isn't a wall of green. */
const MAX_GOOD = 3;

/**
 * Trash talk for one player of `team`: what they did badly, then up to
 * `MAX_GOOD` highlights praising what they did well. Thresholds depend
 * on their position (unknown in ARAM and other modes) and the game's length.
 * `champ` is the champion's name, for lines that use it.
 */
export function roasts(game: PostGame, team: PostTeam, me: PostPlayer, champ: string): Roast[] {
  if (game.result === 'remake' || game.duration < MIN_SECONDS) return [];
  const min = game.duration / 60;
  const pos = me.position;
  const who = pos ? LANE_NAME[pos] : 'this mode';
  const aram = !pos && game.gameMode === 'ARAM';
  const kda = (me.kills + me.assists) / Math.max(1, me.deaths);
  const csMin = me.cs / min;
  const kp = team.kills ? Math.round(((me.kills + me.assists) / team.kills) * 100) : 0;
  const dmg = Math.round(damageShare(me, team) * 100);
  const vpm = me.vision / min;
  const vars: Vars = {
    champ,
    min: Math.round(min),
    cs: csMin.toFixed(1),
    csTotal: me.cs,
    kills: me.kills,
    assists: me.assists,
    kp,
    teamKills: team.kills,
    kda: kda.toFixed(2),
    deaths: me.deaths,
    deathsText: `${me.deaths} ${me.deaths === 1 ? 'death' : 'deaths'}`,
    dmg,
    dmgK: me.damage >= 1000 ? `${(me.damage / 1000).toFixed(1)}k` : me.damage,
    vision: me.vision,
  };
  const bad: Roast[] = [];
  const good: Roast[] = [];
  const add = (into: Roast[], kind: Roast['kind'], pool: string, stat: string, why: string) =>
    into.push({
      kind,
      good: into === good,
      stat,
      why,
      line: fill(pickLine(pool, `${game.gameId}:${team.teamId}:${me.championId}:${pool}`, into === good), vars),
    });

  // CS only means something with a known lane, and supports don't farm.
  if (pos && pos !== 'support') {
    const jungle = pos === 'jungle';
    const [low, high] = jungle ? [4.5, 6.5] : [5.5, 8];
    if (csMin < low) {
      const pool = jungle ? 'csJungle' : csMin < 3.5 ? 'csAwful' : 'cs';
      add(bad, 'cs', pool, `${vars['cs']} CS/min`, `Under ${low} CS/min for ${who}`);
    } else if (csMin >= high) {
      add(good, 'cs', 'csGood', `${vars['cs']} CS/min`, `${high}+ CS/min for ${who}`);
    }
  }

  const deathsPer10 = (me.deaths / min) * 10;
  const [deathBar, per10Bar, awfulBar] = aram ? [12, 4.5, 16] : [8, 3, 13];
  const fed = me.deaths >= deathBar && deathsPer10 >= per10Bar;

  // Kill participation needs enough kills to mean anything.
  const kpBar = pos === 'jungle' || pos === 'support' ? 40 : aram ? 45 : 30;
  if (team.kills >= 8 && kp < kpBar) {
    add(bad, 'fight', 'fightAbsent', `${kp}% KP`, `Under ${kpBar}% kill participation for ${who}`);
  } else if (kda < 1 && me.deaths >= 5 && !fed) {
    add(bad, 'fight', 'fightLost', `${vars['kda']} KDA`, 'Under 1.0 KDA');
  } else if (kda >= 6 && me.kills + me.assists >= 10) {
    add(good, 'fight', 'kdaGood', `${vars['kda']} KDA`, '6+ KDA');
  } else if (team.kills >= 10 && kp >= 65) {
    add(good, 'fight', 'fightGood', `${kp}% KP`, '65%+ kill participation');
  }

  const support = pos === 'support';
  const [dmgLow, dmgHigh] = support ? [7, 18] : pos === 'jungle' ? [12, 28] : pos ? [15, 30] : [13, 28];
  if (dmg < dmgLow) {
    add(bad, 'damage', support ? 'damageSupport' : 'damage', `${dmg}% dmg`, `Under ${dmgLow}% of the team's damage for ${who}`);
  } else if (dmg >= dmgHigh) {
    add(good, 'damage', support ? 'damageGoodSupport' : 'damageGood', `${dmg}% dmg`, `${dmgHigh}%+ of the team's damage for ${who}`);
  }

  if (fed) {
    const pool = me.deaths >= awfulBar ? 'deathsAwful' : 'deaths';
    add(bad, 'deaths', pool, `${me.deaths} deaths`, `${deathBar}+ deaths and ${per10Bar}+ every 10 minutes`);
  } else if (min >= 20 && me.deaths <= (aram ? 3 : 1)) {
    add(good, 'deaths', 'deathsGood', vars['deathsText'] as string, `${aram ? 3 : 1} or fewer deaths in a 20+ minute game`);
  }

  // Vision only counts for the roles that are meant to ward.
  if (support && vpm < 1.2) {
    add(bad, 'vision', 'vision', `${me.vision} vision`, `Under 1.2 vision score a minute for ${who}`);
  } else if (pos && vpm >= (support ? 2.2 : 1.3)) {
    add(good, 'vision', 'visionGood', `${me.vision} vision`, `${support ? 2.2 : 1.3}+ vision score a minute for ${who}`);
  }

  return [...bad, ...good.slice(0, MAX_GOOD)];
}

function damageShare(me: PostPlayer, team: PostTeam): number {
  const total = team.players.reduce((a, p) => a + p.damage, 0);
  return total > 0 ? me.damage / total : 0;
}

/**
 * The line each game got, and each pool's recent jabs, so a reopened game
 * keeps its lines and new games don't repeat a joke soon. Lives in
 * localStorage; without it lines are just random.
 */
interface LineMemory {
  /** Built line (before the stats are filled in) per game, player and pool. */
  picks: Record<string, string>;
  /** Recent jab ids per pool: "j3" for `jabs[3]`, "w1" for `whole[1]`. */
  recent: Record<string, string[]>;
}
const MEMORY_KEY = 'leaguebro.roasts';
/** Remembered picks; the oldest go first past this. */
const MAX_PICKS = 500;

function pickLine(name: string, key: string, good: boolean): string {
  const pool = POOLS[name];
  const mem = loadMemory();
  const known = mem.picks[key];
  if (typeof known === 'string') return known;
  // The jab is the joke people remember: skip the last ~75% used in this pool.
  const ids = [...pool.jabs.map((_, i) => `j${i}`), ...(pool.whole ?? []).map((_, i) => `w${i}`)];
  const recent = (mem.recent[name] ?? []).filter((id) => ids.includes(id)).slice(-Math.floor(ids.length * 0.75));
  const id = any(ids.filter((i) => !recent.includes(i))) ?? ids[0];
  const at = Number(id.slice(1));
  let line = id[0] === 'w' ? pool.whole![at] : `${any(pool.leads)} ${pool.jabs[at]}`;
  if (id[0] === 'j' && Math.random() < 0.35) line += ` ${any(good ? GOOD_TAILS : BAD_TAILS)}`;
  mem.picks[key] = line;
  mem.recent[name] = [...recent, id];
  const keys = Object.keys(mem.picks);
  for (const k of keys.slice(0, Math.max(0, keys.length - MAX_PICKS))) delete mem.picks[k];
  saveMemory(mem);
  return line;
}

function any<T>(list: T[]): T {
  return list[Math.floor(Math.random() * list.length)];
}

function loadMemory(): LineMemory {
  try {
    const m = JSON.parse(localStorage.getItem(MEMORY_KEY) ?? '') as LineMemory;
    if (m && typeof m.picks === 'object' && typeof m.recent === 'object') return m;
  } catch {
    // Missing or unreadable: start fresh.
  }
  return { picks: {}, recent: {} };
}

function saveMemory(m: LineMemory): void {
  try {
    localStorage.setItem(MEMORY_KEY, JSON.stringify(m));
    localStorage.removeItem('leaguebro.roastLines'); // the old format, before lines were built from parts
  } catch {
    // Storage off or full: lines just won't be remembered.
  }
}

function fill(line: string, vars: Vars): string {
  return line.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ''));
}
