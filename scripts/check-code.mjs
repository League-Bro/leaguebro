// Code-size guardrail, run before every `npm run build` (so also in the release
// workflow). Fails when:
//   1. the app's code is over the line budget in scripts/code-budget.json, or
//   2. the same block of code appears in two places (copy-paste instead of a shared helper).
//
//   node scripts/check-code.mjs           check
//   node scripts/check-code.mjs --lower   after removing code: lower the budget to today's count
//
// Raise the budget only on purpose, in the same change as the feature that needs it.
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/(\w:)/, '$1');
const BUDGET_FILE = join(ROOT, 'scripts/code-budget.json');
const DIRS = ['src', 'src-tauri/src', 'feedback-worker/src'];
const EXT = /\.(ts|rs|css)$/;
/** Demo data and the roast lines are content, not logic: counted, but not checked for repeats. */
const NO_DUP_CHECK = /(demo|roast)\.ts$/;
/** How many meaningful lines in a row count as a copy. */
const CLONE_LINES = 6;

const files = [];
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (EXT.test(name) && !name.endsWith('.spec.ts')) files.push(p);
  }
};
DIRS.forEach((d) => walk(join(ROOT, d)));

let total = 0;
const seen = new Map();
for (const file of files) {
  let text = readFileSync(file, 'utf8');
  total += text.split('\n').filter((l) => l.trim()).length;
  if (NO_DUP_CHECK.test(file)) continue;
  // Unit tests repeat setup on purpose.
  if (file.endsWith('.rs')) text = text.split('#[cfg(test)]')[0];
  const lines = [];
  text.split('\n').forEach((l, i) => {
    const n = l.trim().replace(/\s+/g, ' ');
    // Skip what's the same everywhere: blanks, comments, closing brackets, imports, short lines.
    if (n.length < 16 || /^(\/\/|\/\*|\*|#\[|use |import |export \{)/.test(n) || /^[\s})\];,>]*$/.test(n)) return;
    lines.push([n, i + 1]);
  });
  const where = relative(ROOT, file).replaceAll('\\', '/');
  for (let i = 0; i + CLONE_LINES <= lines.length; i++) {
    const key = lines.slice(i, i + CLONE_LINES).map((x) => x[0]).join('\n');
    if (!seen.has(key)) seen.set(key, []);
    seen.get(key).push({ file: where, from: lines[i][1], to: lines[i + CLONE_LINES - 1][1] });
  }
}

// A longer copy matches as several overlapping windows: grow the first one instead of reporting each.
const clones = [];
for (const [key, at] of seen) {
  if (at.length < 2) continue;
  const prev = clones.find((c) => c.at.length === at.length && c.at.every((p, i) => p.file === at[i].file && at[i].from <= p.to));
  if (prev) prev.at.forEach((p, i) => (p.to = Math.max(p.to, at[i].to)));
  else clones.push({ at: at.map((p) => ({ ...p })), first: key.split('\n')[0] });
}

const budget = JSON.parse(readFileSync(BUDGET_FILE, 'utf8'));
let failed = false;
if (process.argv.includes('--lower') && total < budget.maxLines) {
  budget.maxLines = total;
  writeFileSync(BUDGET_FILE, JSON.stringify(budget, null, 2) + '\n');
  console.log(`Budget lowered to ${total} lines.`);
}
if (total > budget.maxLines) {
  failed = true;
  console.error(`✗ ${total} lines of code, over the budget of ${budget.maxLines} (+${total - budget.maxLines}).`);
  console.error('  Reuse or remove code to make room. Raise maxLines in scripts/code-budget.json only on purpose.');
} else {
  console.log(`✓ ${total} lines of code (budget ${budget.maxLines}).`);
}
if (clones.length) {
  failed = true;
  console.error(`✗ ${clones.length} copied block(s) of ${CLONE_LINES}+ lines. Move each into a shared helper or component:`);
  for (const c of clones) console.error(`  ${c.at.map((p) => `${p.file}:${p.from}-${p.to}`).join('  ')}\n      ${c.first.slice(0, 100)}`);
} else {
  console.log(`✓ No copied blocks of ${CLONE_LINES}+ lines.`);
}
process.exit(failed ? 1 : 0);
