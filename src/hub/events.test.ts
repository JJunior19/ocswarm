import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ARCHIVED_CAP, createHub, parseSubagentTitle } from "./hub";
import type { HubEvent, SwarmDelta } from "./types";

function must<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("expected a value, got undefined");
  return value;
}

/** Read a captured NDJSON fixture into hub events (plain fs + JSON.parse). */
function readFixture(name: string): HubEvent[] {
  const path = fileURLToPath(new URL(`./__fixtures__/${name}`, import.meta.url));
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as HubEvent);
}

function runFixture(name: string): { hub: ReturnType<typeof createHub>; deltas: SwarmDelta[] } {
  const hub = createHub();
  const deltas: SwarmDelta[] = [];
  for (const event of readFixture(name)) deltas.push(...hub.apply(event));
  return { hub, deltas };
}

describe("subagent-lifecycle fixture (real capture)", () => {
  const { hub, deltas } = runFixture("subagent-lifecycle.ndjson");
  const snapshot = hub.snapshot();
  const childID = must(Object.keys(snapshot.agents)[0]);
  const child = must(snapshot.agents[childID]);

  it("tracks exactly one agent: the subagent child, never a root", () => {
    expect(Object.keys(snapshot.agents)).toHaveLength(1);
    expect(child.parentID).toBe("ses_ee9ea6bc3ffeTD7rIDjTy0W6gJ");
    expect(snapshot.roots).toHaveLength(0);
    expect(snapshot.roots).not.toContain(childID);
  });

  it("resolves agent name and task from session.created", () => {
    expect(child.agent).toBe("general");
    expect(child.title).toBe("Fixture: parallel subagent run");
    expect(child.task).toBe(child.title);
  });

  it("ends done with endedAt set from execution.succeeded", () => {
    expect(child.status).toBe("done");
    expect(child.endedAt).toBe(1791373245094);
  });

  it("resolves tool names from tool.input.started and records them completed", () => {
    expect(child.toolCalls.length).toBeGreaterThan(0);
    for (const call of child.toolCalls) {
      expect(call.name).not.toBe("unknown");
      expect(call.status).toBe("completed");
    }
    expect(child.toolCalls.map((call) => call.name).sort()).toEqual(["read", "shell", "shell"]);
    expect(child.currentTool).toBeUndefined();
  });

  it("overwrites tokens from the last cumulative usage.updated", () => {
    expect(child.tokens.input).toBeGreaterThan(0);
    expect(child.tokens).toEqual({ input: 6945, output: 103, cacheRead: 10432, cacheWrite: 0 });
  });

  it("emits agent.tool deltas plus a final done status, and no root.upsert", () => {
    expect(deltas.some((delta) => delta.type === "agent.tool")).toBe(true);
    const last = must(deltas.at(-1));
    expect(last).toMatchObject({ type: "agent.status", sessionID: childID, status: "done" });
    expect(deltas.some((delta) => delta.type === "root.upsert")).toBe(false);
  });
});

describe("subagent-parallel fixture (real capture)", () => {
  const { hub } = runFixture("subagent-parallel.ndjson");
  const snapshot = hub.snapshot();
  const byAgent = new Map(Object.values(snapshot.agents).map((agent) => [agent.agent, agent]));

  it("tracks exactly the two children, both done, roots empty", () => {
    expect(Object.keys(snapshot.agents)).toHaveLength(2);
    expect(snapshot.roots).toEqual([]);
    const general = must(byAgent.get("general"));
    const explore = must(byAgent.get("explore"));
    expect(general.agent).toBe("general"); // from data.agent
    expect(explore.agent).toBe("explore");
    expect(general.parentID).toBeDefined();
    expect(explore.parentID).toBeDefined();
    expect(general.status).toBe("done");
    expect(explore.status).toBe("done");
  });
});

