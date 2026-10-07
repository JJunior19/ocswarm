/**
 * Pure session-tree queries over the client mirror (F5.1). No DOM, no React —
 * unit-tested in tree.test.ts.
 *
 * Root candidates are agents WITHOUT `parentID` — deliberately not the hub
 * `roots[]` array, where late-join parents are never registered.
 */

import type { ClientState } from "./reducer";
import type { SwarmAgent } from "./types";

/**
 * Every root session (no parentID), most recent first. Deterministic
 * tie-break on sessionID, mirroring deriveRows / computeGanttScale.
 */
export function rootSessions(state: ClientState): SwarmAgent[] {
  return Object.values(state.agents)
    .filter((agent) => agent.parentID === undefined)
    .sort((a, b) => b.startedAt - a.startedAt || a.sessionID.localeCompare(b.sessionID));
}

export interface Subtree {
  /** Every session id in the subtree, root included. */
  ids: Set<string>;
  /** BFS depth per id: root = 0, direct child = 1, … (nested delegation). */
  depth: Map<string, number>;
}

/**
 * The subtree rooted at `rootID`: BFS over parentID links, ANY depth. A
 * missing/unknown rootID yields empty results; the visited set doubles as a
 * cycle guard, so malformed parent loops cannot hang the walk.
 */
export function subtreeOf(state: ClientState, rootID: string): Subtree {
  const ids = new Set<string>();
  const depth = new Map<string, number>();
  if (!(rootID in state.agents)) return { ids, depth };

  // Children index in one pass, so the walk is O(V + E), not O(V × N).
  const children = new Map<string, string[]>();
  for (const agent of Object.values(state.agents)) {
    if (agent.parentID === undefined) continue;
    const siblings = children.get(agent.parentID);
    if (siblings) siblings.push(agent.sessionID);
    else children.set(agent.parentID, [agent.sessionID]);
  }

  ids.add(rootID);
  depth.set(rootID, 0);
  const queue: Array<{ id: string; level: number }> = [{ id: rootID, level: 0 }];
  while (queue.length > 0) {
    const { id, level } = queue.shift() as { id: string; level: number };
    for (const child of children.get(id) ?? []) {
      if (ids.has(child)) continue; // cycle guard — never revisit
      ids.add(child);
      depth.set(child, level + 1);
      queue.push({ id: child, level: level + 1 });
    }
  }

  return { ids, depth };
}
