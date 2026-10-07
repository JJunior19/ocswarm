import { describe, expect, it } from "vitest";
import { type AgentSessionLike, decideNotify, subagentIndex } from "./notify";

/** Index with one root and two tracked subagents. */
function subagents(): Map<string, { agent: string; title: string }> {
  return subagentIndex([
    { id: "root", agent: "orchestrator", title: "mission control" },
    { id: "sub-1", parentID: "root", agent: "explorer", title: "explore the codebase" },
    { id: "sub-2", parentID: "root", agent: "writer", title: "" },
  ]);
}

describe("decideNotify", () => {
  it("notifies success when a tracked subagent reaches done", () => {
    const decision = decideNotify(subagents(), { sessionID: "sub-1", status: "done" }, new Set());
    expect(decision).toEqual({ variant: "success", message: "✔ explorer: explore the codebase" });
  });

  it("notifies error when a tracked subagent reaches error", () => {
    const decision = decideNotify(subagents(), { sessionID: "sub-1", status: "error" }, new Set());
    expect(decision).toEqual({
      variant: "error",
      message: "✗ explorer: explore the codebase done with error",
    });
  });

  it("ignores repeats — a session notifies at most once", () => {
    const notified = new Set<string>();
    expect(
      decideNotify(subagents(), { sessionID: "sub-1", status: "done" }, notified),
    ).toBeDefined();
    expect(
      decideNotify(subagents(), { sessionID: "sub-1", status: "done" }, notified),
    ).toBeUndefined();
    // Even a later different terminal status stays silent.
    expect(
      decideNotify(subagents(), { sessionID: "sub-1", status: "error" }, notified),
    ).toBeUndefined();
  });

  it("ignores other statuses", () => {
    for (const status of ["running", "idle", "started", "interrupted", ""]) {
      expect(decideNotify(subagents(), { sessionID: "sub-1", status }, new Set())).toBeUndefined();
    }
  });

  it("ignores untracked sessions (roots and strangers)", () => {
    const notified = new Set<string>();
    expect(
      decideNotify(subagents(), { sessionID: "root", status: "done" }, notified),
    ).toBeUndefined();
    expect(
      decideNotify(subagents(), { sessionID: "who-is-this", status: "done" }, notified),
    ).toBeUndefined();
    expect(notified.size).toBe(0);
  });

  it("truncates long titles at 48 with an ellipsis", () => {
    const index = subagentIndex([
      { id: "sub-long", parentID: "root", agent: "explorer", title: "x".repeat(80) },
    ]);
    const decision = decideNotify(index, { sessionID: "sub-long", status: "done" }, new Set());
    const title = decision?.message.slice("✔ explorer: ".length);
    expect(decision?.message.startsWith("✔ explorer: ")).toBe(true);
    expect(decision?.message.endsWith("…")).toBe(true);
    expect(title?.length).toBe(48);
  });
});

describe("subagentIndex", () => {
  it("indexes only sessions with a parentID, defaulting missing agent and title", () => {
    const sessions: AgentSessionLike[] = [
      { id: "root", agent: "orchestrator", title: "mission control" },
      { id: "sub-1", parentID: "root", agent: "explorer", title: "explore" },
      { id: "sub-2", parentID: "root" },
    ];
    const index = subagentIndex(sessions);
    expect([...index.keys()].sort()).toEqual(["sub-1", "sub-2"]);
    expect(index.get("sub-1")).toEqual({ agent: "explorer", title: "explore" });
    expect(index.get("sub-2")).toEqual({ agent: "agent", title: "" });
  });

  it("excludes every root: an empty session list yields an empty index", () => {
    expect(subagentIndex([{ id: "root" }, { id: "other-root", agent: "builder" }]).size).toBe(0);
  });
});
