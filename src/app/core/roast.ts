import { PostGame, PostPlayer, PostTeam } from './models';

/** One bit of post-game trash talk: about something done badly, or a backhanded compliment. */
export interface Roast {
  kind: 'cs' | 'fight' | 'damage' | 'deaths' | 'vision';
  /** A highlight (still a roast), shown in green; otherwise bad, in red. */
  good: boolean;
  /** Short stat for the chip, e.g. "4.1 CS/min". */
  stat: string;
  /** What triggered it, e.g. "Under 5.5 CS/min for a mid laner". */
  why: string;
  line: string;
}

type Vars = Record<string, string | number>;

const LINES: Record<string, string[]> = {
  // ---- Bad (red) ----
  cs: [
    'Your CS is trash. {cs} a minute, bro.',
    '{cs} CS/min. The minions are not gonna hit themselves, genius.',
    '{cs} CS/min. Caster minions out here living rent free because of you.',
    'Bro farmed like the gold was taxed at 90%. {cs} CS/min.',
    '{cs} CS/min. Last hitting is a skill issue and you have the issue.',
    '{cs} CS/min. Intro bots farm better than this, no cap.',
    'Whole waves dying under your tower and you just vibing. {cs} CS/min.',
    '{cs} CS/min. You treated the minion wave like a petting zoo.',
    '{cs} CS/min. Your lane opponent sends their thanks and their extra item.',
    '{cs} CS/min on {champ}. Gold doesn\'t grow on trees, it grows on minions. Hit them.',
    '{cs} CS/min. That\'s not farming, that\'s community gardening.',
    '{cs} CS/min. Did your mouse have a cooldown?',
    'POV: {min} minutes in and broke as hell. {cs} CS/min.',
    '{cs} CS/min. The minions unionized and you\'re still their favorite boss.',
    '{cs} CS/min. Every minion that walked past you lived a full, happy life.',
  ],
  csAwful: [
    '{cs} CS/min. Were you playing with your monitor off?',
    '{cs} CS/min. That\'s support numbers. Are you lost?',
    'The cannon minion has more gold than you. {cs} CS/min.',
    '{cs} CS/min. At this point just buy a support item and commit to the bit.',
    '{cs} CS/min. Genuinely impressive. Like, how?',
    '{cs} CS/min. You\'re not behind on farm, you\'re in a different game.',
  ],
  csJungle: [
    '{cs} CS/min in the jungle. Your camps respawned so often they started paying rent.',
    '{cs} CS/min. Gromp had a better game than you, fr.',
    'Free gold sitting in the jungle and you said nah. {cs} CS/min.',
    '{cs} CS/min. Were you clearing camps or just walking past them to say hi?',
    '{cs} CS/min. Your Smite was a decoration.',
    '{cs} CS/min. The enemy jungler farmed your camps and left a thank-you note.',
    '{cs} CS/min. Bro was a tourist in their own jungle.',
    '{cs} CS/min. The Krugs are still waiting for you to show up.',
    '{cs} CS/min. Full clear? You barely did a half clear.',
  ],
  fightAbsent: [
    '{kp}% kill participation. Were you even in this game or just spectating?',
    '{kp}% KP. Your team thought you disconnected, ngl.',
    'Fights happen at objectives. You happened somewhere else. {kp}% KP.',
    '{kp}% KP. Split pushing is a strategy. Hiding in a bush is not.',
    'Your team got {teamKills} kills and you showed up for {kp}% of them. Shy little guy.',
    '{kp}% KP. Bro was playing a single player game.',
    '{kp}% KP. Your team was fighting 4v5 and you were fighting the wave.',
    '{kp}% kill participation. Main character energy, background extra participation.',
    '{kp}% KP. Bro got ghosted by every teamfight.',
    '{kp}% KP. Next time bring a map, the fights were over there.',
    '{kp}% KP. Your teammates filed a missing person report.',
    '{kp}% KP. Hide and seek champion, League of Legends loser.',
  ],
  fightLost: [
    '{kda} KDA. You took every fight like it owed you money and lost every single one.',
    '{kda} KDA. You weren\'t the frontline, you were the appetizer.',
    '{kda} KDA. You showed up to the fights, which is honestly worse.',
    '{kda} KDA. Every fight you joined, the enemy team said thank you.',
    '{kda} KDA. You fought like your keyboard was unplugged.',
    '{kda} KDA. Confidence of a Challenger, results of an Iron IV.',
    '{kda} KDA. You flashed in, they flashed you a grey screen.',
    '{kda} KDA. Every fight was a jumpscare and you were the victim.',
    '{kda} KDA. You\'re in the enemy team\'s highlight reel. As the highlight.',
  ],
  damage: [
    '{dmg}% of your team\'s damage. Your abilities were just for decoration huh.',
    '{dmg}% damage share. Were you hitting them with a pool noodle?',
    '{dmgK} damage in {min} minutes. That\'s a love tap a minute.',
    '{dmg}% damage share. The enemy took more damage from walking past your fountain.',
    '{dmg}% damage share. Did you forget which buttons do the damage?',
    '{dmg}% damage. Bro was doing ASMR on the enemy team.',
    '{dmg}% damage share. You did the damage of a stiff breeze.',
    '{dmgK} damage. That\'s not a champion, that\'s a ward with legs.',
    '{dmg}% damage share. Were your abilities on cooldown the whole game?',
    '{dmg}% damage. Your {champ} was set to gentle mode.',
    '{dmg}% damage share on {champ}. Ask Riot for a refund.',
    '{dmgK} damage in {min} minutes. The enemies thought you were the support.',
    '{dmg}% damage share. Your spells were hitting minions and vibes.',
  ],
  damageSupport: [
    '{dmg}% damage share. Even for a support that\'s a shit poke game.',
    '{dmg}% of team damage. Your auto attacks were basically high fives.',
    '{dmg}% damage share. Supports are allowed to hit people too, you know.',
    '{dmg}% damage. The ward did more damage than you, and it\'s a ward.',
    '{dmgK} damage. You were a cheerleader, not a support.',
    '{dmg}% damage share. Even enchanters poke sometimes, bestie.',
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
    '{deaths} deaths. Your respawn timer got more screen time than you did.',
    '{deaths} deaths. You were the enemy team\'s favorite ATM.',
    '{deaths} deaths. Bro died like it was a side hustle.',
    '{deaths} deaths. Every death was a little gift with a bow on it.',
    '{deaths} deaths. Were you speedrunning the death recap?',
    '{deaths} deaths. Fountain to grave pipeline.',
    '{deaths} deaths on {champ}. That champion deserves a restraining order against you.',
  ],
  deathsAwful: [
    '{deaths} deaths. That\'s not inting, that\'s a lifestyle.',
    '{deaths} deaths. The enemy got so much gold off you they paid off their student loans.',
    '{deaths} deaths. Genuinely, uninstall and go outside.',
    '{deaths} deaths. The death recap needs a scroll bar now.',
    '{deaths} deaths. Are you okay? Blink twice if your little brother is playing.',
  ],
  vision: [
    '{vision} vision score. You bought a support item and forgot about the wards, huh?',
    '{vision} vision. The map was dark and so is your future.',
    '{vision} vision score. Wards are free, bro. Free.',
    '{vision} vision. Your team played the whole game with the lights off.',
    '{vision} vision score. Even Lee Sin had better vision than your team.',
  ],

  // ---- Highlights (green, still roasts) ----
  csGood: [
    '{cs} CS/min. Nice farm. Too bad you can\'t farm a personality.',
    '{cs} CS/min. You loved those minions more than you\'ve ever loved anyone.',
    '{cs} CS/min. Stardew Valley is calling, they want their farmer back.',
    '{cs} CS/min. Okay farmer, now do something with the gold.',
    '{cs} CS/min. Respect, but touch grass, not just minions.',
    '{cs} CS/min. Your last hits were cleaner than your room.',
    '{cs} CS/min. The minions fear you. Nobody else does, but the minions do.',
  ],
  fightGood: [
    '{kp}% KP. In every fight like a nosy neighbor.',
    '{kp}% kill participation. Can\'t let anyone have a moment without you, huh?',
    '{kp}% KP. Bro had FOMO about every single fight.',
    '{kp}% KP. You were everywhere. Clingy, but effective.',
    '{kp}% KP. Main character syndrome, but it actually worked.',
  ],
  kdaGood: [
    '{kda} KDA. Okay, who did you pay to play this one for you?',
    '{kda} KDA. Clean. Suspiciously clean. Show us your hands.',
    '{kda} KDA. Screenshot this, it\'s not happening again.',
    '{kda} KDA. Wow, you weren\'t a burden for once.',
    '{kda} KDA. Even a broken clock is right twice a day.',
    '{kda} KDA. Who are you and what did you do with the real you?',
  ],
  damageGood: [
    '{dmg}% of the team\'s damage. You carried four backpacks this game.',
    '{dmg}% damage share. Your teammates should be paying you rent.',
    '{dmgK} damage. Calm down, Rambo, it\'s a video game.',
    '{dmg}% damage. Bro said "I am the team" and meant it.',
    '{dmg}% damage share. Now do it every game, coward.',
    '{dmg}% damage share. Your team was just there for moral support.',
  ],
  damageGoodSupport: [
    '{dmg}% damage as a support. Your ADC is filing a complaint for kill stealing.',
    '{dmg}% damage share. Support in name only, menace in practice.',
    '{dmg}% damage. Bro picked support just to get away with this.',
  ],
  deathsGood: [
    '{deathsText}. Coward behavior, but it worked.',
    'Only {deathsText}. Were you hiding behind your tower the whole game?',
    '{deathsText}. Scared money don\'t make money, but okay.',
    '{deathsText}. You played like you had a curfew to make.',
    '{deathsText}. Survival instinct elite, courage debatable.',
    '{deathsText} in {min} minutes. Somebody\'s mom said no dying today.',
  ],
  visionGood: [
    '{vision} vision score. You saw everything except your own flaws.',
    '{vision} vision. Lighthouse behavior. Respect.',
    '{vision} vision score. Your wards had better map awareness than your team.',
    '{vision} vision. Bro was running a whole surveillance state.',
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
/** Highlights shown at most, so a good game isn't a wall of green. */
const MAX_GOOD = 3;

/**
 * Trash talk for one player of `team`: what they did badly, then up to
 * `MAX_GOOD` backhanded highlights for what they did well. Thresholds depend
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
      line: fill(pickLine(pool, `${game.gameId}:${team.teamId}:${me.championId}:${pool}`), vars),
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
 * Which line each game got, and each pool's recent picks, so a reopened game
 * keeps its lines and new games don't repeat the last few. Lives in
 * localStorage; without it lines are just random.
 */
interface LineMemory {
  picks: Record<string, number>;
  recent: Record<string, number[]>;
}
const MEMORY_KEY = 'leaguebro.roastLines';
/** Remembered picks; the oldest go first past this. */
const MAX_PICKS = 500;

function pickLine(pool: string, key: string): string {
  const lines = LINES[pool];
  const mem = loadMemory();
  const known = mem.picks[key];
  if (known !== undefined && known < lines.length) return lines[known];
  // Skip the most recent ~three quarters of the pool, so lines come round rarely.
  const recent = (mem.recent[pool] ?? []).slice(-Math.floor(lines.length * 0.75));
  const fresh = lines.map((_, i) => i).filter((i) => !recent.includes(i));
  const at = fresh[Math.floor(Math.random() * fresh.length)] ?? 0;
  mem.picks[key] = at;
  mem.recent[pool] = [...recent, at];
  const keys = Object.keys(mem.picks);
  for (const k of keys.slice(0, Math.max(0, keys.length - MAX_PICKS))) delete mem.picks[k];
  saveMemory(mem);
  return lines[at];
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
  } catch {
    // Storage off or full: lines just won't be remembered.
  }
}

function fill(line: string, vars: Vars): string {
  return line.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ''));
}
