// One-off probe: asks OP.GG's public MCP endpoint which tools it has and
// what a champion analysis looks like, so League Bro can be built against
// the real format. Run:  node scripts/opgg-probe.mjs
// Output goes to scripts/probe-output/ (safe to delete afterwards).
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
  // Streamable HTTP may answer as SSE: take the last "data:" line.
  const data = text.includes('data:')
    ? text.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).pop()
    : text;
  try {
    return { status: res.status, json: JSON.parse(data) };
  } catch {
    return { status: res.status, raw: text };
  }
}

function save(name, value) {
  writeFileSync(new globalThis.URL(name, OUT), typeof value === 'string' ? value : JSON.stringify(value, null, 2));
  console.log('wrote scripts/probe-output/' + name);
}

function guessArgs(schema) {
  const args = {};
  const props = schema?.properties ?? {};
  for (const [name, p] of Object.entries(props)) {
    const n = name.toLowerCase();
    const pick = (re) => (p.enum ?? []).find((v) => re.test(String(v)));
    if (p.enum?.length) {
      args[name] =
        (n.includes('champ') && pick(/^ahri$/i)) ||
        (/(position|lane|role)/.test(n) && pick(/^(mid|middle)$/i)) ||
        (n.includes('game_mode') || n.includes('mode') ? pick(/ranked|^ranked/i) ?? p.enum[0] : null) ||
        (n.includes('region') && pick(/^na$/i)) ||
        (n.includes('lang') && pick(/en/i)) ||
        p.enum[0];
    } else if (n.includes('champ')) args[name] = p.type === 'integer' || p.type === 'number' ? 103 : 'AHRI';
    else if (/(position|lane|role)/.test(n)) args[name] = 'mid';
    else if (n.includes('region')) args[name] = 'na';
    else if (n.includes('lang')) args[name] = 'en_US';
    else if (p.default !== undefined) args[name] = p.default;
  }
  return args;
}

const init = await rpc('initialize', {
  protocolVersion: '2025-06-18',
  capabilities: {},
  clientInfo: { name: 'leaguebro-probe', version: '0.1.0' },
});
save('1-initialize.json', init);
await rpc('notifications/initialized', undefined, true);

const tools = await rpc('tools/list', {});
save('2-tools.json', tools);
const list = tools.json?.result?.tools ?? [];
const lol = list.filter((t) => t.name.startsWith('lol_') && !t.name.includes('esports'));
console.log(`found ${list.length} tools, ${lol.length} League tools`);

for (const name of ['lol_get_champion_analysis', 'lol_list_lane_meta_champions']) {
  const tool = lol.find((t) => t.name === name);
  if (!tool) {
    console.log(`no tool named ${name}`);
    continue;
  }
  const args = guessArgs(tool.inputSchema);
  console.log(`calling ${name} with`, args);
  const result = await rpc('tools/call', { name, arguments: args });
  save(`3-${name}.json`, { arguments: args, result });
}
console.log('done');
