// League Bro feedback: the app's Feedback page posts bug reports and ideas
// here. Each one becomes a GitHub issue right away, and a private copy (with
// the player's contact info, which never goes on GitHub) is kept in D1 for
// the inbox page (/). Reports past the daily issue cap, or whose issue
// couldn't be made, stay "new" in the inbox with a button to retry.
//
//   POST /api/report                 the app (no auth; rate-limited per IP)
//   GET  /                           inbox page (asks for ADMIN_PASSWORD)
//   GET  /api/reports?status=new     list, newest first (auth)
//   POST /api/reports/:id/status     {"status":"new"|"done"} (auth)
//   POST /api/reports/:id/github     {"title"} → creates the issue (auth)
//   DELETE /api/reports/:id          spam (auth)

// `Env` (DB, ADMIN_PASSWORD, GITHUB_TOKEN) is generated from cloudflare.config.ts: `cf workers types`.
import { INBOX_HTML } from "./inbox.ts";

const REPO = "doliaro/leaguebro";
/** `GITHUB_API` in .dev.vars points local runs at a fake. */
const GITHUB_API = "https://api.github.com";
/** Labels on every issue made from the app (GitHub creates missing ones for tokens with push access). */
const FROM_APP = "from-app";
/** Reports one IP may send per hour. */
const PER_HOUR = 10;
/** Issues made automatically per day (UTC), so a spam wave can't flood the repo; the rest wait in the inbox. */
const AUTO_ISSUES_PER_DAY = 30;
const KINDS = ["bug", "idea"] as const;
type Kind = (typeof KINDS)[number];

/** Longest each field may be (characters); longer text is cut. */
const LIMITS = { summary: 4000, details: 4000, area: 40, contact: 200, appVersion: 40, os: 60, client: 120 };

const SCHEMA = `CREATE TABLE IF NOT EXISTS reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL,
  kind TEXT NOT NULL,
  area TEXT NOT NULL DEFAULT '',
  summary TEXT NOT NULL,
  details TEXT NOT NULL DEFAULT '',
  contact TEXT NOT NULL DEFAULT '',
  app_version TEXT NOT NULL DEFAULT '',
  os TEXT NOT NULL DEFAULT '',
  client TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'new',
  github_url TEXT NOT NULL DEFAULT '',
  ip_hash TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS reports_ip_time ON reports (ip_hash, created_at);`;

let schemaReady = false;
async function ensureSchema(db: D1Database): Promise<void> {
  if (schemaReady) return;
  await db.exec(SCHEMA.replace(/\n\s*/g, " "));
  schemaReady = true;
}

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;
    try {
      if (req.method === "GET" && path === "/") {
        return new Response(INBOX_HTML, {
          headers: {
            "content-type": "text/html; charset=utf-8",
            "content-security-policy": "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'",
            "x-robots-tag": "noindex",
          },
        });
      }
      await ensureSchema(env.DB);
      if (req.method === "POST" && path === "/api/report") return await receive(req, env, ctx);

      if (!path.startsWith("/api/reports")) return json({ error: "Not found" }, 404);
      if (!(await authorized(req, env))) return json({ error: "Wrong password" }, 401);

      if (req.method === "GET" && path === "/api/reports") return await list(env, url.searchParams.get("status"));
      const m = path.match(/^\/api\/reports\/(\d+)(?:\/(status|github))?$/);
      if (!m) return json({ error: "Not found" }, 404);
      const id = Number(m[1]);
      if (req.method === "DELETE" && !m[2]) {
        await env.DB.prepare("DELETE FROM reports WHERE id = ?").bind(id).run();
        return json({ ok: true });
      }
      if (req.method === "POST" && m[2] === "status") return await setStatus(req, env, id);
      if (req.method === "POST" && m[2] === "github") return await toGithub(req, env, id);
      return json({ error: "Not found" }, 404);
    } catch (e) {
      console.error(e);
      return json({ error: "Something went wrong on the server" }, 500);
    }
  },
} satisfies ExportedHandler<Env>;

