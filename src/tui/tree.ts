/**
 * Swarm tree rows — pure, no I/O, fully unit-testable.
 *
 * Shapes the real `/api/session` items (children carry `parentID`; `time.idle`
 * marks a finished-or-parked session; `outcome` is set once a subagent ends)
 * into flat, render-ready rows: the root session first, then its direct
 * children in spawn order.
 */

export interface SessionLike {
  id: string;
  parentID?: string;
  agent?: string;
  title?: string;
  time?: { created?: number; idle?: number };
  outcome?: string;
}

export interface TreeRow {
  sessionID: string;
  depth: 0 | 1;
  agent: string;
  title: string;
  status: string;
  elapsedLabel: string;
}

/** `mm:ss` between session creation and `end`, never negative. */
function formatElapsed(created: number | undefined, end: number): string {
  const totalSeconds = Math.floor(Math.max(0, end - (created ?? 0)) / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function statusOf(session: SessionLike): string {
  if (session.outcome === "succeeded") return "done";
  if (session.outcome !== undefined) return "error";
  if (session.time?.idle !== undefined) return "idle";
  return "running";
}

function toRow(session: SessionLike, depth: 0 | 1, now: number): TreeRow {
  return {
    sessionID: session.id,
    depth,
    agent: session.agent ?? "agent",
    title: session.title ?? "",
    status: statusOf(session),
    // Parked agents keep their final runtime; live ones tick against `now`.
    elapsedLabel: formatElapsed(session.time?.created, session.time?.idle ?? now),
  };
}

export function buildTreeRows(
  sessions: SessionLike[],
  rootID: string | undefined,
  now: number,
): TreeRow[] {
  if (rootID === undefined) {
    // "Every active agent" view: all subagents across all roots, spawn order.
    return sessions
      .filter((session) => session.parentID !== undefined)
      .sort((a, b) => (a.time?.created ?? 0) - (b.time?.created ?? 0))
      .map((session) => toRow(session, 1, now));
  }
  const root = sessions.find((session) => session.id === rootID);
  const children = sessions
    .filter((session) => session.parentID === rootID)
    .sort((a, b) => (a.time?.created ?? 0) - (b.time?.created ?? 0));
  const rows = root ? [toRow(root, 0, now)] : [];
  return rows.concat(children.map((session) => toRow(session, 1, now)));
}