describe("root-session fixture (real capture, provider failure)", () => {
  const { hub, deltas } = runFixture("root-session.ndjson");
  const snapshot = hub.snapshot();
  const rootID = "ses_ee9d4663cffe1u1f3m0BhwqvzH";

  it("registers the root exactly once and ends in error", () => {
    expect(deltas.filter((delta) => delta.type === "root.upsert")).toEqual([
      { type: "root.upsert", sessionID: rootID },
    ]);
    expect(snapshot.roots).toEqual([rootID]);
    const root = must(snapshot.agents[rootID]);
    expect(root.status).toBe("error");
    expect(root.endedAt).toBe(1791373421806);
    expect(must(deltas.at(-1))).toMatchObject({ type: "agent.status", status: "error" });
  });

  it("ignores session.retry.scheduled (agent stays running)", () => {
    const fresh = createHub();
    fresh.apply({ type: "session.created", created: 1, data: { sessionID: "ses_r" } });
    expect(
      fresh.apply({
        type: "session.retry.scheduled",
        created: 2,
        data: { sessionID: "ses_r", attempt: 2 },
      }),
    ).toEqual([]);
    expect(must(fresh.snapshot().agents["ses_r"]).status).toBe("idle");
  });
});

describe("synthetic session.tool.failed", () => {
  it("records an error toolCall and clears currentTool", () => {
    const hub = createHub();
    hub.apply({
      type: "session.created",
      created: 1000,
      data: {
        sessionID: "ses_child",
        parentID: "ses_parent",
        agent: "general",
        title: "Try a thing",
      },
    });
    expect(
      hub.apply({
        type: "session.tool.input.started",
        created: 1010,
        data: { sessionID: "ses_child", assistantMessageID: "msg_1", id: "call_1", name: "shell" },
      }),
    ).toEqual([
      { type: "agent.tool", sessionID: "ses_child", tool: { name: "shell", startedAt: 1010 } },
    ]);

    // Synthetic event — shape per @opencode/client v2.0.24 (session.tool.failed never
    // appears in the captured fixtures, so this replays its exact envelope shape).
    const failed = hub.apply({
      id: "evt_synthetic_1",
      created: 1020,
      type: "session.tool.failed",
      location: { directory: "/Users/jorgeccarhuasaroni/orca/ocswarm" },
      data: {
        sessionID: "ses_child",
        assistantMessageID: "msg_1",
        id: "call_1",
        error: { type: "tool", message: "boom" },
        executed: true,
      },
      durable: { aggregateID: "ses_child", seq: 1, version: 1 },
    });

    expect(failed).toEqual([{ type: "agent.tool", sessionID: "ses_child", tool: undefined }]);
    const agent = must(hub.snapshot().agents["ses_child"]);
    expect(agent.toolCalls).toEqual([{ name: "shell", status: "error", at: 1020 }]);
    expect(agent.currentTool).toBeUndefined();
  });
});

