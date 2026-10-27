// "Why this pick?" explanations for the recommendation card. Everything here
// comes from real data: OP.GG's pick and win rates, the client's own rune and
// item descriptions, and what an item's stats mean for the champion's damage
// type and class. Nothing is invented per champion.
import { ChampInfo, ItemInfo, ItemSet, PerkInfo, Recommendation, SituationTag } from './models';

export interface Why {
  id: number;
  name: string;
  iconPath: string;
  /** The client's short label for a rune ("Combo Damage") or the item slot ("Boots"). */
  tag: string;
  /** What it does, in the client's words. */
  what: string;
  /** Item stat lines, e.g. "100 Ability Power". */
  stats: string[];
  /** Why it suits this champion. */
  reasons: string[];
  /** OP.GG numbers behind the pick. */
  data: string;
}

export interface WhySet {
  runes: Why[];
  /** Secondary tree and stat shards in one line each. */
  runeNotes: string[];
  items: Why[];
  skills: string[];
  spells: Why[];
}

const MIN_LATE_ITEM_GAMES = 10;
const ORDINAL = ['4th', '5th', '6th'];

const ROLE_NEEDS: Record<string, string> = {
  mage: 'deals most of their damage with abilities',
  assassin: 'wants to burst one target down quickly',
  marksman: 'deals steady damage with auto attacks',
  fighter: 'wins extended trades up close',
  tank: 'soaks damage and starts fights',
  support: 'sets up and protects teammates',
};

export function pct(x: number, digits = 1): string {
  return `${(x * 100).toFixed(digits)}%`;
}

/** "Mage / Assassin" */
export function rolesLabel(champ: ChampInfo | undefined): string {
  return (champ?.roles ?? []).map((r) => r.charAt(0).toUpperCase() + r.slice(1)).join(' / ');
}

function damageLabel(damageType: string): string {
  return { AD: 'physical (AD)', AP: 'magic (AP)', BOTH: 'mixed AD and AP' }[damageType] ?? '';
}

/** "Bought in 13% of Ahri Mid games · 52.4% win rate" */
function statsLine(s: { games: number; winRate: number; pickRate: number }, what: string, whose = ''): string {
  const of = whose ? `${whose} ` : '';
  const share = s.pickRate > 0 ? `${pct(s.pickRate, 0)} of ${of}games` : `${s.games.toLocaleString()} ${of}games`;
  return `${what} in ${share} · ${pct(s.winRate)} win rate`;
}

/** Why each stat on an item helps, given the champion's damage type and class. */
function itemReasons(item: ItemInfo, champ: ChampInfo | undefined, damageType: string): string[] {
  const name = champ?.name ?? 'This champion';
  const roles = champ?.roles ?? [];
  const cats = new Set(item.categories);
  const out: string[] = [];
  const ap = damageType === 'AP' || damageType === 'BOTH';
  const ad = damageType === 'AD' || damageType === 'BOTH';
  if (cats.has('SpellDamage')) {
    out.push(ap ? `Ability Power: ${name}'s damage scales with AP.` : 'Ability Power for ability damage and shields.');
  }
  if (cats.has('Damage')) {
    out.push(ad ? `Attack Damage: boosts ${name}'s attacks and AD ratios.` : 'Attack Damage for auto attacks.');
  }
  if (cats.has('CriticalStrike')) out.push('Critical strikes: big auto-attack damage spikes late game.');
  if (cats.has('AttackSpeed')) out.push('Attack speed: more auto attacks, so more on-hit damage.');
  if (cats.has('OnHit')) out.push('On-hit effect: triggers on every auto attack.');
  if (cats.has('AbilityHaste') || cats.has('CooldownReduction')) {
    out.push(`Ability Haste: ${name}'s abilities come back sooner, so more casts per fight.`);
  }
  if (cats.has('Mana') || cats.has('ManaRegen')) out.push('Mana: lets you keep casting in lane without backing.');
  if (cats.has('MagicPenetration')) out.push('Magic penetration: keeps your damage high once enemies buy Magic Resist.');
  if (cats.has('ArmorPenetration')) out.push('Armor penetration: more damage to armored targets.');
  if (cats.has('Health')) {
    out.push(roles.includes('tank') || roles.includes('fighter') ? 'Health: lets you stay in fights longer.' : 'Health: helps you survive burst.');
  }
  if (cats.has('Armor')) out.push('Armor: cuts physical damage taken (strong against AD-heavy teams).');
  if (cats.has('SpellBlock') || cats.has('MagicResist')) out.push('Magic Resist: cuts magic damage taken (strong against AP-heavy teams).');
  if (cats.has('LifeSteal') || cats.has('SpellVamp')) out.push('Healing from damage dealt, for sustain.');
  if (cats.has('Tenacity')) out.push('Tenacity: crowd control wears off faster.');
  if (cats.has('Active')) out.push('Has an active: a button to press in fights.');
  if (cats.has('Boots')) out.push('Boots: movement speed to roam and dodge skillshots.');
  else if (cats.has('NonbootsMovement')) out.push('Extra movement speed.');
  if (cats.has('Slow')) out.push('Slows enemies, to stick to them or get away.');
  if (cats.has('GoldPer')) out.push('Earns gold over time.');
  return out;
}

