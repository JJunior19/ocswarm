/**
 * Pure display formatting helpers (F5). No DOM, no React, no imports from
 * `src/hub` — safe to unit-test in plain node (format.test.ts).
 */

/** Cost: "$0.0123" under a dollar (4 decimals), "$1.23" from $1 up (2). */
export function formatCost(usd: number): string {
  if (usd >= 1) return `$${usd.toFixed(2)}`;
  return `$${usd.toFixed(4)}`;
}

/**
 * Compact token counts: 999 → "999", 1000 → "1.0k", 123456 → "123k",
 * 1e6 → "1.0M", 3.4e6 → "3.4M". One decimal below 100 of a unit, rounded
 * integers above.
 */
export function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) {
    const k = n / 1000;
    return k >= 100 ? `${Math.round(k)}k` : `${k.toFixed(1)}k`;
  }
  const m = n / 1_000_000;
  return m >= 100 ? `${Math.round(m)}M` : `${m.toFixed(1)}M`;
}

/** Elapsed wall time: mm:ss, h:mm:ss past an hour; negative clamps to 00:00. */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const ss = total % 60;
  const mm = Math.floor(total / 60) % 60;
  const hh = Math.floor(total / 3600);
  const pad = (value: number): string => String(value).padStart(2, "0");
  return hh > 0 ? `${hh}:${pad(mm)}:${pad(ss)}` : `${pad(mm)}:${pad(ss)}`;
}

/** Local wall-clock time as HH:MM:SS. */
export function formatTime(ts: number): string {
  const date = new Date(ts);
  const pad = (value: number): string => String(value).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}