describe("synthetic session.deleted", () => {
  /** Root + subagent child, both known to the hub. */
  function seededHub(): ReturnType<typeof createHub> {
    const hub = createHub();
    hub.apply({
      type: "session.created",
      created: 10,
      data: { sessionID: "ses_root", title: "root" },
    });
    hub.apply({
      type: "session.created",
      created: 11,
      data: {
        sessionID: "ses_kid",
        parentID: "ses_root",
        agent: "explore",
        title: "peek (@explore subagent)",
      },
    });
    return hub;
  }

  it("archives the agent instead of removing it (flag + endedAt + truthful status)", () => {
    const hub = seededHub();
    hub.apply({ type: "session.execution.started", created: 12, data: { sessionID: "ses_kid" } });
    expect(hub.snapshot().roots).toEqual(["ses_root"]); // the kid is a subagent, never a root

    const deltas = hub.apply({
      type: "session.deleted",
      created: 13,
      data: { sessionID: "ses_kid" },
    });
    expect(deltas).toEqual([
      {
        type: "agent.upsert",
        agent: expect.objectContaining({
          sessionID: "ses_kid",
          archived: true,
          status: "running", // deleted mid-run keeps its true status; the UI dims by flag
          endedAt: 13,
        }),
      },
    ]);
    const kid = must(hub.snapshot().agents["ses_kid"]);
    expect(kid.archived).toBe(true);
    expect(kid.status).toBe("running");
    expect(kid.endedAt).toBe(13);
    expect(hub.snapshot().roots).toEqual(["ses_root"]); // subagent had no root entry to drop
  });

  it("archives a root by dropping it from roots, keeping done status and endedAt", () => {
    const hub = seededHub();
    hub.apply({
      type: "session.execution.succeeded",
      created: 12,
      data: { sessionID: "ses_root" },
    });

    const deltas = hub.apply({
      type: "session.deleted",
      created: 13,
      data: { sessionID: "ses_root" },
    });
    expect(deltas).toEqual([
      {
        type: "agent.upsert",
        agent: expect.objectContaining({
          sessionID: "ses_root",
          archived: true,
          status: "done",
          endedAt: 12, // ??= keeps the real end time, not the deletion time
        }),
      },
    ]);
    expect(hub.snapshot().roots).toEqual([]);
    expect(must(hub.snapshot().agents["ses_root"]).archived).toBe(true);
  });

  it("re-deleting an already-archived session is a no-op", () => {
    const hub = seededHub();
    hub.apply({ type: "session.deleted", created: 12, data: { sessionID: "ses_kid" } });
    const before = hub.snapshot();
    expect(
      hub.apply({ type: "session.deleted", created: 13, data: { sessionID: "ses_kid" } }),
    ).toEqual([]);
    expect(hub.snapshot()).toEqual(before);
  });

  it("evicts the oldest archived agents beyond the cap, emitting agent.removed", () => {
    const hub = createHub();
    // ARCHIVED_CAP + 1 subagent sessions, created (and archived) oldest first.
    for (let i = 0; i <= ARCHIVED_CAP; i++) {
      hub.apply({
        type: "session.created",
        created: 100 + i,
        data: {
          sessionID: `ses_a${i}`,
          parentID: "ses_parent",
          agent: "explore",
          title: `archivable ${i}`,
        },
      });
    }
    for (let i = 0; i <= ARCHIVED_CAP; i++) {
      const deltas = hub.apply({
        type: "session.deleted",
        created: 1000 + i,
        data: { sessionID: `ses_a${i}` },
      });
      if (i < ARCHIVED_CAP) {
        // Under the cap: pure upserts, nothing evicted yet.
        expect(deltas.map((delta) => delta.type)).toEqual(["agent.upsert"]);
      } else {
        // The (CAP+1)-th archive evicts exactly the oldest archived agent.
        expect(deltas).toEqual([
          {
            type: "agent.upsert",
            agent: expect.objectContaining({ sessionID: `ses_a${i}`, archived: true }),
          },
          { type: "agent.removed", sessionID: "ses_a0" },
        ]);
      }
    }
    const snapshot = hub.snapshot();
    expect(Object.keys(snapshot.agents)).toHaveLength(ARCHIVED_CAP);
    expect(snapshot.agents["ses_a0"]).toBeUndefined(); // oldest evicted fully
    expect(must(snapshot.agents["ses_a1"]).archived).toBe(true); // newer kept
    expect(must(snapshot.agents[`ses_a${ARCHIVED_CAP}`]).archived).toBe(true); // newest kept
  });

  it("re-creating a deleted session clears the archived flag", () => {
    const hub = seededHub();
    hub.apply({ type: "session.deleted", created: 12, data: { sessionID: "ses_root" } });
    expect(must(hub.snapshot().agents["ses_root"]).archived).toBe(true);
    hub.apply({
      type: "session.created",
      created: 13,
      data: { sessionID: "ses_root", title: "root round two" },
    });
    const root = must(hub.snapshot().agents["ses_root"]);
    expect(root.archived).toBeUndefined();
    expect(root.status).toBe("idle");
    expect(root.endedAt).toBeUndefined();
    expect(hub.snapshot().roots).toEqual(["ses_root"]);
  });
});

