// Second probe: checks champion name formats, ARAM/support, and the
// desired_output_fields parameter. Run:  node scripts/opgg-probe2.mjs
import { mkdirSync, writeFileSync } from 'node:fs';

const URL = 'https://mcp-api.op.gg/mcp';
const OUT = new globalThis.URL('./probe-output/', import.meta.url);
mkdirSync(OUT, { recursive: true });
let session = null;
let id = 0;

async function rpc(method, params, notify = false) {
  const body = { jsonrpc: '2.0', method, ...(params ? { params } : {}), ...(notify ? {} : { id: ++id }) };
  const res = await fetch(URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      ...(session ? { 'Mcp-Session-Id': session } : {}),
    },
    body: JSON.stringify(body),
  });
  session = res.headers.get('mcp-session-id') ?? session;
  const text = await res.text();
  if (notify) return null;
  const data = text.includes('data:')
    ? text.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).pop()
    : text;
  try { return JSON.parse(data); } catch { return { raw: text.slice(0, 2000), status: res.status }; }
}

await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'leaguebro-probe', version: '0.1.0' } });
await rpc('notifications/initialized', undefined, true);

const results = {};
async function call(label, name, args) {
  const r = await rpc('tools/call', { name, arguments: args });
  const text = r?.result?.content?.map((c) => c.text).join('\n') ?? '';
  const ok = !r?.error && !r?.result?.isError && text.length > 0;
  results[label] = { args, ok, error: r?.error ?? (r?.result?.isError ? text.slice(0, 500) : undefined), length: text.length, head: text.slice(0, 400), full: text };
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${label} (${text.length} chars)${ok ? '' : ': ' + (JSON.stringify(r?.error) ?? text.slice(0, 200))}`);
}

const base = { game_mode: 'ranked', lang: 'en_US' };
await call('champions-list', 'lol_list_champions', { lang: 'en_US', desired_output_fields: ['data.champions[].{champion_id,key,name,release_date}'] });
for (const c of ['MISS_FORTUNE', 'MISSFORTUNE', 'KAISA', 'KAI_SA', 'MONKEY_KING', 'MONKEYKING', 'WUKONG', 'NUNU', 'NUNU_WILLUMP', 'RENATA', 'RENATA_GLASC', 'JARVAN_IV', 'JARVANIV', 'KHAZIX', 'KHA_ZIX', 'LEE_SIN', 'LEESIN', 'BELVETH', 'AURELION_SOL', 'TWISTED_FATE'])
  await call(`name-${c}`, 'lol_get_champion_analysis', { ...base, champion: c, position: 'all', desired_output_fields: ['data.runes.{id,pick_rate,play,primary_page_id,primary_page_name,primary_rune_ids[],primary_rune_names[],secondary_page_id,secondary_page_name,secondary_rune_ids[],secondary_rune_names[],stat_mod_ids[],stat_mod_names[],win}'] });
await call('fields-subset', 'lol_get_champion_analysis', { ...base, champion: 'THRESH', position: 'support', desired_output_fields: [
  'data.runes.{id,pick_rate,play,primary_page_id,primary_page_name,primary_rune_ids[],primary_rune_names[],secondary_page_id,secondary_page_name,secondary_rune_ids[],secondary_rune_names[],stat_mod_ids[],stat_mod_names[],win}',
  'data.summoner_spells.{ids[],ids_names[],pick_rate,play,win}',
  'data.skill_masteries.{ids[],pick_rate,play,win}',
  'data.skills.{order[],pick_rate,play,win}',
  'data.starter_items.{ids[],ids_names[],pick_rate,play,win}',
  'data.boots.{ids[],ids_names[],pick_rate,play,win}',
  'data.core_items.{ids[],ids_names[],pick_rate,play,win}',
  'data.fourth_items[].{ids[],ids_names[],pick_rate,play,win}',
  'data.fifth_items[].{ids[],ids_names[],pick_rate,play,win}',
  'data.sixth_items[].{ids[],ids_names[],pick_rate,play,win}',
] });
await call('fields-short', 'lol_get_champion_analysis', { ...base, champion: 'THRESH', position: 'support', desired_output_fields: ['data.runes', 'data.summoner_spells'] });
await call('aram-none', 'lol_get_champion_analysis', { game_mode: 'aram', lang: 'en_US', champion: 'AHRI', position: 'none', desired_output_fields: ['data.runes.{id,primary_page_id,primary_rune_ids[],secondary_page_id,secondary_rune_ids[],stat_mod_ids[],play,win}', 'data.summoner_spells.{ids[],play,win}'] });
await call('aram-all', 'lol_get_champion_analysis', { game_mode: 'aram', lang: 'en_US', champion: 'AHRI', position: 'all', desired_output_fields: ['data.runes.{id,primary_page_id,primary_rune_ids[],secondary_page_id,secondary_rune_ids[],stat_mod_ids[],play,win}', 'data.summoner_spells.{ids[],play,win}'] });
await call('tier-emerald', 'lol_get_champion_analysis', { ...base, champion: 'AHRI', position: 'mid', tier: 'emerald_plus', desired_output_fields: ['data.runes.{id,play,win}'] });

writeFileSync(new globalThis.URL('4-probe2.json', OUT), JSON.stringify(results, null, 2));
console.log('wrote scripts/probe-output/4-probe2.json');