/** When to buy a 4th–6th item option. The start, boots and core are bought every game, so they get none. */
function situationalReasons(item: ItemInfo, slot: string): string[] {
  if (['Start', 'Core', 'Boots'].includes(slot)) return [];
  return item.situations.map((t) => `Situational: ${SITUATION_WHEN[t]}`);
}

/** Short names, as the Rust side labels threats. */
export const SITUATION_LABEL: Record<SituationTag, string> = {
  antiHeal: 'Anti-heal',
  armorPen: 'Armor pen',
  magicPen: 'Magic pen',
  antiShield: 'Anti-shield',
  antiTank: '%HP damage',
  armor: 'Armor',
  magicResist: 'Magic resist',
  survive: 'Survive burst',
  cleanse: 'Cleanse',
};

/** When an item with this quality is worth buying (`ItemInfo.situations`). */
export const SITUATION_WHEN: Record<SituationTag, string> = {
  antiHeal: 'applies Grievous Wounds, so buy it against healers, lifesteal and omnivamp.',
  armorPen: 'armor penetration, for when enemies stack armor (tanks, Plated Steelcaps, Randuin’s).',
  magicPen: 'magic penetration, for when enemies stack Magic Resist.',
  antiShield: 'cuts shields, so buy it against shielding supports and items like Sterak’s.',
  antiTank: 'damage based on the target’s Health, strong against tanks and Health stacking.',
  armor: 'Armor, worth it when most enemy damage is physical.',
  magicResist: 'Magic Resist, worth it when most enemy damage is magic.',
  survive: 'keeps you alive through burst, so buy it against assassins or a fed carry.',
  cleanse: 'removes crowd control, so buy it against heavy lockdown.',
};

/**
 * The item's passives/actives as "Name: text" sentences. Tooltips put the
 * passive name on its own line ("Echo") followed by what it does.
 */
