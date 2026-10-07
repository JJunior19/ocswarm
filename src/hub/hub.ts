/**
 * SwarmHub (F1): folds OpenCode V2 server events into in-RAM swarm state and
 * emits deltas. 100% pure — no fs, no network, no @opencode imports.
 *
 * Behavioural choices (documented per the F1 plan):
 *
 * - Tool events (`tool.input.started/called/progress/success/failed`) do NOT
 *   materialize an agent for an unknown session. In the real captures the
 *   parent orchestrator's `session.created` predates the capture window, so
 *   its tool parts arrive orphaned; materializing them would show a phantom
 *   "unknown" agent (the fixtures pin exactly 1 and 2 agents respectively).
 *   Part→name/startedAt is still recorded globally, so tool names resolve the
 *   moment the session is known.
 * - Status / execution / rename events DO materialize a minimal agent
 *   (sessionID, agent "unknown", empty title/task, startedAt = event time) so
 *   late-joining streams never drop a live session. Materialized agents are
 *   never added to `roots` (parentage unknown).
 * - `session.usage.updated` is the single source of truth for tokens/cost
 *   (cumulative per session → overwrite, never add). `session.step.ended`
 *   tokens/cost are per-step and ignored; only its `files` merge into
 *   filesTouched (unique, first-seen order, capped at 50).
 * - `session.execution.interrupted` maps to `idle`, not `error`: the agent
 *   stopped on demand (user/shutdown/superseded/inactivity) — stopped ≠ failed.
 * - "currentTool null" from the plan prose is modelled as `undefined` (the
 *   optional `currentTool` field), so clearing emits `{ tool: undefined }`.
 * - `state.updatedAt` is bumped by every recognized, well-formed event
 *   (`event.created ?? Date.now()`). Unknown types and malformed events are
 *   ignored wholesale: no delta, no state change, no timestamp bump.
 */

import type {
  AgentStatus,
  HubEvent,
  ParsedTitle,
  SwarmAgent,
  SwarmDelta,
  SwarmState,
} from "./types";
import { asNumber, asRecord, asString, asStringArray } from "./types";

/** Public hub surface: fold events into state, emit deltas, read snapshots. */
export interface Hub {
  apply(event: HubEvent): SwarmDelta[];
  snapshot(): SwarmState;
}

/** Trailing `(@<name> subagent)` marker — present pre-2.0.24, absent since. */
const SUBAGENT_SUFFIX = /\s*\(@([\w.-]+) subagent\)\s*$/;

/** Hard cap for filesTouched so a runaway session cannot balloon the state. */
const FILES_CAP = 50;

/** In-flight tool call, keyed by tool-call part id. */
interface PendingTool {
  sessionID: string;
  name: string;
  startedAt: number;
}

export function parseSubagentTitle(title: string): ParsedTitle {
  const match = SUBAGENT_SUFFIX.exec(title);
  const agent = match?.[1];
  if (!match || agent === undefined) return { task: title };
  return { task: title.slice(0, match.index).trimEnd(), agent };
}

