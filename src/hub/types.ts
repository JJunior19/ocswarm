/**
 * SwarmHub domain types (F1).
 *
 * Pure data plus tiny tolerant accessors — no I/O, no @opencode imports.
 * The hub consumes raw OpenCode V2 server events (`{ id, created, type,
 * location?, data, durable? }`) through the structural `HubEvent` view so
 * unknown or missing envelope fields never break parsing.
 */

/** Lifecycle status of one agent (session) in the swarm view. */
export type AgentStatus = "running" | "idle" | "done" | "error";

export interface SwarmAgent {
  sessionID: string;
  parentID?: string; // present ⇒ subagent
  agent: string; // "explore" | "general" | ...
  title: string;
  task: string; // description (from title, suffix-stripped)
  status: AgentStatus;
  startedAt: number;
  endedAt?: number;
  currentTool?: { name: string; summary?: string; startedAt: number };
  toolCalls: { name: string; status: string; at: number }[];
  tokens: { input: number; output: number; cacheRead: number; cacheWrite: number };
  costUSD: number;
  filesTouched: string[]; // best-effort from step.ended
  archived?: boolean; // session deleted upstream; kept for history (F5.3)
}

export interface SwarmState {
  roots: string[]; // top-level sessionIDs
  agents: Record<string, SwarmAgent>; // by sessionID
  updatedAt: number;
}

/**
 * Tolerant structural view of a V2 server event envelope. Only `type` is
 * required; everything else narrows via the accessors below. The index
 * signature admits envelope extras (`id`, `location`, `durable`, ...).
 */
export interface HubEvent {
  type: string;
  created?: number;
  data?: Record<string, unknown>;
  [key: string]: unknown;
}

/** Delta stream emitted by the hub; consumers patch their own views. */
export type SwarmDelta =
  | { type: "agent.upsert"; agent: SwarmAgent }
  | { type: "agent.status"; sessionID: string; status: AgentStatus; at: number }
  | { type: "agent.tool"; sessionID: string; tool: SwarmAgent["currentTool"] }
  | { type: "agent.removed"; sessionID: string }
  | { type: "root.upsert"; sessionID: string };

/** Result of splitting a subagent title into task + optional agent name. */
export interface ParsedTitle {
  task: string;
  agent?: string;
}

// --- tolerant accessors (narrowing helpers the hub uses internally) --------

export function asRecord(
  data: Record<string, unknown> | undefined,
  key: string,
): Record<string, unknown> | undefined {
  const value = data?.[key];
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export function asString(
  data: Record<string, unknown> | undefined,
  key: string,
): string | undefined {
  const value = data?.[key];
  return typeof value === "string" ? value : undefined;
}

export function asNumber(
  data: Record<string, unknown> | undefined,
  key: string,
): number | undefined {
  const value = data?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function asStringArray(
  data: Record<string, unknown> | undefined,
  key: string,
): string[] | undefined {
  const value = data?.[key];
  return Array.isArray(value) && value.every((item) => typeof item === "string")
    ? value
    : undefined;
}
