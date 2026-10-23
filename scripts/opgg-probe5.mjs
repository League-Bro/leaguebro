// Fifth probe: OP.GG's "Update" (renew) button for a player, which the MCP
// endpoint doesn't offer. Finds the player's OP.GG summoner_id through MCP,
// then tries the website's renewal calls and polls until it finishes. Run:
//   node scripts/opgg-probe5.mjs "urbanfox#8108" na
import { mkdirSync, writeFileSync } from 'node:fs';

const MCP = 'https://mcp-api.op.gg/mcp';
const WEB = 'https://lol-web-api.op.gg/api/v1.0/internal/bypass';
const OUT = new globalThis.URL('./probe-output/', import.meta.url);
mkdirSync(OUT, { recursive: true });
const [riotId = 'urbanfox#8108', region = 'na'] = process.argv.slice(2);
const [gameName, tagLine] = riotId.split('#');
let session = null;
let id = 0;

async function rpc(method, params, notify = false) {
  const body = { jsonrpc: '2.0', method, ...(params ? { params } : {}), ...(notify ? {} : { id: ++id }) };
  const res = await fetch(MCP, {
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
const r = await rpc('tools/call', {
  name: 'lol_get_summoner_profile',
  arguments: {
    game_name: gameName, tag_line: tagLine, region, lang: 'en_US',
    desired_output_fields: ['data.summoner.{summoner_id,puuid,level,updated_at,renewable_at,revision_at}'],
  },
});
const text = r?.result?.content?.map((c) => c.text).join('\n') ?? JSON.stringify(r);
console.log('MCP profile:\n' + text + '\n');
// summoner_id is the second string-ish field; pull it from the compact text.
const summonerId = text.match(/Summoner\((?:\d+,)?"([^"]+)"/)?.[1];
console.log('summoner_id =', summonerId);

const results = { mcp: text, summonerId, calls: [] };
async function web(method, path) {
  const started = Date.now();
  let status, body;
  try {
    const res = await fetch(`${WEB}${path}`, {
      method,
      headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0', Origin: 'https://op.gg', Referer: 'https://op.gg/' },
    });
    status = res.status;
    body = await res.text();
  } catch (e) {
    status = 'ERR';
    body = String(e);
  }
  const ms = Date.now() - started;
  results.calls.push({ method, path, status, ms, body: body.slice(0, 3000) });
  console.log(`${method} ${path} -> ${status} (${ms} ms): ${body.slice(0, 300)}`);
  try { return JSON.parse(body); } catch { return null; }
}

if (summonerId) {
  const base = `/summoners/${region}/${summonerId}`;
  await web('GET', `${base}/summary`);
  await web('POST', `${base}/renewal`);
  for (let i = 0; i < 15; i++) {
    const s = await web('GET', `${base}/renewal-status`);
    if (s?.data?.finish || s?.finish || s?.data?.status === 'FINISH') break;
    await new Promise((res) => setTimeout(res, 2000));
  }
  await web('GET', `${base}/summary`);
  await web('GET', `/games/${region}/summoners/${summonerId}?limit=5&game_type=total`);
}

writeFileSync(new globalThis.URL('7-probe5.json', OUT), JSON.stringify(results, null, 2));
console.log('wrote scripts/probe-output/7-probe5.json');