export function createHub(): Hub {
  const state: SwarmState = { roots: [], agents: {}, updatedAt: 0 };
  /** partID → in-flight tool call (global: names resolve even pre-materialization). */
  const pending = new Map<string, PendingTool>();
  /** sessionID → partID of the tool currently exposed as `currentTool`. */
  const currentPart = new Map<string, string>();

  function cloneTool(tool: SwarmAgent["currentTool"]): SwarmAgent["currentTool"] {
    return tool ? { ...tool } : undefined;
  }

  function cloneAgent(agent: SwarmAgent): SwarmAgent {
    return {
      ...agent,
      currentTool: cloneTool(agent.currentTool),
      toolCalls: agent.toolCalls.map((call) => ({ ...call })),
      tokens: { ...agent.tokens },
      filesTouched: [...agent.filesTouched],
    };
  }

  /** Minimal on-the-fly agent for late-joining streams; never added to roots. */
  function ensureAgent(sessionID: string, startedAt: number): SwarmAgent {
    const existing = state.agents[sessionID];
    if (existing) return existing;
    const agent: SwarmAgent = {
      sessionID,
      agent: "unknown",
      title: "",
      task: "",
      status: "idle",
      startedAt,
      toolCalls: [],
      tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      costUSD: 0,
      filesTouched: [],
    };
    state.agents[sessionID] = agent;
    return agent;
  }

  function apply(event: HubEvent): SwarmDelta[] {
    const data = event.data ?? {};
    const created = event.created ?? Date.now();
    const sessionID = asString(data, "sessionID");

    switch (event.type) {
      // Ignored on purpose: the agent stays running through provider retries.
      case "session.retry.scheduled":
        return [];

      case "session.created": {
        if (!sessionID) return [];
        state.updatedAt = created;
        const title = asString(data, "title") ?? "";
        const parsed = parseSubagentTitle(title);
        const parentID = asString(data, "parentID");
        // Agent-name priority: explicit data.agent → title suffix → "unknown".
        const name = asString(data, "agent") ?? parsed.agent ?? "unknown";
        const existing = state.agents[sessionID];
        // Re-creation refreshes identity (agent/title/parent/status, endedAt
        // back to undefined) while preserving accumulated mutable state for
        // already-known agents (toolCalls, tokens, costUSD, filesTouched,
        // currentTool ride along via the spread).
        const agent: SwarmAgent = existing
          ? {
              ...existing,
              parentID,
              agent: name,
              title,
              task: parsed.task,
              status: "idle",
              endedAt: undefined,
            }
          : {
              sessionID,
              parentID,
              agent: name,
              title,
              task: parsed.task,
              status: "idle",
              startedAt: created,
              endedAt: undefined,
              toolCalls: [],
              tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
              costUSD: 0,
              filesTouched: [],
            };
        state.agents[sessionID] = agent;
        const deltas: SwarmDelta[] = [];
        if (!parentID && !state.roots.includes(sessionID)) {
          state.roots.push(sessionID);
          deltas.push({ type: "root.upsert", sessionID });
        }
        deltas.push({ type: "agent.upsert", agent: cloneAgent(agent) });
        return deltas;
      }

      case "session.renamed": {
        if (!sessionID) return [];
        const title = asString(data, "title");
        if (title === undefined) return [];
        state.updatedAt = created;
        const agent = ensureAgent(sessionID, created);
        const parsed = parseSubagentTitle(title);
        agent.title = title;
        agent.task = parsed.task;
        return [{ type: "agent.upsert", agent: cloneAgent(agent) }];
      }

      case "session.status": {
        if (!sessionID) return [];
        // busy → running, retry → running (still active), idle → idle.
        const raw = asString(asRecord(data, "status"), "type");
        const status: AgentStatus | undefined =
          raw === "busy" || raw === "retry" ? "running" : raw === "idle" ? "idle" : undefined;
        if (!status) return [];
        state.updatedAt = created;
        const agent = ensureAgent(sessionID, created);
        agent.status = status;
        return [{ type: "agent.status", sessionID, status, at: created }];
      }

      case "session.idle": {
        if (!sessionID) return [];
        state.updatedAt = created;
        const agent = ensureAgent(sessionID, created);
        agent.status = "idle";
        return [{ type: "agent.status", sessionID, status: "idle", at: created }];
      }

      case "session.deleted": {
        if (!sessionID) return [];
        const hadAgent = sessionID in state.agents;
        const rootIndex = state.roots.indexOf(sessionID);
        if (!hadAgent && rootIndex < 0) return [];
        state.updatedAt = created;
        if (hadAgent) delete state.agents[sessionID];
        if (rootIndex >= 0) state.roots.splice(rootIndex, 1);
        return [{ type: "agent.removed", sessionID }];
      }

      case "session.tool.input.started": {
        const partID = asString(data, "id");
        if (!sessionID || !partID) return [];
        state.updatedAt = created;
        // The ONLY event carrying the tool name.
        const name = asString(data, "name") ?? "unknown";
        pending.set(partID, { sessionID, name, startedAt: created });
        const agent = state.agents[sessionID];
        if (!agent) return []; // orphaned tool part (pre-capture parent); see header note
        agent.currentTool = { name, startedAt: created };
        currentPart.set(sessionID, partID);
        return [{ type: "agent.tool", sessionID, tool: cloneTool(agent.currentTool) }];
      }

      case "session.tool.called": {
        const partID = asString(data, "id");
        if (!sessionID || !partID) return [];
        if (pending.has(partID)) return []; // name already known from input.started
        state.updatedAt = created;
        // input.started was missed → fall back to an "unknown" name.
        pending.set(partID, { sessionID, name: "unknown", startedAt: created });
        const agent = state.agents[sessionID];
        if (!agent) return []; // orphaned tool part; see header note
        agent.currentTool = { name: "unknown", startedAt: created };
        currentPart.set(sessionID, partID);
        return [{ type: "agent.tool", sessionID, tool: cloneTool(agent.currentTool) }];
      }

      case "session.tool.progress": {
        if (!sessionID) return [];
        const agent = state.agents[sessionID];
        const current = agent?.currentTool;
        if (!agent || !current) return [];
        const metadata = asRecord(data, "metadata");
        const summary = asString(metadata, "title") ?? asString(metadata, "description");
        if (summary === undefined || current.summary === summary) return [];
        state.updatedAt = created;
        current.summary = summary;
        return [{ type: "agent.tool", sessionID, tool: cloneTool(current) }];
      }

      case "session.tool.success":
      case "session.tool.failed": {
        const partID = asString(data, "id");
        if (!sessionID || !partID) return [];
        const recorded = pending.get(partID);
        pending.delete(partID);
        const agent = state.agents[sessionID];
        if (!agent) return []; // orphaned tool part; see header note
        state.updatedAt = created;
        agent.toolCalls.push({
          name: recorded?.name ?? "unknown",
          status: event.type === "session.tool.success" ? "completed" : "error",
          at: created,
        });
        const deltas: SwarmDelta[] = [];
        // Clear the visible tool only when the finished part IS the one being
        // shown — fixtures run several tool calls concurrently per agent.
        if (currentPart.get(sessionID) === partID) {
          currentPart.delete(sessionID);
          agent.currentTool = undefined;
          deltas.push({ type: "agent.tool", sessionID, tool: undefined });
        }
        return deltas;
      }

      case "session.execution.started": {
        if (!sessionID) return [];
        state.updatedAt = created;
        const agent = ensureAgent(sessionID, created);
        agent.status = "running";
        return [{ type: "agent.status", sessionID, status: "running", at: created }];
      }

      case "session.execution.succeeded": {
        if (!sessionID) return [];
        state.updatedAt = created;
        const agent = ensureAgent(sessionID, created);
        agent.status = "done";
        agent.endedAt = created;
        return [{ type: "agent.status", sessionID, status: "done", at: created }];
      }

      case "session.execution.failed": {
        if (!sessionID) return [];
        state.updatedAt = created;
        const agent = ensureAgent(sessionID, created);
        agent.status = "error";
        agent.endedAt = created;
        return [{ type: "agent.status", sessionID, status: "error", at: created }];
      }

      case "session.execution.interrupted": {
        if (!sessionID) return [];
        state.updatedAt = created;
        const agent = ensureAgent(sessionID, created);
        // idle, not error: interruption means "stopped on demand", not failure.
        agent.status = "idle";
        agent.endedAt = created;
        return [{ type: "agent.status", sessionID, status: "idle", at: created }];
      }

      case "session.step.ended": {
        if (!sessionID) return [];
        const agent = state.agents[sessionID];
        if (!agent) return []; // step events never materialize agents
        const files = asStringArray(data, "files");
        if (!files) return [];
        state.updatedAt = created;
        // Unique merge, first-seen order, capped. Per-step tokens/cost here are
        // deliberately ignored: session.usage.updated is authoritative.
        const seen = new Set(agent.filesTouched);
        let changed = false;
        for (const file of files) {
          if (agent.filesTouched.length >= FILES_CAP) break;
          if (seen.has(file)) continue;
          seen.add(file);
          agent.filesTouched.push(file);
          changed = true;
        }
        return changed ? [{ type: "agent.upsert", agent: cloneAgent(agent) }] : [];
      }

      case "session.usage.updated": {
        if (!sessionID) return [];
        const agent = state.agents[sessionID];
        if (!agent) return []; // usage never materializes agents (orphaned parents emit these too)
        const tokens = asRecord(data, "tokens");
        const cache = asRecord(tokens, "cache");
        state.updatedAt = created;
        // Cumulative for the session → OVERWRITE (missing fields keep the old value).
        agent.tokens = {
          input: asNumber(tokens, "input") ?? agent.tokens.input,
          output: asNumber(tokens, "output") ?? agent.tokens.output,
          cacheRead: asNumber(cache, "read") ?? agent.tokens.cacheRead,
          cacheWrite: asNumber(cache, "write") ?? agent.tokens.cacheWrite,
        };
        agent.costUSD = asNumber(data, "cost") ?? agent.costUSD;
        return [{ type: "agent.upsert", agent: cloneAgent(agent) }];
      }

      default:
        // Unknown event types are ignored wholesale: no delta, no state change.
        return [];
    }
  }

  function snapshot(): SwarmState {
    const agents: Record<string, SwarmAgent> = {};
    for (const [sessionID, agent] of Object.entries(state.agents)) {
      agents[sessionID] = cloneAgent(agent);
    }
    return { roots: [...state.roots], agents, updatedAt: state.updatedAt };
  }

  return { apply, snapshot };
}
