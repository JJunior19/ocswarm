import { describe, expect, it } from "vitest";
import { applyDelta, applySnapshot, type ClientState, deriveRows } from "./reducer";
import type { SwarmAgent, SwarmState } from "./types";

const T0 = 1_000_000;

function agent(overrides: Partial<SwarmAgent> = {}): SwarmAgent {
  return {
    sessionID: "s1",
    agent: "general",
    title: "do things",
    task: "do things",
    status: "idle",
    startedAt: T0,
    toolCalls: [],
    tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    costUSD: 0,
    filesTouched: [],
    ...overrides,
  };
}

const EMPTY: ClientState = { roots: [], agents: {} };

describe("malformed agent.upsert frames", () => {
  it("are ignored instead of poisoning the agent map", () => {
    let state = applySnapshot(EMPTY, {
      roots: ["s1"],
      agents: { s1: agent() },
      updatedAt: T0,
    });

    // Historical corruption: the server replayed the BARE agent object, so the
    // client spread produced agent = "general" (the name string) and stored a
    // string under key undefined.
    const malformed = {
      type: "agent.upsert",
      sessionID: "s1",
      agent: "general",
      title: "do things",
    } as unknown as Parameters<typeof applyDelta>[1];
    state = applyDelta(state, malformed);
    expect(Object.keys(state.agents)).toEqual(["s1"]);
    expect(state.agents["s1"]?.tokens).toBeDefined();

    // A missing agent payload is equally a no-op.
    state = applyDelta(state, {
      type: "agent.upsert",
      agent: undefined as unknown as SwarmAgent,
    });
    expect(Object.keys(state.agents)).toEqual(["s1"]);
  });
});

describe("applySnapshot", () => {
  it("replaces roots and agents from the snapshot", () => {
    const prev: ClientState = {
      roots: ["stale"],
      agents: { stale: agent({ sessionID: "stale" }) },
    };
    const snap: SwarmState = {
      roots: ["r1"],
      agents: { r1: agent({ sessionID: "r1" }) },
      updatedAt: 42,
    };
    expect(applySnapshot(prev, snap)).toEqual({
      roots: ["r1"],
      agents: { r1: agent({ sessionID: "r1" }) },
    });
  });
});

describe("applyDelta", () => {
  it("agent.upsert replaces the whole entry and leaves roots alone", () => {
    const state: ClientState = { roots: ["s1"], agents: { s1: agent() } };
    const next = applyDelta(state, { type: "agent.upsert", agent: agent({ status: "running" }) });
    expect(next.agents.s1?.status).toBe("running");
    expect(next.roots).toEqual(["s1"]);
  });

  it("agent.upsert materializes an unknown session", () => {
    const next = applyDelta(EMPTY, { type: "agent.upsert", agent: agent() });
    expect(next.agents.s1?.sessionID).toBe("s1");
    expect(next.roots).toEqual([]);
  });

  it("agent.status running clears endedAt; done/error stamp it", () => {
    let state: ClientState = { roots: [], agents: { s1: agent({ status: "error", endedAt: T0 }) } };
    state = applyDelta(state, {
      type: "agent.status",
      sessionID: "s1",
      status: "running",
      at: T0 + 1,
    });
    expect(state.agents.s1).toMatchObject({ status: "running", endedAt: undefined });
    state = applyDelta(state, {
      type: "agent.status",
      sessionID: "s1",
      status: "done",
      at: T0 + 2,
    });
    expect(state.agents.s1).toMatchObject({ status: "done", endedAt: T0 + 2 });
    state = applyDelta(state, {
      type: "agent.status",
      sessionID: "s1",
      status: "error",
      at: T0 + 3,
    });
    expect(state.agents.s1?.endedAt).toBe(T0 + 3);
  });

  it("agent.status idle leaves endedAt as-is", () => {
    const state: ClientState = {
      roots: [],
      agents: { s1: agent({ status: "done", endedAt: T0 }) },
    };
    const next = applyDelta(state, {
      type: "agent.status",
      sessionID: "s1",
      status: "idle",
      at: T0 + 1,
    });
    expect(next.agents.s1).toMatchObject({ status: "idle", endedAt: T0 });
  });

  it("agent.status ignores unknown sessions", () => {
    expect(
      applyDelta(EMPTY, { type: "agent.status", sessionID: "x", status: "running", at: T0 }),
    ).toBe(EMPTY);
  });

  it("agent.tool sets and clears currentTool (missing field clears)", () => {
    let state: ClientState = { roots: [], agents: { s1: agent() } };
    state = applyDelta(state, {
      type: "agent.tool",
      sessionID: "s1",
      tool: { name: "read", startedAt: T0 + 1 },
    });
    expect(state.agents.s1?.currentTool).toEqual({ name: "read", startedAt: T0 + 1 });
    // On the wire `tool: undefined` serializes away entirely (JSON.stringify).
    state = applyDelta(state, { type: "agent.tool", sessionID: "s1", tool: undefined });
    expect(state.agents.s1?.currentTool).toBeUndefined();
  });

  it("agent.removed deletes the agent and its root entry", () => {
    const state: ClientState = {
      roots: ["s1", "s2"],
      agents: { s1: agent(), s2: agent({ sessionID: "s2" }) },
    };
    const next = applyDelta(state, { type: "agent.removed", sessionID: "s1" });
    expect(next.agents.s1).toBeUndefined();
    expect(next.agents.s2).toBeDefined();
    expect(next.roots).toEqual(["s2"]);
  });

  it("root.upsert adds a root only once", () => {
    let state = applyDelta(EMPTY, { type: "root.upsert", sessionID: "r1" });
    expect(state.roots).toEqual(["r1"]);
    state = applyDelta(state, { type: "root.upsert", sessionID: "r1" });
    expect(state.roots).toEqual(["r1"]);
  });
});

describe("deriveRows", () => {
  it("assigns depth 0 to roots and 1 to children, sorted by startedAt", () => {
    const state: ClientState = {
      roots: ["late-root"],
      agents: {
        "late-root": agent({ sessionID: "late-root", startedAt: T0 + 50 }),
        child: agent({ sessionID: "child", parentID: "late-root", startedAt: T0 + 10 }),
        other: agent({ sessionID: "other", startedAt: T0 + 20 }),
      },
    };
    const rows = deriveRows(state);
    expect(rows.map((row) => [row.agent.sessionID, row.depth])).toEqual([
      ["child", 1],
      ["other", 0],
      ["late-root", 0],
    ]);
  });

  it("breaks startedAt ties deterministically by sessionID", () => {
    const state: ClientState = {
      roots: [],
      agents: {
        b: agent({ sessionID: "b", startedAt: T0 }),
        a: agent({ sessionID: "a", startedAt: T0 }),
      },
    };
    expect(deriveRows(state).map((row) => row.agent.sessionID)).toEqual(["a", "b"]);
  });
});
