/**
 * Pure gantt axis math (F5). No DOM, no React — unit-tested in
 * ganttScale.test.ts. Bars are fractions (0..1) of the shared time axis so
 * the component stays a dumb renderer.
 */

import { formatTime } from "./format";
import type { SwarmAgent } from "./types";

export interface GanttBar {
  sessionID: string;
  /** Bar start as a fraction of the axis width (0..1). */
  left: number;
  /** Bar length as a fraction of the axis width (0..1). */
  width: number;
}

export interface GanttTick {
  /** Position as a fraction of the axis width (0..1). */
  at: number;
  /** HH:MM:SS label for that axis position. */
  label: string;
}

export interface GanttScale {
  /** Axis window [start, start + span] in epoch ms; span ≥ 1000 avoids /0. */
  start: number;
  span: number;
  /** One bar per agent, sorted by startedAt (stable tie-break on sessionID). */
  bars: GanttBar[];
  /** ~5 evenly spaced HH:MM:SS ticks covering the axis. */
  ticks: GanttTick[];
}

/** Tick count per axis — both ends included. */
const TICK_POINTS = 5;

/** Minimum axis span in ms: single-second runs must still render a bar. */
const MIN_SPAN_MS = 1000;

/**
 * Shared x axis across [minStart, maxEnd] where maxEnd is each agent's
 * endedAt, or `now` for still-open agents. Pure and deterministic given
 * `now`.
 */
export function computeGanttScale(agents: SwarmAgent[], now: number): GanttScale {
  const rows = [...agents].sort(
    (a, b) => a.startedAt - b.startedAt || a.sessionID.localeCompare(b.sessionID),
  );
  if (rows.length === 0) {
    return { start: 0, span: MIN_SPAN_MS, bars: [], ticks: [] };
  }

  const start = Math.min(...rows.map((row) => row.startedAt));
  const rawEnd = Math.max(...rows.map((row) => row.endedAt ?? now));
  const span = Math.max(rawEnd - start, MIN_SPAN_MS);

  const bars: GanttBar[] = rows.map((row) => {
    const from = Math.min(Math.max(row.startedAt, start), start + span);
    const to = Math.min(Math.max(row.endedAt ?? now, from), start + span);
    return {
      sessionID: row.sessionID,
      left: (from - start) / span,
      width: (to - from) / span,
    };
  });

  const ticks: GanttTick[] = [];
  for (let i = 0; i < TICK_POINTS; i++) {
    const at = i / (TICK_POINTS - 1);
    ticks.push({ at, label: formatTime(start + at * span) });
  }

  return { start, span, bars, ticks };
}
