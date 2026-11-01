// Number and time formatting shared by every page. Add new formatters here
// instead of a component method, so each one exists once.

/** 950 → "950", 1234 → "1.2k", 2000 → "2k", 1.5e6 → "1.5M". */
export function kilo(n: number): string {
  const a = Math.abs(n);
  if (a >= 1e6) return `${+(n / 1e6).toFixed(1)}M`;
  return a >= 1000 ? `${+(n / 1000).toFixed(1)}k` : String(Math.round(n));
}

/** With its sign: "+1,234", "−500", "±0"; `short` gives "+1.2k". */
export function signed(n: number, short = false): string {
  const a = Math.abs(n);
  return (n > 0 ? '+' : n < 0 ? '−' : '±') + (short ? kilo(a) : a.toLocaleString('en-US'));
}

/** A 0–1 rate as a percent: 0.523 → "52.3%" (or "52%" with `digits` 0). */
export function pct(x: number, digits = 1): string {
  return `${(x * 100).toFixed(digits)}%`;
}

/** How long ago `ms` (epoch milliseconds) was: "just now", "5 min ago", "3 h ago", "2d ago", then the date. */
export function ago(ms: number, now = Date.now()): string {
  const mins = Math.max(0, Math.round((now - ms) / 60_000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  if (mins < 24 * 60) return `${Math.floor(mins / 60)} h ago`;
  const d = Math.floor(mins / 1440);
  return d < 30 ? `${d}d ago` : new Date(ms).toLocaleDateString();
}
