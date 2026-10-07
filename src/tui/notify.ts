/**
 * Subagent attention decisions — pure, no I/O, fully unit-testable.
 *
 * The watcher maps grounded lifecycle events (`session.execution.succeeded` /
 * `session.execution.failed`, both carrying `data.sessionID`) onto status
 * deltas and consults these helpers: only tracked subagent sessions (present
 * in the index, i.e. sessions with a parentID) that reach "done" or "error"
 * produce a notification. The caller owns the `notified` set, so a session
 * notifies at most once no matter how often events are redelivered.
 */

export interface DecidedNotify {
  variant: "success" | "error";
  message: string;
}

export type NotifyDecision = DecidedNotify | undefined;

/** Max title characters before an ellipsis, matching the swarm panel's labels. */
const MAX_TITLE = 48;

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export function decideNotify(
  subagents: Map<string, { agent: string; title: string }>,
  statusDelta: { sessionID: string; status: string },
  notified: Set<string>,
): NotifyDecision {
  const tracked = subagents.get(statusDelta.sessionID);
  if (tracked === undefined) return undefined;
  if (notified.has(statusDelta.sessionID)) return undefined;
  const variant =
    statusDelta.status === "done"
      ? "success"
      : statusDelta.status === "error"
        ? "error"
        : undefined;
  if (variant === undefined) return undefined;
  notified.add(statusDelta.sessionID);
  const label = `${tracked.agent}: ${truncate(tracked.title, MAX_TITLE)}`;
  return {
    variant,
    message: variant === "success" ? `✔ ${label}` : `✗ ${label} done with error`,
  };
}

/** Minimal session snapshot needed to decide tracking (fits SessionInfo). */
export interface AgentSessionLike {
  id: string;
  parentID?: string;
  agent?: string;
  title?: string;
}

/**
 * Index of tracked subagent sessions by sessionID. Only sessions with a
 * parentID count — root sessions are the orchestrator, not a background
 * subagent.
 */
export function subagentIndex(
  sessions: AgentSessionLike[],
): Map<string, { agent: string; title: string }> {
  const index = new Map<string, { agent: string; title: string }>();
  for (const session of sessions) {
    if (session.parentID === undefined) continue;
    index.set(session.id, { agent: session.agent ?? "agent", title: session.title ?? "" });
  }
  return index;
}
