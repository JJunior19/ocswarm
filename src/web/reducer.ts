/**
 * Client-side mirror of the hub fold (F3).
 *
 * Pure transformations only — no network, no DOM, no imports from `src/hub`.
 * Delta semantics mirror the hub 1:1 (see src/hub/hub.ts):
 *
 * - `agent.upsert` replaces the whole agent entry; it never touches roots.
 * - `agent.status` patches status. `endedAt` is set for terminal states
 *   (done/error) and cleared when running again. Idle leaves it as-is: the
 *   wire delta cannot distinguish "idle via status" (hub keeps endedAt
 *   untouched) from "idle via interruption" (hub sets endedAt).
 * - `agent.tool` patches currentTool; missing/null clears it (JSON.stringify
 *   drops `undefined`, so the field is simply absent on the wire).
 * - `agent.removed` deletes the agent AND its root entry.
 * - `root.upsert` adds the root id if missing.
 */

import type { AgentStatus, SwarmAgent, SwarmState } from "./types";

export interface ClientState {
  roots: string[];
  agents: Record<string, SwarmAgent>;
}

/** Wire delta as delivered over SSE (event name carries `type`). */
export type ClientDelta =
  | { type: "agent.upsert"; agent: SwarmAgent }
  | { type: "agent.status"; sessionID: string; status: AgentStatus; at: number }
  | { type: "agent.tool"; sessionID: string; tool: SwarmAgent["currentTool"] }
  | { type: "agent.removed"; sessionID: string }
  | { type: "root.upsert"; sessionID: string };

/** One agent placed in the tree: root (depth 0) or subagent (depth 1). */
export interface AgentRow {
  agent: SwarmAgent;
  depth: number;
}

/** Replace the whole client view with a fresh /api/state snapshot. */
export function applySnapshot(_state: ClientState, snap: SwarmState): ClientState {
  return { roots: [...snap.roots], agents: { ...snap.agents } };
}

/** Fold one delta into the client view, mirroring hub semantics. */
export function applyDelta(state: ClientState, delta: ClientDelta): ClientState {
  switch (delta.type) {
    case "agent.upsert":
      return {
        ...state,
        agents: { ...state.agents, [delta.agent.sessionID]: delta.agent },
      };

    case "agent.status": {
      const agent = state.agents[delta.sessionID];
      if (!agent) return state; // unknown session — nothing to patch
      const endedAt =
        delta.status === "done" || delta.status === "error"
          ? delta.at
          : delta.status === "running"
            ? undefined
            : agent.endedAt;
      return {
        ...state,
        agents: {
          ...state.agents,
          [delta.sessionID]: { ...agent, status: delta.status, endedAt },
        },
      };
    }

    case "agent.tool": {
      const agent = state.agents[delta.sessionID];
      if (!agent) return state;
      return {
        ...state,
        agents: {
          ...state.agents,
          [delta.sessionID]: { ...agent, currentTool: delta.tool ?? undefined },
        },
      };
    }

    case "agent.removed": {
      if (!(delta.sessionID in state.agents) && !state.roots.includes(delta.sessionID)) {
        return state;
      }
      const agents = { ...state.agents };
      delete agents[delta.sessionID];
      return {
        roots: state.roots.filter((id) => id !== delta.sessionID),
        agents,
      };
    }

    case "root.upsert":
      return state.roots.includes(delta.sessionID)
        ? state
        : { ...state, roots: [...state.roots, delta.sessionID] };
  }
}

/** Flat placement list: root = 0, child = 1, oldest first (stable tie-break). */
export function deriveRows(state: ClientState): AgentRow[] {
  return Object.values(state.agents)
    .map((agent) => ({ agent, depth: agent.parentID ? 1 : 0 }))
    .sort(
      (a, b) =>
        a.agent.startedAt - b.agent.startedAt || a.agent.sessionID.localeCompare(b.agent.sessionID),
    );
}
