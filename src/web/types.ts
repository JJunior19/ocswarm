/**
 * Client copies of the hub domain shapes (F3).
 *
 * Duplicated on purpose: the web bundle must stay isolated from the plugin
 * graph, so nothing here imports from `src/hub`. Keep in sync with
 * `src/hub/types.ts` — the SSE wire format is defined there.
 */

/** Lifecycle status of one agent (session) in the swarm view. */
export type AgentStatus = "running" | "idle" | "done" | "error";

export interface SwarmAgent {
  sessionID: string;
  parentID?: string; // present ⇒ subagent
  agent: string; // "explore" | "general" | ...
  title: string;
  task: string;
  status: AgentStatus;
  startedAt: number;
  endedAt?: number;
  currentTool?: { name: string; summary?: string; startedAt: number };
  toolCalls: { name: string; status: string; at: number }[];
  tokens: { input: number; output: number; cacheRead: number; cacheWrite: number };
  costUSD: number;
  filesTouched: string[];
}

/** Snapshot shape served by GET /api/state (updatedAt is client-ignored). */
export interface SwarmState {
  roots: string[];
  agents: Record<string, SwarmAgent>;
  updatedAt: number;
}