describe("unknown and ignored events", () => {
  it("returns [] and leaves state untouched", () => {
    const hub = createHub();
    hub.apply({ type: "session.created", created: 5, data: { sessionID: "ses_a" } });
    const before = hub.snapshot();
    expect(
      hub.apply({
        type: "session.cargo.cult",
        created: 6,
        data: { sessionID: "ses_a", odd: true },
      }),
    ).toEqual([]);
    expect(
      hub.apply({
        type: "session.retry.scheduled",
        created: 7,
        data: { sessionID: "ses_a", attempt: 2 },
      }),
    ).toEqual([]);
    expect(hub.snapshot()).toEqual(before);
  });
});

describe("session.status mapping", () => {
  it("maps busy→running, retry→running, idle→idle", () => {
    const hub = createHub();
    hub.apply({ type: "session.created", created: 1, data: { sessionID: "ses_s" } });
    expect(
      hub.apply({
        type: "session.status",
        created: 2,
        data: { sessionID: "ses_s", status: { type: "busy" } },
      }),
    ).toEqual([{ type: "agent.status", sessionID: "ses_s", status: "running", at: 2 }]);
    expect(
      hub.apply({
        type: "session.status",
        created: 3,
        data: { sessionID: "ses_s", status: { type: "retry", attempt: 2, message: "503" } },
      }),
    ).toEqual([{ type: "agent.status", sessionID: "ses_s", status: "running", at: 3 }]);
    expect(
      hub.apply({
        type: "session.status",
        created: 4,
        data: { sessionID: "ses_s", status: { type: "idle" } },
      }),
    ).toEqual([{ type: "agent.status", sessionID: "ses_s", status: "idle", at: 4 }]);
    expect(must(hub.snapshot().agents["ses_s"]).status).toBe("idle");
  });
});

describe("parseSubagentTitle", () => {
  it("strips a suffix and extracts the agent", () => {
    expect(parseSubagentTitle("Fix login (@explore subagent)")).toEqual({
      task: "Fix login",
      agent: "explore",
    });
  });

  it("leaves bare titles untouched (v2.0.24 style)", () => {
    expect(parseSubagentTitle("Fixture: parallel subagent run")).toEqual({
      task: "Fixture: parallel subagent run",
    });
  });

  it("accepts dots, dashes and underscores in agent names", () => {
    expect(parseSubagentTitle("Do it (@a.b-c_d subagent)")).toEqual({
      task: "Do it",
      agent: "a.b-c_d",
    });
  });
});

describe("late-joining streams", () => {
  it("materializes a minimal agent from execution events on unknown sessions", () => {
    const hub = createHub();
    expect(
      hub.apply({
        type: "session.execution.started",
        created: 20,
        data: { sessionID: "ses_late" },
      }),
    ).toEqual([{ type: "agent.status", sessionID: "ses_late", status: "running", at: 20 }]);
    const late = must(hub.snapshot().agents["ses_late"]);
    expect(late.agent).toBe("unknown");
    expect(late.title).toBe("");
    expect(late.startedAt).toBe(20);
    expect(hub.snapshot().roots).toEqual([]); // parentage unknown → never a root
  });

  it("backfills the real agent name from step.started for unknown agents", () => {
    const hub = createHub();
    hub.apply({ type: "session.execution.started", created: 20, data: { sessionID: "ses_late" } });
    const deltas = hub.apply({
      type: "session.step.started",
      created: 30,
      data: {
        sessionID: "ses_late",
        assistantMessageID: "msg_1",
        agent: "gentle-orchestrator",
        model: { id: "m", providerID: "p" },
      },
    });
    expect(deltas).toEqual([
      {
        type: "agent.upsert",
        agent: expect.objectContaining({ sessionID: "ses_late", agent: "gentle-orchestrator" }),
      },
    ]);
    expect(must(hub.snapshot().agents["ses_late"]).agent).toBe("gentle-orchestrator");
  });

  it("never overwrites a known agent name and never materializes from step events", () => {
    const hub = createHub();
    hub.apply({
      type: "session.created",
      created: 1,
      data: { sessionID: "ses_known", agent: "general", title: "Do things" },
    });
    expect(
      hub.apply({
        type: "session.step.started",
        created: 5,
        data: {
          sessionID: "ses_known",
          assistantMessageID: "msg_1",
          agent: "something-else",
          model: { id: "m", providerID: "p" },
        },
      }),
    ).toEqual([]);
    expect(must(hub.snapshot().agents["ses_known"]).agent).toBe("general");
    // Step events for a completely unknown session do not create agents.
    expect(
      hub.apply({
        type: "session.step.started",
        created: 6,
        data: {
          sessionID: "ses_ghost",
          assistantMessageID: "msg_2",
          agent: "explore",
          model: { id: "m", providerID: "p" },
        },
      }),
    ).toEqual([]);
    expect(hub.snapshot().agents["ses_ghost"]).toBeUndefined();
  });
});

