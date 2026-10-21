// Third probe: checks champion name formats, ARAM/support, and the
// desired_output_fields parameter. Run:  node scripts/opgg-probe3.mjs
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

await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'leaguebuddy-probe', version: '0.1.0' } });
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
const F = ['data.runes', 'data.summoner_spells'];
const names = [
  ['adc', 'MISS_FORTUNE'], ['adc', 'MISSFORTUNE'], ['adc', 'KAISA'], ['adc', 'KAI_SA'],
  ['top', 'MONKEY_KING'], ['top', 'MONKEYKING'], ['top', 'WUKONG'],
  ['jungle', 'NUNU'], ['jungle', 'NUNU_WILLUMP'], ['support', 'RENATA'], ['support', 'RENATA_GLASC'],
  ['jungle', 'JARVAN_IV'], ['jungle', 'JARVANIV'], ['jungle', 'KHAZIX'], ['jungle', 'KHA_ZIX'],
  ['jungle', 'LEE_SIN'], ['jungle', 'LEESIN'], ['jungle', 'BELVETH'], ['mid', 'AURELION_SOL'], ['mid', 'TWISTED_FATE'],
  ['mid', 'LEBLANC'], ['mid', 'LE_BLANC'], ['mid', 'Ahri'], ['mid', 'ahri'],
];
for (const [position, c] of names) await call(`name-${c}`, 'lol_get_champion_analysis', { ...base, champion: c, position, desired_output_fields: F });
for (const position of ['mid', 'top', 'none', 'all', 'support'])
  await call(`aram-${position}`, 'lol_get_champion_analysis', { game_mode: 'aram', lang: 'en_US', champion: 'AHRI', position, desired_output_fields: [...F, 'data.core_items', 'data.skill_masteries'] });
await call('ahri-support-offrole', 'lol_get_champion_analysis', { ...base, champion: 'AHRI', position: 'support', desired_output_fields: F });
await call('ahri-jungle-rare', 'lol_get_champion_analysis', { ...base, champion: 'AHRI', position: 'jungle', desired_output_fields: F });
await call('flex', 'lol_get_champion_analysis', { game_mode: 'flex', lang: 'en_US', champion: 'AHRI', position: 'mid', desired_output_fields: F });

writeFileSync(new globalThis.URL('5-probe3.json', OUT), JSON.stringify(results, null, 2));
console.log('wrote scripts/probe-output/5-probe3.json');
