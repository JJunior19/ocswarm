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
 * - Identity backfill: `session.step.started` carries the driving agent's
 *   name, so a materialized "unknown" agent adopts its real name on the next
 *   step (patch-only — step events never materialize).
 * - `session.usage.updated` is the single source of truth for tokens/cost
 *   (cumulative per session → overwrite, never add). `session.step.ended`
 *   tokens/cost are per-step and ignored; only its `files` merge into
 *   filesTouched (unique, first-seen order, capped at 50).
 * - Live cost (F5.2): captured usage events carry `cost: 0`, so when the
 *   session's model (tracked from `session.step.started`'s `data.model`) has
 *   rates via injected `deps.pricing`, costUSD is computed as
 *   `(input×r.input + output×r.output + cacheRead×r.cacheRead +
 *   cacheWrite×r.cacheWrite) / 1e6`. The `reasoning` bucket is NOT billed —
 *   it rides inside output. Without a known model or rates, the event's own
 *   `cost` field is kept as before (0 in practice — never fabricate).
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
  setTitle(sessionID: string, title: string, at?: number): SwarmDelta[];
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

/** Rates in USD per million tokens for one model (models.dev pricing). */
export interface PricingRate {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

/** A driving model identity as carried by `session.step.started`. */
export interface ModelRef {
  providerID: string;
  modelID: string;
}

/** Optional hub dependencies; everything defaults to today's behaviour. */
export interface HubDeps {
  /**
   * Rate lookup for live cost computation. Returning undefined (or omitting
   * the dependency entirely) keeps the event's own `cost` field — never
   * fabricate a rate.
   */
  pricing?: (model: ModelRef) => PricingRate | undefined;
}

export function parseSubagentTitle(title: string): ParsedTitle {
  const match = SUBAGENT_SUFFIX.exec(title);
  const agent = match?.[1];
  if (!match || agent === undefined) return { task: title };
  return { task: title.slice(0, match.index).trimEnd(), agent };
}

export function createHub(deps: HubDeps = {}): Hub {
  const state: SwarmState = { roots: [], agents: {}, updatedAt: 0 };
  /** partID → in-flight tool call (global: names resolve even pre-materialization). */
  const pending = new Map<string, PendingTool>();
  /** sessionID → partID of the tool currently exposed as `currentTool`. */
  const currentPart = new Map<string, string>();
  /** sessionID → last driving model (usage.updated carries no model — see F5.2). */
  const sessionModel = new Map<string, ModelRef>();

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
        sessionModel.delete(sessionID); // recreated sessions restart unpriced
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

      // Late-join identity backfill: step.started carries the driving agent's
      // name, so an agent materialized as "unknown" (its session.created
      // predated the plugin) gets its real name here. Patches only existing
      // agents — step events still never materialize (no phantom orchestrators).
      case "session.step.started": {
        if (!sessionID) return [];
        // Track the session's driving model for live cost (F5.2): usage.updated
        // carries no model, and this event already parses structured data here.
        // Internal bookkeeping only — no delta, no timestamp bump.
        const model = asRecord(data, "model");
        const modelID = asString(model, "id");
        const providerID = asString(model, "providerID");
        if (modelID && providerID) sessionModel.set(sessionID, { providerID, modelID });
        const agent = state.agents[sessionID];
        if (agent?.agent !== "unknown") return [];
        const name = asString(data, "agent");
        if (!name) return [];
        state.updatedAt = created;
        agent.agent = name;
        return [{ type: "agent.upsert", agent: { ...agent } }];
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
        // Real usage events carry `cost: 0`, so compute from the injected
        // pricing when this session's model has rates (F5.2). Reasoning tokens
        // ride inside output and are not billed again. No model/rates → keep
        // the event's own `cost` field (never fabricate).
        const model = sessionModel.get(sessionID);
        const rates = model ? deps.pricing?.(model) : undefined;
        agent.costUSD =
          rates !== undefined
            ? (agent.tokens.input * rates.input +
                agent.tokens.output * rates.output +
                agent.tokens.cacheRead * rates.cacheRead +
                agent.tokens.cacheWrite * rates.cacheWrite) /
              1_000_000
            : (asNumber(data, "cost") ?? agent.costUSD);
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

  /**
   * Backfill a session's title out-of-band (F5.3): the TUI posts the current
   * session title so late-joined sessions recover their identity. No-op for
   * unknown sessions, empty titles, and unchanged values. Never materializes.
   */
  function setTitle(sessionID: string, title: string, at: number = Date.now()): SwarmDelta[] {
    const agent = state.agents[sessionID];
    if (!agent || !title || agent.title === title) return [];
    agent.title = title;
    state.updatedAt = at;
    return [{ type: "agent.upsert", agent: cloneAgent(agent) }];
  }

  return { apply, snapshot, setTitle };
}
