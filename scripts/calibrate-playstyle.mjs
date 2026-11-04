// One-time calibration for the Profile page's Playstyle chart: samples recent
// ranked Solo/Duo games from Riot's API for every rank and writes the average
// gold, damage, kill participation, KDA, deaths, vision and objective damage
// per lane to src/app/core/playstyle-targets.ts (the chart's goals).
//
// Needs a Riot API key (a personal dev key from developer.riotgames.com is
// fine for this; it expires every 24 hours). The key is only read from the
// environment and is never written anywhere:
//
//   PowerShell:  $env:RIOT_API_KEY = "RGAPI-..."; node scripts/calibrate-playstyle.mjs
//   Git Bash:    RIOT_API_KEY=RGAPI-... node scripts/calibrate-playstyle.mjs
//
// Options (env): RIOT_PLATFORM (default na1), PLAYERS_PER_RANK (default 12),
// GAMES_PER_PLAYER (default 5). Defaults take about 20 minutes on a dev key
// (100 requests per 2 minutes). Each game counts all 10 players, so 12 x 5
// games give roughly 600 player-games per rank, ~120 per lane.
//
// Dropped connections are retried. If it stops anyway (key expired, Ctrl+C),
// run it again with the same options: finished ranks are kept in
// scripts/probe-output/calibrate-progress.json (git-ignored) and skipped.

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const KEY = process.env.RIOT_API_KEY?.trim();
if (!KEY) {
  console.error('Set RIOT_API_KEY first (see the top of this file).');
  process.exit(1);
}
const PLATFORM = (process.env.RIOT_PLATFORM ?? 'na1').toLowerCase();
const REGION = { na1: 'americas', br1: 'americas', la1: 'americas', la2: 'americas', euw1: 'europe', eun1: 'europe', tr1: 'europe', ru: 'europe', kr: 'asia', jp1: 'asia' }[PLATFORM] ?? 'sea';
const PLAYERS = Number(process.env.PLAYERS_PER_RANK ?? 12);
const GAMES = Number(process.env.GAMES_PER_PLAYER ?? 5);
const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '..', 'src', 'app', 'core', 'playstyle-targets.ts');
const PROGRESS = join(HERE, 'probe-output', 'calibrate-progress.json');

const TIERS = ['IRON', 'BRONZE', 'SILVER', 'GOLD', 'PLATINUM', 'EMERALD', 'DIAMOND', 'MASTER', 'GRANDMASTER', 'CHALLENGER'];
const APEX = { MASTER: 'masterleagues', GRANDMASTER: 'grandmasterleagues', CHALLENGER: 'challengerleagues' };
const ROLES = { TOP: 'top', JUNGLE: 'jungle', MIDDLE: 'mid', BOTTOM: 'adc', UTILITY: 'support' };

// Dev keys allow 100 requests per 2 minutes: one every 1.25 s stays under it.
const GAP_MS = 1250;
let last = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function riot(host, path) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const wait = last + GAP_MS - Date.now();
    if (wait > 0) await sleep(wait);
    last = Date.now();
    let res;
    try {
      res = await fetch(`https://${host}.api.riotgames.com${path}`, { headers: { 'X-Riot-Token': KEY } });
    } catch (e) {
      // A dropped connection or network blip: wait a little longer each time and try again.
      console.log(`  connection problem (${e.cause?.code ?? e.message}), retrying`);
      await sleep(5000 * (attempt + 1));
      continue;
    }
    if (res.status === 429) {
      const secs = Number(res.headers.get('retry-after') ?? 10);
      console.log(`  rate limited, waiting ${secs}s`);
      await sleep(secs * 1000);
      continue;
    }
    if (res.status === 401 || res.status === 403) throw new Error(`Riot refused the key (${res.status}). Dev keys expire every 24 hours: get a fresh one.`);
    if (!res.ok) {
      if (res.status >= 500) {
        await sleep(2000);
        continue;
      }
      return null;
    }
    try {
      return await res.json();
    } catch {
      // The connection closed partway through the answer.
      await sleep(5000 * (attempt + 1));
    }
  }
  return null;
}

/** Up to `PLAYERS` puuids from one rank, spread over its divisions. */
async function players(tier) {
  let entries = [];
  if (APEX[tier]) {
    const league = await riot(PLATFORM, `/lol/league/v4/${APEX[tier]}/by-queue/RANKED_SOLO_5x5`);
    entries = league?.entries ?? [];
  } else {
    for (const div of ['I', 'II', 'III', 'IV']) {
      const page = await riot(PLATFORM, `/lol/league/v4/entries/RANKED_SOLO_5x5/${tier}/${div}?page=1`);
      entries.push(...(page ?? []).slice(0, Math.ceil(PLAYERS / 4) * 3));
    }
  }
  const ids = entries.map((e) => e.puuid).filter(Boolean);
  // A spread, not just the top of each page.
  const step = Math.max(1, Math.floor(ids.length / PLAYERS));
  return ids.filter((_, i) => i % step === 0).slice(0, PLAYERS);
}

