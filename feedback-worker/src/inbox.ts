// The devs' inbox page. Report text comes from the public, so it's only ever
// put on the page with textContent, never innerHTML.
export const INBOX_HTML = /* html */ `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>League Bro feedback</title>
<style>
  :root { --bg:#0e1116; --card:#171b22; --line:#2a313c; --text:#e6e9ef; --dim:#8b95a5; --accent:#c8a24a; --bug:#e5534b; --idea:#4fa3e0; --ok:#3fb950; }
  * { box-sizing: border-box; }
  [hidden] { display: none !important; }
  body { margin:0; background:var(--bg); color:var(--text); font:14px/1.5 system-ui, sans-serif; }
  main { max-width: 860px; margin: 0 auto; padding: 20px 16px 60px; }
  h1 { font-size: 20px; margin: 0; }
  header { display:flex; align-items:center; gap:12px; flex-wrap:wrap; margin-bottom:16px; }
  .spacer { flex:1; }
  button, select, input { font:inherit; color:var(--text); background:var(--card); border:1px solid var(--line); border-radius:6px; padding:6px 10px; }
  button { cursor:pointer; }
  button:hover { border-color: var(--dim); }
  button.primary { background: var(--accent); color:#111; border-color: var(--accent); font-weight:600; }
  .tabs button.on { border-color: var(--accent); color: var(--accent); }
  .card { background:var(--card); border:1px solid var(--line); border-radius:10px; padding:14px 16px; margin-bottom:12px; }
  .card.done { opacity:.6; }
  .meta { color:var(--dim); font-size:12.5px; display:flex; gap:8px; flex-wrap:wrap; align-items:center; }
  .tag { font-size:11.5px; font-weight:700; text-transform:uppercase; letter-spacing:.04em; padding:1px 8px; border-radius:99px; }
  .tag.bug { background:color-mix(in srgb, var(--bug) 20%, transparent); color:var(--bug); }
  .tag.idea { background:color-mix(in srgb, var(--idea) 20%, transparent); color:var(--idea); }
  .summary { white-space:pre-wrap; margin:8px 0 0; font-size:15px; }
  .details { white-space:pre-wrap; margin:8px 0 0; color:var(--dim); }
  .details b { color: var(--text); font-weight:600; }
  .actions { display:flex; gap:8px; flex-wrap:wrap; margin-top:12px; align-items:center; }
  .actions a { color: var(--ok); }
  .empty, .error { color:var(--dim); text-align:center; padding:40px 0; }
  .error { color: var(--bug); }
  #login { max-width:320px; margin:80px auto; display:flex; flex-direction:column; gap:10px; }
</style>
</head>
<body>
<main>
  <form id="login" hidden>
    <h1>League Bro feedback</h1>
    <input id="pw" type="password" placeholder="Password" autocomplete="current-password" required>
    <button class="primary">Open inbox</button>
    <div id="loginError" class="error" style="padding:0"></div>
  </form>
  <div id="inbox" hidden>
    <header>
      <h1>League Bro feedback</h1>
      <div class="spacer"></div>
      <div class="tabs">
        <button data-status="new" class="on">New</button>
        <button data-status="done">Done</button>
        <button data-status="all">All</button>
      </div>
      <select id="kind"><option value="">Bugs + ideas</option><option value="bug">Bugs</option><option value="idea">Ideas</option></select>
      <button id="logout">Log out</button>
    </header>
    <div id="list"></div>
  </div>
</main>
<script>
const KEY = 'lbFeedbackPw';
let pw = '';
try { pw = localStorage.getItem(KEY) || ''; } catch {}
let status = 'new';
let reports = [];

const $ = (id) => document.getElementById(id);
function el(tag, props = {}, ...kids) {
  const e = Object.assign(document.createElement(tag), props);
  for (const k of kids) if (k != null && k !== '') e.append(k);
  return e;
}

async function api(path, opts = {}) {
  const resp = await fetch(path, { ...opts, headers: { authorization: 'Bearer ' + pw, 'content-type': 'application/json' } });
  const data = await resp.json().catch(() => ({}));
  if (resp.status === 401) { showLogin('Wrong password'); throw new Error('auth'); }
  if (!resp.ok) throw new Error(data.error || resp.statusText);
  return data;
}

function showLogin(msg) {
  $('inbox').hidden = true; $('login').hidden = false; $('loginError').textContent = msg || '';
  try { localStorage.removeItem(KEY); } catch {}
}

async function load() {
  $('list').replaceChildren(el('div', { className: 'empty', textContent: 'Loading…' }));
  try {
    reports = (await api('/api/reports?status=' + status)).reports;
    $('login').hidden = true; $('inbox').hidden = false;
    render();
  } catch (e) {
    if (e.message !== 'auth') $('list').replaceChildren(el('div', { className: 'error', textContent: e.message }));
  }
}

function render() {
  const kind = $('kind').value;
  const shown = reports.filter((r) => !kind || r.kind === kind);
  if (!shown.length) return $('list').replaceChildren(el('div', { className: 'empty', textContent: 'Nothing here.' }));
  $('list').replaceChildren(...shown.map(card));
}

function card(r) {
  const when = new Date(r.created_at).toLocaleString();
  const env = [r.app_version && 'League Bro ' + r.app_version, r.os, r.client].filter(Boolean).join(' · ');
  const meta = el('div', { className: 'meta' },
    el('span', { className: 'tag ' + r.kind, textContent: r.kind === 'bug' ? 'Bug' : 'Idea' }),
    el('span', { textContent: '#' + r.id + ' · ' + when }),
    r.area ? el('span', { textContent: '· ' + r.area }) : null,
  );
  const details = el('div', { className: 'details' });
  if (r.details) details.append(el('b', { textContent: r.kind === 'bug' ? 'Doing: ' : 'Why: ' }), r.details, '\\n');
  if (r.contact) details.append(el('b', { textContent: 'Contact: ' }), r.contact, '\\n');
  if (env) details.append(env);

  const actions = el('div', { className: 'actions' });
  if (r.github_url) {
    actions.append(el('a', { href: r.github_url, target: '_blank', rel: 'noopener', textContent: 'GitHub issue ↗' }));
  } else {
    const gh = el('button', { className: 'primary', textContent: 'Create GitHub issue' });
    gh.onclick = () => toGithub(r, gh);
    actions.append(gh);
  }
  const done = el('button', { textContent: r.status === 'done' ? 'Move back to New' : 'Mark done' });
  done.onclick = () => act(() => api('/api/reports/' + r.id + '/status', { method: 'POST', body: JSON.stringify({ status: r.status === 'done' ? 'new' : 'done' }) }));
  const del = el('button', { textContent: 'Delete' });
  del.onclick = () => confirm('Delete report #' + r.id + '? This can\\'t be undone.') && act(() => api('/api/reports/' + r.id, { method: 'DELETE' }));
  actions.append(done, del);

  return el('div', { className: 'card' + (r.status === 'done' ? ' done' : '') },
    meta, el('p', { className: 'summary', textContent: r.summary }), details, actions);
}

async function toGithub(r, btn) {
  const first = r.summary.split('\\n')[0].trim();
  const title = prompt('Issue title (it will be public; the contact field is left out):', first.length > 80 ? first.slice(0, 79) + '…' : first);
  if (title === null) return;
  btn.disabled = true; btn.textContent = 'Creating…';
  try {
    const { url } = await api('/api/reports/' + r.id + '/github', { method: 'POST', body: JSON.stringify({ title }) });
    window.open(url, '_blank', 'noopener');
    load();
  } catch (e) {
    btn.disabled = false; btn.textContent = 'Create GitHub issue';
    if (e.message !== 'auth') alert(e.message);
  }
}

async function act(fn) {
  try { await fn(); load(); } catch (e) { if (e.message !== 'auth') alert(e.message); }
}

$('login').onsubmit = (e) => {
  e.preventDefault();
  pw = $('pw').value;
  try { localStorage.setItem(KEY, pw); } catch {}
  load();
};
$('logout').onclick = () => { pw = ''; showLogin(); };
$('kind').onchange = render;
for (const b of document.querySelectorAll('.tabs button')) {
  b.onclick = () => {
    status = b.dataset.status;
    document.querySelectorAll('.tabs button').forEach((x) => x.classList.toggle('on', x === b));
    load();
  };
}
pw ? load() : showLogin();
</script>
</body>
</html>`;
