/**
 * Local HTTP API over the SwarmHub (F2).
 *
 * Runtime-agnostic by design: every route is exercised through Hono's
 * `app.fetch`/`app.request`, which works both under Bun (the plugin runtime)
 * and under node (vitest). The SSE endpoint replays the current snapshot for
 * late joiners, then forwards hub deltas live; unsubscribe and the keepalive
 * timer are both abort-aware so a disconnect leaves nothing behind.
 */

import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type { Hub } from "../hub/hub";
import type { SwarmDelta } from "../hub/types";

export interface ServerInfo {
  name: string;
  version: string;
  startedAt: number;
}

export interface ServerDeps {
  hub: Hub;
  subscribeDeltas: (cb: (deltas: SwarmDelta[]) => void) => () => void;
  info: ServerInfo;
}

/** SSE keepalive cadence — comment frames keep idle proxies from timing out. */
const KEEPALIVE_MS = 15_000;

/** Strip `type` from a delta; the SSE event name carries it instead. */
function toPayload(delta: SwarmDelta): Record<string, unknown> {
  const { type: _type, ...payload } = delta;
  return payload;
}

export function buildApp(deps: ServerDeps): Hono {
  const app = new Hono();

  app.get("/api/info", (c) => c.json(deps.info));

  app.get("/api/state", (c) => c.json(deps.hub.snapshot()));

  app.get("/api/stream", (c) =>
    streamSSE(c, async (stream) => {
      // Late joiners get the full current view first: agents, then roots.
      const snapshot = deps.hub.snapshot();
      for (const agent of Object.values(snapshot.agents)) {
        await stream.writeSSE({ event: "agent.upsert", data: JSON.stringify(agent) });
      }
      for (const sessionID of snapshot.roots) {
        await stream.writeSSE({ event: "root.upsert", data: JSON.stringify({ sessionID }) });
      }

      // Live tail: deltas arriving between writes queue up and are drained by
      // the single loop below, which also emits keepalive comments when idle.
      const queue: SwarmDelta[] = [];
      const wakeups = new Set<() => void>();
      let open = true;
      let timer: ReturnType<typeof setTimeout> | undefined;

      const wake = () => {
        for (const wakeup of wakeups) wakeup();
        wakeups.clear();
      };

      const unsubscribe = deps.subscribeDeltas((deltas) => {
        queue.push(...deltas);
        wake();
      });

      const close = () => {
        if (!open) return;
        open = false;
        unsubscribe();
        clearTimeout(timer);
        wake();
      };

      // Hono only wires the request signal's abort to the stream on old Bun
      // versions; do it here so client disconnects unsubscribe and tear down
      // the keepalive timer on every runtime.
      c.req.raw.signal.addEventListener("abort", () => {
        stream.abort();
        close();
      });
      stream.onAbort(close);

      try {
        while (open) {
          // Wake on: new deltas ("flush"), keepalive tick ("tick"), or close.
          const reason = await new Promise<"flush" | "tick">((resolve) => {
            const flush = () => {
              wakeups.delete(flush);
              clearTimeout(timer);
              resolve("flush");
            };
            wakeups.add(flush);
            timer = setTimeout(() => {
              wakeups.delete(flush);
              resolve("tick");
            }, KEEPALIVE_MS);
          });
          if (!open) break;
          if (queue.length > 0) {
            const batch = queue.splice(0);
            for (const delta of batch) {
              if (!open) break;
              await stream.writeSSE({
                event: delta.type,
                data: JSON.stringify(toPayload(delta)),
              });
            }
          } else if (reason === "tick") {
            await stream.write(": keepalive\n\n");
          }
        }
      } finally {
        close();
      }
    }),
  );

  app.get("/", (c) =>
    c.text(
      "ocswarm local server — dashboard arrives in F3 (see /api/info, /api/state, /api/stream)",
    ),
  );

  return app;
}