const empty = () => ({ games: 0, minutes: 0, gold: 0, damage: 0, kills: 0, deaths: 0, assists: 0, teamKills: 0, vision: 0, objectives: 0 });

function add(sum, p, minutes, teamKills) {
  sum.games += 1;
  sum.minutes += minutes;
  sum.gold += p.goldEarned;
  sum.damage += p.totalDamageDealtToChampions;
  sum.kills += p.kills;
  sum.deaths += p.deaths;
  sum.assists += p.assists;
  sum.teamKills += teamKills;
  sum.vision += p.visionScore;
  sum.objectives += p.damageDealtToObjectives;
}

const round = (x, d) => Math.round(x * 10 ** d) / 10 ** d;
function targets(s) {
  return {
    gold: round(s.gold / s.minutes, 0),
    damage: round(s.damage / s.minutes, 0),
    kp: round((s.kills + s.assists) / Math.max(1, s.teamKills), 3),
    kda: round((s.kills + s.assists) / Math.max(1, s.deaths), 2),
    deaths: round(s.deaths / s.minutes, 4),
    vision: round(s.vision / s.minutes, 3),
    objectives: round(s.objectives / s.minutes, 0),
    games: s.games,
  };
}

/** The types at the top of playstyle-targets.ts (kept the same in the placeholder file). */
const TYPES = `export interface LaneTargets {
  gold: number;
  damage: number;
  kp: number;
  kda: number;
  deaths: number;
  vision: number;
  objectives: number;
  games: number;
}

/** By rank ("gold") then lane ("top" … "support", "any" = all lanes). */
export interface RankTargets {
  patch: string;
  platform: string;
  ranks: Record<string, Partial<Record<string, LaneTargets>>>;
}
`;

// Ranks finished by an earlier run with the same options are kept, so a rerun picks up where it stopped.
const OPTIONS = { platform: PLATFORM, players: PLAYERS, games: GAMES };
let saved = null;
try {
  saved = JSON.parse(readFileSync(PROGRESS, 'utf8'));
} catch {}
if (saved && JSON.stringify(saved.options) !== JSON.stringify(OPTIONS)) saved = null;
const seen = new Set(saved?.seen ?? []);
const out = saved?.out ?? {};
let patch = saved?.patch ?? '';
function saveProgress() {
  mkdirSync(dirname(PROGRESS), { recursive: true });
  writeFileSync(PROGRESS, JSON.stringify({ options: OPTIONS, patch, out, seen: [...seen] }));
}
for (const tier of TIERS) {
  if (out[tier.toLowerCase()]) {
    console.log(`${tier}: done in an earlier run`);
    continue;
  }
  console.log(`${tier}: finding players`);
  const sums = Object.fromEntries([...Object.values(ROLES), 'any'].map((r) => [r, empty()]));
  const ids = await players(tier);
  let used = 0;
  for (const puuid of ids) {
    const matches = (await riot(REGION, `/lol/match/v5/matches/by-puuid/${puuid}/ids?queue=420&type=ranked&count=${GAMES}`)) ?? [];
    for (const id of matches) {
      if (seen.has(id)) continue;
      seen.add(id);
      const m = await riot(REGION, `/lol/match/v5/matches/${id}`);
      const info = m?.info;
      if (!info || info.queueId !== 420 || info.gameDuration < 900) continue;
      patch ||= info.gameVersion.split('.').slice(0, 2).join('.');
      const minutes = info.gameDuration / 60;
      const kills = { 100: 0, 200: 0 };
      for (const p of info.participants) kills[p.teamId] += p.kills;
      for (const p of info.participants) {
        if (p.gameEndedInEarlySurrender) continue;
        const role = ROLES[p.teamPosition];
        if (!role) continue;
        add(sums[role], p, minutes, kills[p.teamId]);
        add(sums.any, p, minutes, kills[p.teamId]);
      }
      used++;
    }
    process.stdout.write(`  ${used} games\r`);
  }
  console.log(`  ${used} games, ${sums.any.games} player-games`);
  if (sums.any.games > 0) out[tier.toLowerCase()] = Object.fromEntries(Object.entries(sums).filter(([, s]) => s.games > 0).map(([r, s]) => [r, targets(s)]));
  saveProgress();
}

const file = `// Generated by scripts/calibrate-playstyle.mjs on ${new Date().toISOString().slice(0, 10)}: the average
// per lane of ranked Solo/Duo players in each rank (${PLATFORM}, patch ${patch}), from Riot's API.
// The Playstyle chart's goals. Run the script again to refresh; don't edit by hand.
// Per minute except kp (share of team kills), kda and games (player-games sampled).

${TYPES}
export const RANK_TARGETS: RankTargets | null = ${JSON.stringify({ patch, platform: PLATFORM, ranks: out }, null, 2)};
`;
writeFileSync(OUT, file);
if (existsSync(PROGRESS)) rmSync(PROGRESS);
console.log(`Wrote ${OUT}`);
