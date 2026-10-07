import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createHub } from "../hub/hub";
import type { HubEvent, SwarmDelta } from "../hub/types";
import { buildApp } from "./app";

function must<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("expected a value, got undefined");
  return value;
}

/** Race `promise` against a timeout that resolves to undefined (timer cleaned up). */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => resolve(undefined), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** Hub folded from the real subagent-lifecycle capture, plus an app over it. */
function buildScenario() {
  const hub = createHub();
  const path = fileURLToPath(
    new URL("../hub/__fixtures__/subagent-lifecycle.ndjson", import.meta.url),
  );
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (line.trim() === "") continue;
    hub.apply(JSON.parse(line) as HubEvent);
  }
  const subscribers = new Set<(deltas: SwarmDelta[]) => void>();
  const subscribeDeltas = (cb: (deltas: SwarmDelta[]) => void) => {
    subscribers.add(cb);
    return () => subscribers.delete(cb);
  };
  const app = buildApp({
    hub,
    subscribeDeltas,
    info: { name: "ocswarm", version: "0.1.0", startedAt: 1_791_373_232_869 },
  });
  return { hub, app };
}

describe("GET /api/state", () => {
  it("serves the folded fixture with the child done", async () => {
    const { hub, app } = buildScenario();
    const childID = must(Object.keys(hub.snapshot().agents)[0]);
    const res = await app.request("/api/state");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { agents: Record<string, { status: string }> };
    expect(must(body.agents[childID]).status).toBe("done");
  });
});

describe("GET /api/info", () => {
  it("reports the ocswarm identity", async () => {
    const { app } = buildScenario();
    const res = await app.request("/api/info");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ name: "ocswarm" });
  });
});

describe("GET /", () => {
  it("points at the future dashboard (F3)", async () => {
    const { app } = buildScenario();
    const res = await app.request("/");
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("F3");
  });
});

describe("GET /api/stream", () => {
  it("replays the snapshot as SSE, then closes cleanly on cancel", async () => {
    const { hub, app } = buildScenario();
    const childID = must(Object.keys(hub.snapshot().agents)[0]);
    const controller = new AbortController();
    const res = await app.request("/api/stream", { signal: controller.signal });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");

    // Collect chunks until the initial replay mentions the child (500ms guard).
    const reader = must(res.body?.getReader());
    const decoder = new TextDecoder();
    let text = "";
    const deadline = Date.now() + 500;
    while (!text.includes(childID) && Date.now() < deadline) {
      const chunk = await withTimeout(reader.read(), deadline - Date.now());
      if (!chunk || chunk.done) break;
      text += decoder.decode(chunk.value, { stream: true });
    }

    expect(text).toContain("event: agent.upsert");
    expect(text).toContain(childID);

    await reader.cancel();
    controller.abort();
  });
});