describe("live cost from injected pricing", () => {
  /** USD per million tokens — fake rates for the fixture-shaped model p/m. */
  const RATES = { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 0.5 };
  /**
   * Hand-computed weighted sum: 1×1 + 2×0.5 + 0.1×0.25 + 0.5×0.1
   * = 1 + 1 + 0.025 + 0.05 → $2.075.
   */
  const EXPECTED_COST =
    (1_000_000 * RATES.input +
      500_000 * RATES.output +
      250_000 * RATES.cacheRead +
      100_000 * RATES.cacheWrite) /
    1_000_000;

  /** Cumulative usage as captured from the server: `cost` is 0 (unpopulated). */
  const USAGE = {
    sessionID: "ses_cost",
    cost: 0,
    tokens: { input: 1_000_000, output: 500_000, cache: { read: 250_000, write: 100_000 } },
  };

  function pricedHub(): ReturnType<typeof createHub> {
    return createHub({
      pricing: ({ providerID, modelID }) =>
        providerID === "p" && modelID === "m" ? RATES : undefined,
    });
  }

  function seedModelStep(hub: ReturnType<typeof createHub>): void {
    hub.apply({
      type: "session.created",
      created: 1,
      data: { sessionID: "ses_cost", agent: "general", title: "Cost test" },
    });
    hub.apply({
      type: "session.step.started",
      created: 2,
      data: {
        sessionID: "ses_cost",
        assistantMessageID: "msg_1",
        agent: "general",
        model: { id: "m", providerID: "p" },
      },
    });
  }

  it("computes costUSD from cumulative tokens × injected rates", () => {
    const hub = pricedHub();
    seedModelStep(hub);
    hub.apply({ type: "session.usage.updated", created: 3, data: USAGE });
    const agent = must(hub.snapshot().agents.ses_cost);
    expect(agent.costUSD).toBeCloseTo(EXPECTED_COST, 12);
    expect(agent.costUSD).toBeCloseTo(2.075, 12);
  });

  it("recomputes costUSD on every cumulative usage overwrite", () => {
    const hub = pricedHub();
    seedModelStep(hub);
    hub.apply({ type: "session.usage.updated", created: 3, data: USAGE });
    hub.apply({
      type: "session.usage.updated",
      created: 4,
      data: {
        ...USAGE,
        tokens: { input: 2_000_000, output: 1_000_000, cache: { read: 500_000, write: 200_000 } },
      },
    });
    expect(must(hub.snapshot().agents.ses_cost).costUSD).toBeCloseTo(EXPECTED_COST * 2, 12);
  });

  it("keeps cost at 0 when usage arrives without any prior step.started", () => {
    const hub = pricedHub();
    hub.apply({
      type: "session.created",
      created: 1,
      data: { sessionID: "ses_cost", agent: "general", title: "Cost test" },
    });
    hub.apply({ type: "session.usage.updated", created: 3, data: USAGE });
    expect(must(hub.snapshot().agents.ses_cost).costUSD).toBe(0);
  });

  it("keeps cost at 0 when pricing returns no rates for the model", () => {
    const hub = createHub({ pricing: () => undefined });
    seedModelStep(hub);
    hub.apply({ type: "session.usage.updated", created: 3, data: USAGE });
    expect(must(hub.snapshot().agents.ses_cost).costUSD).toBe(0);
  });

  it("default createHub() stays backwards compatible (no pricing → cost 0)", () => {
    const hub = createHub();
    seedModelStep(hub);
    hub.apply({ type: "session.usage.updated", created: 3, data: USAGE });
    expect(must(hub.snapshot().agents.ses_cost).costUSD).toBe(0);
  });

  it("does not bill the reasoning bucket (it rides inside output)", () => {
    const hub = pricedHub();
    seedModelStep(hub);
    hub.apply({
      type: "session.usage.updated",
      created: 3,
      data: { ...USAGE, tokens: { ...USAGE.tokens, reasoning: 987_654 } },
    });
    expect(must(hub.snapshot().agents.ses_cost).costUSD).toBeCloseTo(EXPECTED_COST, 12);
  });

  it("session.deleted clears the model so a recreated session costs 0 again", () => {
    const hub = pricedHub();
    seedModelStep(hub);
    hub.apply({ type: "session.deleted", created: 4, data: { sessionID: "ses_cost" } });
    hub.apply({
      type: "session.created",
      created: 5,
      data: { sessionID: "ses_cost", agent: "general", title: "Cost test again" },
    });
    hub.apply({ type: "session.usage.updated", created: 6, data: USAGE });
    expect(must(hub.snapshot().agents.ses_cost).costUSD).toBe(0);
  });
});