/** A report from the app. The player gets their answer at once; the issue is made after. */
async function receive(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return json({ error: "Bad request" }, 400);
  const field = (k: keyof typeof LIMITS) => (typeof body[k] === "string" ? (body[k] as string).trim().slice(0, LIMITS[k]) : "");
  const kind = body["kind"] as Kind;
  const summary = field("summary");
  if (!KINDS.includes(kind) || !summary) return json({ error: "Bad request" }, 400);

  const ipHash = await sha256(req.headers.get("cf-connecting-ip") ?? "");
  const since = new Date(Date.now() - 3600_000).toISOString();
  const recent = await env.DB.prepare("SELECT COUNT(*) AS n FROM reports WHERE ip_hash = ? AND created_at > ?")
    .bind(ipHash, since)
    .first<{ n: number }>();
  if ((recent?.n ?? 0) >= PER_HOUR) return json({ error: "Too many reports from here. Try again in an hour." }, 429);

  const row = await env.DB.prepare(
    `INSERT INTO reports (created_at, kind, area, summary, details, contact, app_version, os, client, ip_hash)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
  )
    .bind(new Date().toISOString(), kind, field("area"), summary, field("details"), field("contact"), field("appVersion"), field("os"), field("client"), ipHash)
    .first<{ id: number }>();
  if (row) ctx.waitUntil(autoIssue(env, row.id).catch((e) => console.error(`report #${row.id}: ${e}`)));
  return json({ ok: true, id: row?.id });
}

/** Makes the report's issue unless today's cap is reached (it then waits in the inbox). */
async function autoIssue(env: Env, id: number): Promise<void> {
  if (!env.GITHUB_TOKEN) return;
  const today = new Date().toISOString().slice(0, 10);
  const made = await env.DB.prepare("SELECT COUNT(*) AS n FROM reports WHERE github_url != '' AND created_at >= ?")
    .bind(today)
    .first<{ n: number }>();
  if ((made?.n ?? 0) >= AUTO_ISSUES_PER_DAY) return;
  const r = await env.DB.prepare("SELECT * FROM reports WHERE id = ?").bind(id).first<Report>();
  if (r) await createIssue(env, r, "");
}

async function list(env: Env, status: string | null): Promise<Response> {
  const cols = "id, created_at, kind, area, summary, details, contact, app_version, os, client, status, github_url";
  const stmt =
    status === "new" || status === "done"
      ? env.DB.prepare(`SELECT ${cols} FROM reports WHERE status = ? ORDER BY id DESC LIMIT 500`).bind(status)
      : env.DB.prepare(`SELECT ${cols} FROM reports ORDER BY id DESC LIMIT 500`);
  return json({ reports: (await stmt.all()).results });
}

async function setStatus(req: Request, env: Env, id: number): Promise<Response> {
  const { status } = ((await req.json().catch(() => ({}))) ?? {}) as { status?: string };
  if (status !== "new" && status !== "done") return json({ error: "Bad status" }, 400);
  await env.DB.prepare("UPDATE reports SET status = ? WHERE id = ?").bind(status, id).run();
  return json({ ok: true });
}

type Report = Record<string, string> & { id: number };

/** The inbox's button: makes the issue for a report that has none yet. */
async function toGithub(req: Request, env: Env, id: number): Promise<Response> {
  const r = await env.DB.prepare("SELECT * FROM reports WHERE id = ?").bind(id).first<Report>();
  if (!r) return json({ error: "No such report" }, 404);
  if (r["github_url"]) return json({ url: r["github_url"] });
  if (!env.GITHUB_TOKEN) return json({ error: "GITHUB_TOKEN isn't set on the Worker" }, 500);
  const { title } = ((await req.json().catch(() => ({}))) ?? {}) as { title?: string };
  try {
    return json({ url: await createIssue(env, r, title ?? "") });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 502);
  }
}

/**
 * Opens a GitHub issue from a report and marks the report done. The contact
 * field stays out of it, since issues are public.
 */
async function createIssue(env: Env, r: Report, title: string): Promise<string> {
  const isBug = r["kind"] === "bug";
  const parts = [
    `### ${isBug ? "What went wrong" : "The idea"}\n\n${r["summary"]}`,
    r["details"] ? `### ${isBug ? "What they were doing" : "Why it would help"}\n\n${r["details"]}` : "",
    r["area"] ? `**Where:** ${r["area"]}` : "",
    [r["app_version"] && `League Bro ${r["app_version"]}`, r["os"], r["client"]].filter(Boolean).join(" · "),
    `_Sent from the app's Feedback tab (report #${r.id})._`,
  ];
  const resp = await fetch(`${env.GITHUB_API}/repos/${REPO}/issues`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.GITHUB_TOKEN}`,
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      "user-agent": "leaguebro-feedback",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      title: noMentions(title.trim().slice(0, 200) || firstLine(r["summary"] ?? "")),
      body: noMentions(parts.filter(Boolean).join("\n\n")),
      labels: [isBug ? "bug" : "enhancement", FROM_APP],
    }),
  });
  if (!resp.ok) throw new Error(`GitHub said ${resp.status}: ${(await resp.text()).slice(0, 300)}`);
  const issue = (await resp.json()) as { html_url: string };
  await env.DB.prepare("UPDATE reports SET github_url = ?, status = 'done' WHERE id = ?").bind(issue.html_url, r.id).run();
  return issue.html_url;
}

/** Players' text is public on GitHub: a zero-width space after "@" stops it pinging anyone. */
function noMentions(text: string): string {
  return text.replace(/@(?=[A-Za-z0-9])/g, "@​");
}

async function authorized(req: Request, env: Env): Promise<boolean> {
  const given = (req.headers.get("authorization") ?? "").replace(/^Bearer /, "");
  if (!env.ADMIN_PASSWORD || !given) return false;
  // Comparing hashes keeps the check's timing from leaking the password.
  return (await sha256(given)) === (await sha256(env.ADMIN_PASSWORD));
}

function firstLine(text: string): string {
  const line = text.split("\n")[0]!.trim();
  return line.length > 80 ? line.slice(0, 79) + "…" : line;
}

async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
}
