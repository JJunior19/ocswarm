import { Plugin } from "@opencode/plugin";
import packageJson from "../package.json";
import { createHub } from "./hub/hub";
import type { SwarmDelta } from "./hub/types";
import { buildApp } from "./server/app";
import { startServer } from "./server/listen";

const { version } = packageJson as { version: string };

export default Plugin.define({
  id: "ocswarm",
  async setup(ctx) {
    console.log(`[ocswarm] plugin loaded (server) — opencode ${ctx.app.version}`);
    const hub = createHub();
    /** Connected SSE clients; hub deltas are fanned out to all of them. */
    const broadcaster = new Set<(deltas: SwarmDelta[]) => void>();
    const subscribeDeltas = (cb: (deltas: SwarmDelta[]) => void) => {
      broadcaster.add(cb);
      return () => broadcaster.delete(cb);
    };
    const app = buildApp({
      hub,
      subscribeDeltas,
      info: { name: "ocswarm", version, startedAt: Date.now() },
    });
    const controller = new AbortController();
    void (async () => {
      for await (const event of ctx.event.subscribe({ signal: controller.signal })) {
        const deltas = hub.apply(event);
        if (deltas.length) for (const cb of broadcaster) cb(deltas);
      }
    })();
    const srv = await startServer({
      fetch: app.fetch,
      port: (ctx.options as { port?: number } | undefined)?.port,
    });
    console.log(`[ocswarm] dashboard API on ${srv.url}`);
    return () => {
      srv.stop();
      controller.abort();
      console.log("[ocswarm] server plugin unloading");
    };
  },
});
