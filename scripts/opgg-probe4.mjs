// Fourth probe: what OP.GG's MCP endpoint offers for a player (rank, match
// history) without the League client. Lists every tool, then calls each
// summoner/player tool for the Riot ID given. Run:
//   node scripts/opgg-probe4.mjs "urbanfox#8108" na
import { mkdirSync, writeFileSync } from 'node:fs';

const URL = 'https://mcp-api.op.gg/mcp';
const OUT = new globalThis.URL('./probe-output/', import.meta.url);
mkdirSync(OUT, { recursive: true });
const [riotId = 'urbanfox#8108', region = 'na'] = process.argv.slice(2);
const [gameName, tagLine] = riotId.split('#');
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

const tools = (await rpc('tools/list'))?.result?.tools ?? [];
console.log(`${tools.length} tools:`);
for (const t of tools) console.log(`  ${t.name}: ${Object.keys(t.inputSchema?.properties ?? {}).join(', ')}`);

// Fills a tool's arguments from the Riot ID by parameter name; anything else
// with an enum gets its first value.
function argsFor(schema) {
  const args = {};
  for (const [k, p] of Object.entries(schema?.properties ?? {})) {
    if (/game_?name/i.test(k)) args[k] = gameName;
    else if (/tag/i.test(k)) args[k] = tagLine;
    else if (/riot_?id|summoner/i.test(k)) args[k] = riotId;
    else if (/region/i.test(k)) args[k] = region;
    else if (/lang/i.test(k)) args[k] = 'en_US';
    else if (p.enum) args[k] = p.enum[0];
  }
  return args;
}

const results = { tools };
for (const t of tools.filter((t) => /summoner|player|match|game_history|profile/i.test(t.name))) {
  const args = argsFor(t.inputSchema);
  const r = await rpc('tools/call', { name: t.name, arguments: args });
  const text = r?.result?.content?.map((c) => c.text).join('\n') ?? '';
  const ok = !r?.error && !r?.result?.isError && text.length > 0;
  results[t.name] = { args, ok, error: r?.error ?? (r?.result?.isError ? text.slice(0, 500) : undefined), full: text };
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${t.name} ${JSON.stringify(args)} (${text.length} chars)`);
}

writeFileSync(new globalThis.URL('6-probe4.json', OUT), JSON.stringify(results, null, 2));
console.log('wrote scripts/probe-output/6-probe4.json');
