import { describe, expect, it } from "vitest";
import type { ClientState } from "./reducer";
import { rootSessions, subtreeOf } from "./tree";
import type { SwarmAgent } from "./types";

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

describe("rootSessions", () => {
  it("keeps only agents without parentID, most recent first", () => {
    const state: ClientState = {
      roots: [],
      agents: {
        old: agent({ sessionID: "old", startedAt: T0 }),
        new: agent({ sessionID: "new", startedAt: T0 + 10 }),
        kid: agent({ sessionID: "kid", parentID: "new", startedAt: T0 + 11 }),
      },
    };
    expect(rootSessions(state).map((root) => root.sessionID)).toEqual(["new", "old"]);
  });

  it("breaks startedAt ties deterministically by sessionID", () => {
    const state: ClientState = {
      roots: [],
      agents: {
        b: agent({ sessionID: "b", startedAt: T0 }),
        a: agent({ sessionID: "a", startedAt: T0 }),
      },
    };
    expect(rootSessions(state).map((root) => root.sessionID)).toEqual(["a", "b"]);
  });

  it("returns an empty list for an empty state", () => {
    expect(rootSessions({ roots: [], agents: {} })).toEqual([]);
  });
});

describe("subtreeOf", () => {
  it("collects direct children at depth 1", () => {
    const state: ClientState = {
      roots: [],
      agents: {
        root: agent({ sessionID: "root" }),
        a: agent({ sessionID: "a", parentID: "root" }),
        b: agent({ sessionID: "b", parentID: "root" }),
        other: agent({ sessionID: "other" }),
      },
    };
    const { ids, depth } = subtreeOf(state, "root");
    expect([...ids].sort()).toEqual(["a", "b", "root"]);
    expect(depth.get("root")).toBe(0);
    expect(depth.get("a")).toBe(1);
    expect(depth.get("b")).toBe(1);
  });

  it("walks nested delegation to any depth", () => {
    const state: ClientState = {
      roots: [],
      agents: {
        root: agent({ sessionID: "root" }),
        mid: agent({ sessionID: "mid", parentID: "root" }),
        leaf: agent({ sessionID: "leaf", parentID: "mid" }),
      },
    };
    const { ids, depth } = subtreeOf(state, "root");
    expect([...ids].sort()).toEqual(["leaf", "mid", "root"]);
    expect(depth.get("mid")).toBe(1);
    expect(depth.get("leaf")).toBe(2);
  });

  it("excludes orphans outside the subtree", () => {
    const state: ClientState = {
      roots: [],
      agents: {
        root: agent({ sessionID: "root" }),
        child: agent({ sessionID: "child", parentID: "root" }),
        orphan: agent({ sessionID: "orphan", parentID: "nowhere" }),
      },
    };
    const { ids } = subtreeOf(state, "root");
    expect(ids.has("orphan")).toBe(false);
  });

  it("returns empty results for a missing root", () => {
    const state: ClientState = {
      roots: [],
      agents: { a: agent({ sessionID: "a" }) },
    };
    const { ids, depth } = subtreeOf(state, "ghost");
    expect(ids.size).toBe(0);
    expect(depth.size).toBe(0);
  });

  it("terminates on a parentID cycle", () => {
    const state: ClientState = {
      roots: [],
      agents: {
        root: agent({ sessionID: "root" }),
        a: agent({ sessionID: "a", parentID: "root" }),
        b: agent({ sessionID: "b", parentID: "a" }),
      },
    };
    // Corrupt the mirror: b claims root as parent, root claims b → loop.
    state.agents.root = agent({ sessionID: "root", parentID: "b" });
    const { ids, depth } = subtreeOf(state, "root");
    expect(ids.size).toBe(3);
    expect(depth.get("a")).toBe(1);
    expect(depth.get("b")).toBe(2);
  });
});
