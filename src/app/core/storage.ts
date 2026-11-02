// localStorage for small per-install preferences. It can throw (storage off, a
// private window, full), so every page goes through these instead of its own try/catch:
// a failed read is "not saved", a failed write just isn't remembered.

export function readLocal(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** Saves `value` under `key`; null removes it. */
export function writeLocal(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Storage off or full: it just isn't remembered.
  }
}
