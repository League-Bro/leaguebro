import { PostGame, PostPlayer, PostTeam } from './models';

/** One bit of post-game trash talk about something done badly, or praise for something done well. */
export interface Roast {
  kind: 'cs' | 'lane' | 'fight' | 'kills' | 'damage' | 'deaths' | 'vision' | 'items' | 'objectives' | 'game';
  /** A highlight (funny praise), shown in green; otherwise bad, in red. */
  good: boolean;
  /** Short stat for the chip, e.g. "4.1 CS/min". */
  stat: string;
  /** What triggered it, e.g. "Under 5.5 CS/min for a mid laner". */
  why: string;
  line: string;
}

export type Grade = 'S+' | 'S' | 'A' | 'B' | 'C' | 'D';

/** The Bro's whole take on one player's game. */
export interface Review {
  /** League-style letter grade from the stats, against what their role should hit. */
  grade: Grade;
  /** 0 to 100, what the grade comes from. */
  score: number;
  /** A one-liner for the grade. */
  verdict: string;
  /** Roasts (worst first), then highlights. */
  lines: Roast[];
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
  'The Bro is not mad, just disappointed.',
  'This has been reported to your mom.',
  'Sit with that for a second.',
  'Moving on before it gets worse.',
  'The replay has been deleted for everyone\'s safety.',
  'Ouch.',
  'Yikes.',
  'Big yikes, actually.',
  'History will not be kind.',
  'Somebody had to say it.',
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
  'The Bro is proud of you.',
  'Put it on the fridge.',
  'Clip it.',
  'Elite behavior.',
  'Main character stuff.',
  'Legendary.',
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
      'You were running a minion sanctuary, not a lane.',
      'The wave crashed into your tower like it was nobody\'s business. Because it wasn\'t yours.',
      'Practice Tool is free, by the way.',
      'Your last-hit timing has the rhythm of a shopping cart with a bad wheel.',
      'You hit the minion. Just not the last time. Every time.',
      'Somewhere a melee minion is telling stories about the time it survived you.',
      'That farm was vegan. No minions were harmed.',
      'You left more gold on the map than a pirate with amnesia.',
      'Your CS graph looks like a flat line on a heart monitor.',
      'Siege minion respected. Siege minion untouched.',
    ],
    whole: [
      'Your CS is trash. {cs} a minute, buddy.',
      'You farmed like the gold was taxed at 90%. {cs} CS/min.',
      'Whole waves dying under your tower and you just vibing. {cs} CS/min.',
      'POV: {min} minutes in and you still can\'t afford boots. {cs} CS/min.',
      '{csTotal} CS. The Bro has seen better numbers on a parking ticket.',
      '{cs} CS/min. The minions filed a noise complaint about how quiet your lane was.',
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
      'Did you buy the minions dinner first? Because you never touched them.',
      'You played {champ} like a pacifist monk on a retreat.',
      'The enemy support outfarmed you and they weren\'t even trying.',
      'This is the CS of someone who was mostly on their phone.',
    ],
    whole: [
      'The cannon minion has more gold than you. {cs} CS/min.',
      '{csTotal} CS in {min} minutes. That\'s not a farm, that\'s a window box.',
    ],
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
      'The Wolves howled. You did not answer.',
      'Your jungle pet grew up without a parent.',
      'Blue buff waited for you like a dog at the window.',
      'You ganked so much you forgot you had a jungle. The ganks didn\'t work either.',
      'Your camps are a protected nature reserve now.',
    ],
    whole: [
      'Free gold sitting in the jungle and you said nah. {cs} CS/min.',
      '{cs} CS/min. Gromp is filing for custody of your jungle.',
    ],
  },
  lane: {
    leads: [
      '{goldDiff} gold behind {opp}.',
      'Down {goldDiff} gold to {opp}.',
      '{opp} ended {goldDiff} gold ahead of you.',
    ],
    jabs: [
      '{opp} treated your lane like an ATM with no PIN.',
      'That wasn\'t a lane, that was a tutorial and you were the dummy.',
      '{opp} is going to tell this story at parties.',
      'You got laned so hard {opp} should get a coaching credit.',
      'Your lane opponent was playing League. You were playing catch-up.',
      '{opp} said thanks for the free LP.',
      'You lost lane to {opp} and then lost the rematch, and the rematch after that.',
      'The matchup was even on paper. Then the paper caught fire.',
      'At least {opp} had fun.',
      'Your tower took one look at {opp} and asked to be reassigned.',
      'You were a speed bump on {opp}\'s way to an S grade.',
      '{opp} farmed you like you were a minion with extra steps.',
    ],
    whole: [
      '{opp} had {oppCs} CS, you had {csTotal}. Different lanes, apparently.',
      '{goldDiff} gold down to {opp}. That\'s like two whole items you left on their desk.',
    ],
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
      'Your teammates pinged you so much their mice need a vacation.',
      'Every teamfight started with "where is {champ}?"',
      'You were on a side quest the whole game.',
      'Your team had a group photo after every fight. You\'re not in any of them.',
      'Fear of missing out? You missed out on purpose.',
      'You had the map awareness of a houseplant.',
    ],
    whole: [
      'Fights happen at objectives. You happened somewhere else. {kp}% KP.',
      'Your team got {teamKills} kills and you showed up for {kp}% of them. Shy little guy.',
      '{kp}% KP. Your team played {min} minutes of 4v5 out of respect for you.',
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
      'You engaged like the enemy had five health bars and you had a plan. Neither was true.',
      'You go into fights first and come out never.',
      'Your combo had the timing of a sneeze.',
      'Hero complex, villain results.',
    ],
  },
  killsZero: {
    leads: ['0 kills.', 'Zero kills in {min} minutes.', 'A big fat 0 in the kill column.', '0 kills on {champ}.'],
    jabs: [
      'A {champ} with zero kills is just a very expensive ward.',
      'Pacifist run complete. Achievement unlocked.',
      'You did not kill a single person. Peace was never this boring.',
      'The enemy team felt safe around you. That\'s the problem.',
      'You came, you saw, you did not conquer.',
      'Your damage numbers were just suggestions.',
      'Even the scuttle crab respects you more than the enemy team does.',
      'Somebody tell {champ} it\'s allowed to finish people.',
      'You were the friendliest player in the lobby. Not a compliment.',
      'Kill secured? Never heard of her.',
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
      'Your damage chart bar is so small it needs a magnifying glass.',
      'You hit like a strongly worded email.',
      'The enemy health bars didn\'t even notice you.',
      'You did more damage to your own reputation than to the enemy.',
      'Your abilities had the impact of a participation trophy.',
      'You were in the fights. As moral support.',
      'Your spells were mostly fireworks. Pretty, harmless.',
    ],
    whole: [
      '{dmgK} damage in {min} minutes. That\'s a love tap a minute.',
      '{dmgK} damage in {min} minutes. The enemies thought you were the support.',
      '{dmg}% of the damage. The other four did the rest, and they noticed.',
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
      'Your abilities came with a complimentary hug.',
      'The enemy ADC farmed in peace. Thanks to you.',
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
      'Your monitor was grey so often you thought it was a setting.',
      'The enemy shutdown gold has your name engraved on it.',
      'You walked into fog of war like it owed you rent.',
      'The announcer got tired of saying your name.',
      'You had more deaths than a horror movie cast.',
      'Facechecking bushes is not a personality.',
      'You spent more time on the respawn timer than in lane.',
      'Your kill bounty was a clearance sale.',
    ],
    whole: [
      'Stop dying, little buddy. {deaths} deaths.',
      '{deaths} deaths in {min} minutes. That\'s a new one every {deathEvery} minutes, like clockwork.',
    ],
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
      'The grey screen is your natural habitat now.',
      'Riot is considering adding you as a neutral objective.',
      'They should give you a jersey, you played for both teams.',
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
      'Your Oracle Lens was a fashion accessory.',
      'Your job was literally to place wards. One job.',
      'The river was a mystery novel and you never turned the page.',
      'Control wards cost 75 gold. Your team\'s throw cost a lot more.',
    ],
  },
  visionLow: {
    leads: ['{vision} vision score.', '{vision} vision in {min} minutes.', 'A {vision} vision score.'],
    jabs: [
      'Ward? Never heard of her.',
      'Your trinket was on cooldown for {min} straight minutes, apparently.',
      'You played the whole game like the map was a surprise party.',
      'The fog of war is not a lifestyle choice.',
      'Supports aren\'t the only ones allowed to ward. Shocking, we know.',
      'Every gank was a jumpscare because you never looked.',
      'You navigated the map by vibes alone.',
      'Control wards exist. They are cheaper than your deaths.',
      'Your minimap was purely decorative.',
    ],
  },
  items: {
    leads: ['{empty} empty item slots.', '{empty} empty slots after {min} minutes.', 'Half your inventory was empty.'],
    jabs: [
      'You had more empty slots than finished items.',
      'Your inventory was giving minimalist.',
      'The shop was open the whole game, for the record.',
      'Did you think the gold was for saving up for a house?',
      'Marie Kondo would be proud. Nobody else is.',
      'Your build path was a blank page.',
      'You walked into fights with a backpack full of air.',
      'The shopkeeper waited for you all game.',
    ],
  },
  objectives: {
    leads: ['{enemyDragons} dragons to {dragons}.', 'The enemy took {enemyDragons} dragons.', '{enemyDragons} enemy dragons, {dragons} for your team.'],
    jabs: [
      'The dragon pit was their personal buffet.',
      'You let them collect dragons like trading cards.',
      'Smite is also for objectives, just so you know.',
      'The dragons were basically on the enemy team\'s payroll.',
      'Every dragon spawn was a gift and you wrapped it.',
      'You were a jungler. Allegedly.',
      'The enemy soul thanks you for your service.',
    ],
  },
  throw: {
    leads: ['Up {lead} gold, then lost.', 'Your team led by {lead} gold.', 'A {lead} gold lead, gone.'],
    jabs: [
      'Your team threw harder than an Olympic shot putter.',
      'That lead was handed back like a library book.',
      'You had the game in the bag and the bag had a hole in it.',
      'Ahead by {lead} gold and still found a way. Impressive, in a sad way.',
      'Up big, then Baron happened. Or didn\'t.',
      'That\'s the kind of throw they put in highlight reels. Not yours.',
      'The comeback was beautiful. For the enemy team.',
      'Never forget: the game ends when the Nexus does.',
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
      'The minion wave is scared to show up now.',
      'Farming simulator speedrun, any percent.',
      'Your mouse clicks are worth 21 gold each.',
      'Every cannon minion, collected like rare stamps.',
    ],
  },
  laneGood: {
    leads: ['{goldDiff} gold up on {opp}.', '{goldDiff} gold ahead of {opp}.', 'Ended {goldDiff} gold over {opp}.'],
    jabs: [
      '{opp} is going to need a minute.',
      'You turned {opp} into a minion with a name tag.',
      'Lane won, opponent humbled, gold collected.',
      '{opp} is reconsidering their champion pool.',
      'That lane was a masterclass and {opp} took notes.',
      'You were the matchup {opp} will warn people about.',
      '{opp} played the lane. You owned it.',
      'Somebody check on {opp}.',
    ],
    whole: ['{csTotal} CS to {opp}\'s {oppCs}. That\'s called a lane win.'],
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
      'You had a sixth sense for where the fights were.',
      'Teleport? Nah, you just walk fast.',
    ],
  },
  killsGood: {
    leads: ['{kills} kills, the most in the game.', 'Kill leader with {kills}.', '{kills} kills. Nobody had more.'],
    jabs: [
      'The enemy team had to start a support group.',
      'You were the final boss of this lobby.',
      'Somebody stop this {champ}. Nobody could.',
      'The kill feed was basically your autobiography.',
      'You collected kills like Pokémon.',
      'The announcer was on a first name basis with you.',
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
      'Your KDA is so clean it squeaks.',
      'That scoreline belongs in a museum.',
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
      'Your damage bar on the chart needed its own zip code.',
      'Every spell landed like a plot twist.',
      'The enemy health bars are still recovering.',
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
      'Support item, carry energy.',
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
      'You treated your health bar like a family heirloom.',
      'The enemy team\'s bounty board had your name on it and nobody collected.',
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
      'You ran a full surveillance operation.',
      'Every bush on the map has your ward in it.',
    ],
  },
  objectivesGood: {
    leads: ['{dragons} dragons and {barons} barons.', '{dragons} dragons for your team.', 'Objective control: {dragons} drakes, {barons} barons.'],
    jabs: [
      'Dragon tamer. Put it on the business card.',
      'The pit was your second home.',
      'You smited like it was personal.',
      'Every objective, collected and labeled.',
      'The enemy jungler saw none of those dragons. Rude, and correct.',
    ],
  },
  comeback: {
    leads: ['Down {lead} gold, then won.', 'Came back from {lead} gold down.', 'A {lead} gold deficit, erased.'],
    jabs: [
      'Never give up, never surrender. Iconic.',
      'The enemy team had a victory speech ready. Wasted.',
      'That\'s the comeback they make movies about.',
      'They were up big and you said not today.',
      'Down bad, then up good. The best kind of game.',
      'The enemy team is still trying to figure out what happened.',
    ],
  },

  // ---- Verdicts, one per grade ----
  verdictSS: {
    leads: [''],
    jabs: [
      'The Bro has nothing to roast. The Bro is shaken.',
      'This game goes straight to the highlight reel.',
      'The enemy team should ask for an autograph.',
      'Somebody check this player for scripts. Kidding. Mostly.',
      'The Bro tried to find a flaw. The Bro failed.',
      'Peak performance. The rest of the lobby was furniture.',
      'Hand this player the keys to the Rift.',
    ],
  },
  verdictS: {
    leads: [''],
    jabs: [
      'Clean game. The Bro had to dig for anything at all.',
      'Seriously good. Don\'t let it go to your head.',
      'You played like you meant it.',
      'Your teammates got carried and they know it.',
      'A game you\'ll want to tell your friends about.',
      'The Bro tips its cap.',
    ],
  },
  verdictA: {
    leads: [''],
    jabs: [
      'Solid stuff. A few crumbs on the table, but solid.',
      'Good game. Not legendary, but good.',
      'You did your job, and then some.',
      'Respectable. The Bro nods slowly.',
      'Nice work. Clean it up a bit and that\'s an S.',
      'Above average, and the Bro doesn\'t say that lightly.',
    ],
  },
  verdictB: {
    leads: [''],
    jabs: [
      'Fine. Just fine. The participation trophy of grades.',
      'Some good, some bad, mostly okay.',
      'A game happened, and you were in it.',
      'Not your best, not your worst. Very medium.',
      'The Bro has seen worse. The Bro has also seen better.',
      'Middle of the pack, like a lukewarm cup of tea.',
    ],
  },
  verdictC: {
    leads: [''],
    jabs: [
      'Rough game. The Bro has notes. So many notes.',
      'That was a learning experience. Mostly for the enemy team.',
      'There were good moments. The Bro is still looking for them.',
      'Let\'s call it a warm-up game.',
      'Not great. Queue up and pretend this never happened.',
      'The Bro believes in you. Less than yesterday, though.',
    ],
  },
  verdictD: {
    leads: [''],
    jabs: [
      'The Bro watched the replay. The Bro wants those minutes back.',
      'That game was a crime scene and you were holding the evidence.',
      'Maybe take a walk before the next one.',
      'The enemy team should send you a fruit basket.',
      'Even your loading screen looked worried.',
      'It\'s okay. Everyone has a game like this. You just have more of them.',
      'Uninstall? No. Practice Tool? Yes. Immediately.',
      'If this was a movie, the critics would leave halfway.',
    ],
  },
};

