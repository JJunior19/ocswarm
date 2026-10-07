import { describe, expect, it } from "vitest";
import { computeGanttScale } from "./ganttScale";
import type { SwarmAgent } from "./types";

function agent(overrides: Partial<SwarmAgent>): SwarmAgent {
  return {
    sessionID: "s",
    agent: "explore",
    title: "t",
    task: "k",
    status: "done",
    startedAt: 0,
    toolCalls: [],
    tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    costUSD: 0,
    filesTouched: [],
    ...overrides,
  };
}

describe("computeGanttScale", () => {
  it("returns no bars for an empty swarm", () => {
    const scale = computeGanttScale([], 1000);
    expect(scale.bars).toEqual([]);
    expect(scale.ticks).toEqual([]);
  });

  it("keeps a ≥1s span so sub-second runs still render", () => {
    const scale = computeGanttScale([agent({ startedAt: 5_000, endedAt: 5_400 })], 6_000);
    expect(scale.span).toBe(1000);
    expect(scale.bars[0]).toEqual({ sessionID: "s", left: 0, width: 0.4 });
  });

  it("maps two agents onto the shared axis, running ones ending at now", () => {
    const a = agent({ sessionID: "a", startedAt: 0, endedAt: 1_000 });
    const b = agent({ sessionID: "b", startedAt: 500, status: "running" });
    const scale = computeGanttScale([a, b], 2_000);

    expect(scale.start).toBe(0);
    expect(scale.span).toBe(2_000); // running agent extends the axis to now
    expect(scale.bars).toEqual([
      { sessionID: "a", left: 0, width: 0.5 },
      { sessionID: "b", left: 0.25, width: 0.75 },
    ]);
  });

  it("sorts rows by startedAt regardless of input order", () => {
    const late = agent({ sessionID: "late", startedAt: 900 });
    const early = agent({ sessionID: "early", startedAt: 100 });
    const scale = computeGanttScale([late, early], 1_000);
    expect(scale.bars.map((bar) => bar.sessionID)).toEqual(["early", "late"]);
  });

  it("emits ~5 HH:MM:SS ticks covering the axis ends", () => {
    const scale = computeGanttScale([agent({ startedAt: 0, endedAt: 8_000 })], 8_000);
    expect(scale.ticks).toHaveLength(5);
    expect(scale.ticks[0]?.at).toBe(0);
    expect(scale.ticks[4]?.at).toBe(1);
    expect(scale.ticks[2]?.label).toMatch(/^\d{2}:\d{2}:\d{2}$/);
  });

  it("clamps a running agent whose clock is behind startedAt", () => {
    // now < startedAt (clock skew): the bar collapses to zero width, not NaN.
    const scale = computeGanttScale([agent({ startedAt: 5_000, status: "running" })], 1_000);
    expect(scale.bars[0]).toEqual({ sessionID: "s", left: 0, width: 0 });
  });
});
