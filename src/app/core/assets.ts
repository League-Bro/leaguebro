// Icons come from CommunityDragon, a public mirror of the client's own
// game-data assets, so no auth or local proxy is needed.
const CDRAGON = 'https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default';

export function championIcon(id: number): string {
  return id > 0 ? `${CDRAGON}/v1/champion-icons/${id}.png` : '';
}

/** Base-skin splash art. The folder is the champion's alias, lowercased (MonkeyKing, KaiSa…). */
export function championSplash(alias: string): string {
  const a = alias.toLowerCase();
  return a ? `${CDRAGON}/assets/characters/${a}/skins/base/images/${a}_splash_uncentered_0.jpg` : '';
}

export function profileIcon(id: number): string {
  return id > 0 ? `${CDRAGON}/v1/profile-icons/${id}.jpg` : '';
}

const QUEUE_LABELS: Record<number, string> = {
  420: 'Ranked Solo/Duo', 440: 'Ranked Flex', 400: 'Normal Draft', 430: 'Normal Blind', 490: 'Quickplay',
  480: 'Swiftplay', 450: 'ARAM', 900: 'URF', 1900: 'URF', 1300: 'Nexus Blitz', 1700: 'Arena', 1710: 'Arena',
  830: 'Co-op vs AI', 840: 'Co-op vs AI', 850: 'Co-op vs AI', 870: 'Co-op vs AI', 880: 'Co-op vs AI', 890: 'Co-op vs AI',
};

export function queueLabel(id: number, gameMode = ''): string {
  return QUEUE_LABELS[id] ?? (gameMode ? gameMode.charAt(0) + gameMode.slice(1).toLowerCase() : `Queue ${id}`);
}

/** Converts a client asset path like /lol-game-data/assets/ASSETS/Items/... */
export function assetUrl(path: string | undefined | null): string {
  if (!path) return '';
  const rel = path.replace(/^\/lol-game-data\/assets\//i, '');
  return `${CDRAGON}/${rel.toLowerCase()}`;
}

export const POSITION_LABELS: Record<string, string> = {
  top: 'Top',
  jungle: 'Jungle',
  middle: 'Mid',
  bottom: 'Bot',
  utility: 'Support',
};

export function positionLabel(pos: string | null | undefined): string {
  return POSITION_LABELS[(pos ?? '').toLowerCase()] ?? '';
}

const CRESTS = 'https://raw.communitydragon.org/latest/plugins/rcp-fe-lol-static-assets/global/default/images/ranked-mini-crests';

/** The client's small rank crest (SVG). Takes "EMERALD", "emerald" or a tier list filter like "emerald_plus"; anything else gets the unranked crest. */
export function rankCrest(tier: string | undefined | null): string {
  const t = (tier ?? '').toLowerCase().replace(/_plus$/, '');
  return `${CRESTS}/${TIER_ORDER.includes(t.toUpperCase()) ? t : 'unranked'}.svg`;
}

const TIER_ORDER =['IRON', 'BRONZE', 'SILVER', 'GOLD', 'PLATINUM', 'EMERALD', 'DIAMOND', 'MASTER', 'GRANDMASTER', 'CHALLENGER'];

export function tierClass(tier: string | undefined): string {
  const t = (tier ?? '').toUpperCase();
  return TIER_ORDER.includes(t) ? `tier-${t.toLowerCase()}` : 'tier-none';
}

export function formatTier(tier: string, division: string): string {
  const t = tier.charAt(0) + tier.slice(1).toLowerCase();
  const apex = ['MASTER', 'GRANDMASTER', 'CHALLENGER'].includes(tier.toUpperCase());
  return apex || !division ? t : `${t} ${division}`;
}

export function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Win rate as a whole percent. */
export function winPct(wins: number, games: number): number {
  return games > 0 ? Math.round((wins / games) * 100) : 0;
}

/** (Kills + assists) / deaths, e.g. "3.2", or "Perfect" without deaths. */
export function kdaRatio(k: number, d: number, a: number): string {
  return d === 0 ? (k + a > 0 ? 'Perfect' : '0.0') : ((k + a) / d).toFixed(1);
}