function itemWhat(item: ItemInfo): string {
  const lines = item.desc.split('\n').filter((l) => !/^(Limited to|Rank \d|\()/i.test(l));
  const out: string[] = [];
  for (let i = 0; i < lines.length && out.length < 2; i++) {
    const l = lines[i];
    const isName = l.split(' ').length <= 4 && !/[.:!]$/.test(l) && i + 1 < lines.length;
    if (isName) {
      out.push(`${l}: ${lines[i + 1]}`);
      i++;
    } else {
      out.push(l);
    }
  }
  return out.join(' ');
}

interface Slot {
  label: string;
  set: ItemSet;
  /** Other options for the same slot (4th/5th/6th items). */
  options: ItemSet[];
}

/** Which OP.GG set each item in the build order came from. */
function slotFor(id: number, rec: Recommendation): Slot | null {
  if (rec.core?.ids.includes(id)) return { label: 'Core', set: rec.core, options: [] };
  if (rec.boots?.ids.includes(id)) return { label: 'Boots', set: rec.boots, options: [] };
  for (let i = 0; i < rec.later.length; i++) {
    const set = rec.later[i].find((s) => s.ids.includes(id));
    if (set) return { label: `${ORDINAL[i] ?? `${i + 4}th`} item`, set, options: rec.later[i] };
  }
  return null;
}

function slotData(slot: Slot, name: (id: number) => string): string {
  const own = statsLine(slot.set, slot.label === 'Core' ? 'This core build is bought' : 'Bought');
  const others = slot.options
    .filter((o) => o !== slot.set && o.games >= MIN_LATE_ITEM_GAMES)
    .sort((a, b) => b.winRate - a.winRate);
  const best = others[0];
  if (best && best.winRate > slot.set.winRate) {
    return `${own}. ${name(best.ids[0])} wins slightly more (${pct(best.winRate)} in ${best.games.toLocaleString()} games) but is bought less.`;
  }
  if (others.length) return `${own}. It has the best win rate of the popular options for this slot.`;
  return own;
}

export function buildWhy(
  rec: Recommendation,
  champ: ChampInfo | undefined,
  items: Map<number, ItemInfo>,
  perks: Map<number, PerkInfo>,
  styles: Map<number, PerkInfo>,
  spells: Map<number, PerkInfo>,
  /** The player's key for an ability ("Q" → their keybind). */
  key: (k: string) => string = (k) => k,
): WhySet {
  const champName = champ?.name ?? 'this champion';
  const roles = champ?.roles ?? [];
  const lane = rec.gameMode === 'ranked' || rec.gameMode === 'flex' ? ` ${laneLabel(rec.position)}` : '';
  const itemName = (id: number) => items.get(id)?.name ?? `Item ${id}`;

  // ----- runes -----
  const runes: Why[] = [];
  const runeNotes: string[] = [];
  if (rec.runes) {
    const r = rec.runes;
    const primary = styles.get(r.primaryStyleId)?.name ?? r.primaryName;
    const secondary = styles.get(r.subStyleId)?.name ?? r.secondaryName;
    r.perkIds.slice(0, 6).forEach((id, i) => {
      const p = perks.get(id);
      const reasons: string[] = [];
      if (i === 0) {
        const need = roles.map((x) => ROLE_NEEDS[x]).find(Boolean);
        if (p?.tag && need) reasons.push(`Gives ${p.tag.toLowerCase()}, which suits ${champName}: a ${rolesLabel(champ).toLowerCase()} who ${need}.`);
        else if (p?.tag) reasons.push(`Gives ${p.tag.toLowerCase()}.`);
        if (rec.damageType) reasons.push(`${champName} deals ${damageLabel(rec.damageType)} damage.`);
      } else if (p?.tag) {
        reasons.push(`Adds ${p.tag.toLowerCase()}.`);
      }
      runes.push({
        id,
        name: p?.name ?? r.perkNames[i] ?? `Rune ${id}`,
        iconPath: p?.iconPath ?? '',
        tag: i === 0 ? 'Keystone' : i < 4 ? primary : secondary,
        what: p?.desc ?? '',
        stats: [],
        reasons,
        data: i === 0 ? (r.custom ? 'Your own page, from the rune editor.' : statsLine(r, 'This page is used', `${champName}${lane}`)) : '',
      });
    });
    const secondaryRunes = r.perkIds.slice(4, 6).map((id, i) => perks.get(id)?.name ?? r.perkNames[i + 4]).filter(Boolean);
    if (secondary && secondaryRunes.length) runeNotes.push(`${secondary} as the secondary tree adds ${secondaryRunes.join(' and ')}.`);
    const shards = r.perkIds.slice(6).map((id) => perks.get(id)?.name).filter(Boolean);
    if (shards.length) runeNotes.push(`Stat shards: ${shards.join(', ')}.`);
  }

  // ----- items -----
  const item = (id: number, tag: string, data: string): Why => {
    const info = items.get(id);
    return {
      id,
      name: info?.name ?? `Item ${id}`,
      iconPath: info?.iconPath ?? '',
      tag,
      what: info ? itemWhat(info) : '',
      stats: info?.stats ?? [],
      reasons: info ? [...itemReasons(info, champ, rec.damageType), ...situationalReasons(info, tag)] : [],
      data,
    };
  };
  const out: Why[] = [];
  if (rec.starter) {
    const seen = new Set<number>();
    for (const id of rec.starter.ids) {
      if (seen.has(id)) continue;
      // The numbers are for the whole starting set, so show them once.
      out.push(item(id, 'Start', seen.size === 0 ? statsLine(rec.starter, 'This start is used') : ''));
      seen.add(id);
    }
  }
  for (const id of rec.buildOrder) {
    const slot = slotFor(id, rec);
    out.push(item(id, slot?.label ?? 'Build', slot ? slotData(slot, itemName) : ''));
  }

  // ----- skills & spells -----
  const skills: string[] = [];
  if (rec.skillMax.length) {
    skills.push(`Max ${rec.skillMax.map(key).join(' › ')}: the order most ${champName} players use.`);
    if (rec.skillStats) skills.push(statsLine(rec.skillStats, 'Used') + '.');
    if (rec.skillOrder.length >= 3) skills.push(`Levels 1–3: ${rec.skillOrder.slice(0, 3).map(key).join(', ')}.`);
  }
  const spellWhy: Why[] = rec.spells.map((id, i) => {
    const s = spells.get(id);
    return {
      id,
      name: s?.name ?? `Spell ${id}`,
      iconPath: s?.iconPath ?? '',
      tag: '',
      what: s?.desc ?? '',
      stats: [],
      reasons: [],
      data: i === 0 && rec.spellStats ? statsLine(rec.spellStats, 'This pair is taken') + '.' : '',
    };
  });

  return { runes, runeNotes, items: out, skills, spells: spellWhy };
}

function laneLabel(pos: string): string {
  return { top: 'Top', jungle: 'Jungle', mid: 'Mid', adc: 'Bot', support: 'Support' }[pos] ?? '';
}