describe("snapshot isolation", () => {
  it("never exposes internal references", () => {
    const hub = createHub();
    hub.apply({ type: "session.created", created: 1, data: { sessionID: "ses_a" } });
    const snapshot = hub.snapshot();
    must(snapshot.agents["ses_a"]).toolCalls.push({ name: "mutated", status: "completed", at: 2 });
    snapshot.roots.push("ses_sneaky");
    const fresh = hub.snapshot();
    expect(must(fresh.agents["ses_a"]).toolCalls).toEqual([]);
    expect(fresh.roots).toEqual(["ses_a"]);
  });
});

describe("zero I/O constraint", () => {
  it("hub production modules import no node or @opencode modules", () => {
    const dir = fileURLToPath(new URL(".", import.meta.url));
    const sources = readdirSync(dir).filter(
      (name) => name.endsWith(".ts") && !name.endsWith(".test.ts"),
    );
    expect(sources).toEqual(expect.arrayContaining(["hub.ts", "types.ts"]));
    for (const name of sources) {
      const source = readFileSync(`${dir}${name}`, "utf8");
      expect(source, name).not.toMatch(/from "node:/);
      expect(source, name).not.toMatch(/@opencode\//);
    }
  });
});

describe("hub.setTitle (F5.3 title backfill)", () => {
  it("sets a late-joined session's title and emits agent.upsert", () => {
    const hub = createHub();
    hub.apply({ type: "session.execution.started", created: 20, data: { sessionID: "ses_late" } });
    const deltas = hub.setTitle("ses_late", "Implementar ocswarm: fase 2", 30);
    expect(deltas).toHaveLength(1);
    expect(must(deltas[0]).type).toBe("agent.upsert");
    expect(must(hub.snapshot().agents["ses_late"]).title).toBe("Implementar ocswarm: fase 2");
  });

  it("is a no-op for unknown sessions, empty titles, and unchanged values", () => {
    const hub = createHub();
    hub.apply({
      type: "session.created",
      created: 1,
      data: { sessionID: "s", agent: "general", title: "T" },
    });
    expect(hub.setTitle("ses_ghost", "x", 2)).toEqual([]);
    expect(hub.setTitle("s", "", 3)).toEqual([]);
    expect(hub.setTitle("s", "T", 4)).toEqual([]);
    expect(must(hub.snapshot().agents["s"]).title).toBe("T");
  });
});