const VERDICT_POOL: Record<Grade, string> = { 'S+': 'verdictSS', S: 'verdictS', A: 'verdictA', B: 'verdictB', C: 'verdictC', D: 'verdictD' };

const LANE_NAME: Record<string, string> = {
  top: 'a top laner',
  jungle: 'a jungler',
  mid: 'a mid laner',
  adc: 'an ADC',
  support: 'a support',
};

/** Too short to judge (and remakes): no roasting. */
const MIN_SECONDS = 10 * 60;
/** Roasts shown at most (the worst ones), so a bad game reads as a review, not an essay. */
const MAX_BAD = 5;
/** Highlights shown at most, so a good game isn't a wall of green. */
const MAX_GOOD = 3;
/** Which roasts win when there are too many, most important first. */
const ORDER: Roast['kind'][] = ['deaths', 'lane', 'fight', 'cs', 'damage', 'kills', 'objectives', 'game', 'vision', 'items'];

/**
 * The Bro's review of one player of `team`: what they did badly, then up to
 * `MAX_GOOD` highlights praising what they did well, plus a grade. Thresholds
 * depend on their position (unknown in ARAM and other modes) and the game's
 * length. `champName` names champions, for lines that use them. Null for
 * remakes and games too short to judge.
 */
export function review(game: PostGame, team: PostTeam, me: PostPlayer, champName: (id: number) => string): Review | null {
  if (game.result === 'remake' || game.duration < MIN_SECONDS) return null;
  const min = game.duration / 60;
  const pos = me.position;
  const who = pos ? LANE_NAME[pos] : 'this mode';
  const aram = !pos && game.gameMode === 'ARAM';
  const support = pos === 'support';
  const jungle = pos === 'jungle';
  const enemy = game.teams.find((t) => t.teamId !== team.teamId) ?? null;
  const opp = pos ? enemy?.players.find((p) => p.position === pos) ?? null : null;
  const kda = (me.kills + me.assists) / Math.max(1, me.deaths);
  const csMin = me.cs / min;
  const kp = team.kills ? Math.round(((me.kills + me.assists) / team.kills) * 100) : 0;
  const dmg = Math.round(damageShare(me, team) * 100);
  const vpm = me.vision / min;
  const goldDiff = opp ? me.gold - opp.gold : 0;
  const empty = me.items.slice(0, 6).filter((id) => !id).length;
  // The client's gold lead is your team's: flipped for the other team.
  const sign = team.isMine ? 1 : -1;
  const leads = (game.goldLead ?? []).map((p) => p.lead * sign);
  const bestLead = Math.max(0, ...leads);
  const worstLead = Math.min(0, ...leads);
  const vars: Vars = {
    champ: champName(me.championId),
    opp: opp ? champName(opp.championId) : '',
    oppCs: opp?.cs ?? 0,
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
    deathEvery: me.deaths ? Math.max(1, Math.round(min / me.deaths)) : 0,
    dmg,
    dmgK: k(me.damage),
    vision: me.vision,
    goldDiff: k(Math.abs(goldDiff)),
    empty,
    dragons: team.dragons,
    barons: team.barons,
    enemyDragons: enemy?.dragons ?? 0,
  };
  const seed = `${game.gameId}:${team.teamId}:${me.championId}`;
  const bad: Roast[] = [];
  const good: Roast[] = [];
  const add = (into: Roast[], kind: Roast['kind'], pool: string, stat: string, why: string, extra: Vars = {}) =>
    into.push({
      kind,
      good: into === good,
      stat,
      why,
      line: fill(pickLine(pool, `${seed}:${pool}`, into === good), { ...vars, ...extra }),
    });

  // CS only means something with a known lane, and supports don't farm.
  const [csLow, csHigh] = jungle ? [4.5, 6.5] : [5.5, 8];
  if (pos && !support) {
    if (csMin < csLow) {
      const pool = jungle ? 'csJungle' : csMin < 3.5 ? 'csAwful' : 'cs';
      add(bad, 'cs', pool, `${vars['cs']} CS/min`, `Under ${csLow} CS/min for ${who}`);
    } else if (csMin >= csHigh) {
      add(good, 'cs', 'csGood', `${vars['cs']} CS/min`, `${csHigh}+ CS/min for ${who}`);
    }
  }

  // Against the enemy in the same position: 100+ gold a minute either way.
  if (opp && Math.abs(goldDiff) >= Math.max(2000, 100 * min)) {
    const stat = `${goldDiff > 0 ? '+' : '−'}${vars['goldDiff']} vs ${vars['opp']}`;
    if (goldDiff < 0) add(bad, 'lane', 'lane', stat, 'Ended 100+ gold a minute behind your lane opponent');
    else add(good, 'lane', 'laneGood', stat, 'Ended 100+ gold a minute ahead of your lane opponent');
  }

  const deathsPer10 = (me.deaths / min) * 10;
  const [deathBar, per10Bar, awfulBar] = aram ? [12, 4.5, 16] : [8, 3, 13];
  const fed = me.deaths >= deathBar && deathsPer10 >= per10Bar;

  // Kill participation needs enough kills to mean anything.
  const kpBar = jungle || support ? 40 : aram ? 45 : 30;
  if (team.kills >= 8 && kp < kpBar) {
    add(bad, 'fight', 'fightAbsent', `${kp}% KP`, `Under ${kpBar}% kill participation for ${who}`);
  } else if (kda < 1 && me.deaths >= 5 && !fed) {
    add(bad, 'fight', 'fightLost', `${vars['kda']} KDA`, 'Under 1.0 KDA');
  } else if (kda >= 6 && me.kills + me.assists >= 10) {
    add(good, 'fight', 'kdaGood', `${vars['kda']} KDA`, '6+ KDA');
  } else if (team.kills >= 10 && kp >= 65) {
    add(good, 'fight', 'fightGood', `${kp}% KP`, '65%+ kill participation');
  }

  // Kills: carries that never got one, and whoever topped the kill feed.
  const carry = pos === 'top' || pos === 'mid' || pos === 'adc';
  const mostKills = Math.max(...game.teams.flatMap((t) => t.players.map((p) => (p === me ? 0 : p.kills))));
  if (carry && me.kills === 0 && min >= 20 && team.kills >= 10) {
    add(bad, 'kills', 'killsZero', '0 kills', `No kills in a 20+ minute game as ${who}`);
  } else if (me.kills >= 10 && me.kills > mostKills) {
    add(good, 'kills', 'killsGood', `${me.kills} kills`, 'The most kills in the game, 10 or more');
  }

  const [dmgLow, dmgHigh] = support ? [7, 18] : jungle ? [12, 28] : pos ? [15, 30] : [13, 28];
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

  // Vision only counts on the Rift: supports are meant to ward, everyone else a little.
  const [visLow, visHigh] = support ? [1.2, 2.2] : [0.35, 1.3];
  if (pos && vpm < visLow && (support || min >= 20)) {
    add(bad, 'vision', support ? 'vision' : 'visionLow', `${me.vision} vision`, `Under ${visLow} vision score a minute for ${who}`);
  } else if (pos && vpm >= visHigh) {
    add(good, 'vision', 'visionGood', `${me.vision} vision`, `${visHigh}+ vision score a minute for ${who}`);
  }

  if (min >= 25 && empty >= 3) {
    add(bad, 'items', 'items', `${empty} empty slots`, '3+ empty item slots after 25 minutes');
  }

  // Dragons are the jungler's to take.
  if (jungle && enemy) {
    if (enemy.dragons - team.dragons >= 3) {
      add(bad, 'objectives', 'objectives', `${team.dragons}–${enemy.dragons} dragons`, 'The enemy took 3+ more dragons than your team');
    } else if ((team.dragons >= 4 || team.barons >= 2) && enemy.dragons <= 1) {
      add(good, 'objectives', 'objectivesGood', `${team.dragons} dragons`, '4+ dragons or 2+ barons, and the enemy took 1 dragon or fewer');
    }
  }

  // Throws and comebacks, from the gold lead over the game.
  if (!team.win && bestLead >= 5000) {
    add(bad, 'game', 'throw', `+${k(bestLead)} lead`, 'Lost after leading by 5k+ gold', { lead: k(bestLead) });
  } else if (team.win && worstLead <= -5000) {
    add(good, 'game', 'comeback', `−${k(-worstLead)} comeback`, 'Won after being 5k+ gold behind', { lead: k(-worstLead) });
  }

  const rank = (r: Roast) => ORDER.indexOf(r.kind);
  const lines = [...bad.sort((a, b) => rank(a) - rank(b)).slice(0, MAX_BAD), ...good.sort((a, b) => rank(a) - rank(b)).slice(0, MAX_GOOD)];

  // The grade: each stat scored 0 to 1 against what the role should hit.
  const parts: [number, number][] = [
    [ramp(kda, 1, 6), 1.2],
    [ramp(kp, kpBar - 10, 70), 1],
    [ramp(dmg, dmgLow - 4, dmgHigh + 2), support ? 0.6 : 1],
    [1 - ramp(deathsPer10, aram ? 2 : 1, aram ? 6.5 : 4.5), 1.2],
  ];
  if (pos && !support) parts.push([ramp(csMin, csLow - 1.5, csHigh), 1]);
  if (pos) parts.push([ramp(vpm, visLow - (support ? 0.3 : 0.1), visHigh), support ? 1 : 0.4]);
  if (opp) parts.push([ramp(goldDiff, -100 * min, 100 * min), 0.8]);
  const weight = parts.reduce((a, [, w]) => a + w, 0);
  const raw = parts.reduce((a, [v, w]) => a + v * w, 0) / weight + (team.win ? 0.06 : 0);
  const score = Math.round(Math.min(1, Math.max(0, raw)) * 100);
  const grade: Grade = score >= 88 ? 'S+' : score >= 77 ? 'S' : score >= 64 ? 'A' : score >= 50 ? 'B' : score >= 36 ? 'C' : 'D';
  const verdictPool = VERDICT_POOL[grade];
  const verdict = fill(pickLine(verdictPool, `${seed}:${verdictPool}`, false), vars).trim();

  return { grade, score, verdict, lines };
}

/** The review as plain text, for sharing. */
export function reviewText(r: Review, who: string): string {
  return [`The Bro's review of ${who}: ${r.grade}. ${r.verdict}`, ...r.lines.map((x) => `${x.good ? '+' : '-'} [${x.stat}] ${x.line}`)].join('\n');
}

/** Where `v` sits from `lo` (0) to `hi` (1), clamped. */
function ramp(v: number, lo: number, hi: number): number {
  return Math.min(1, Math.max(0, (v - lo) / (hi - lo)));
}

function k(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(Math.round(n));
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
const MAX_PICKS = 800;

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
  let line = id[0] === 'w' ? pool.whole![at] : `${any(pool.leads)} ${pool.jabs[at]}`.trim();
  if (id[0] === 'j' && pool.leads[0] && Math.random() < 0.35) line += ` ${any(good ? GOOD_TAILS : BAD_TAILS)}`;
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
