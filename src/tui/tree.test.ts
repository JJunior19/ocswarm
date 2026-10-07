import { describe, expect, it } from "vitest";
import type { SessionLike } from "./tree";
import { buildTreeRows } from "./tree";

/** Fixtures shaped like real /api/session rows: parent + two subagents. */
function fixtures(): SessionLike[] {
  return [
    {
      id: "root",
      agent: "orchestrator",
      title: "mission control",
      time: { created: 60_000 },
    },
    {
      id: "child-done",
      parentID: "root",
      agent: "explorer",
      title: "explore the codebase",
      time: { created: 62_000, idle: 93_000 },
      outcome: "succeeded",
    },
    {
      id: "child-running",
      parentID: "root",
      agent: "writer",
      title: "write the docs",
      time: { created: 61_000 },
    },
  ];
}

describe("buildTreeRows", () => {
  it("orders root first, then children by spawn time, with status and elapsed", () => {
    const rows = buildTreeRows(fixtures(), "root", 121_000);
    expect(rows).toEqual([
      {
        sessionID: "root",
        depth: 0,
        agent: "orchestrator",
        title: "mission control",
        status: "running",
        elapsedLabel: "1:01", // 121s - 60s
      },
      {
        sessionID: "child-running",
        depth: 1,
        agent: "writer",
        title: "write the docs",
        status: "running",
        elapsedLabel: "1:00", // 121s - 61s
      },
      {
        sessionID: "child-done",
        depth: 1,
        agent: "explorer",
        title: "explore the codebase",
        status: "done",
        elapsedLabel: "0:31", // frozen at idle: 93s - 62s
      },
    ]);
  });

  it("labels non-succeeded outcomes as error", () => {
    const sessions: SessionLike[] = [
      {
        id: "child-failed",
        parentID: "root",
        outcome: "failed",
        time: { created: 0, idle: 5_000 },
      },
    ];
    const [row] = buildTreeRows(sessions, "root", 10_000);
    expect(row?.status).toBe("error");
  });

  it("labels idle sessions without outcome as idle", () => {
    const sessions: SessionLike[] = [
      { id: "child-idle", parentID: "root", time: { created: 0, idle: 5_000 } },
    ];
    const [row] = buildTreeRows(sessions, "root", 10_000);
    expect(row?.status).toBe("idle");
  });

  it("with no rootID, lists every subagent across roots at depth 1", () => {
    const sessions: SessionLike[] = [
      ...fixtures(),
      { id: "other-child", parentID: "other-root", time: { created: 70_000 } },
      { id: "other-root", time: { created: 69_000 } },
    ];
    const rows = buildTreeRows(sessions, undefined, 121_000);
    expect(rows.map((row) => [row.sessionID, row.depth])).toEqual([
      ["child-running", 1],
      ["child-done", 1],
      ["other-child", 1],
    ]);
  });

  it("with no children, renders just the root row", () => {
    const rows = buildTreeRows(
      [{ id: "lonely", agent: "orchestrator", title: "solo", time: { created: 120_000 } }],
      "lonely",
      121_000,
    );
    expect(rows).toEqual([
      {
        sessionID: "lonely",
        depth: 0,
        agent: "orchestrator",
        title: "solo",
        status: "running",
        elapsedLabel: "0:01",
      },
    ]);
  });
});
