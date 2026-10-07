import { Plugin } from "@opencode/plugin";
import packageJson from "../package.json";
import type { PricingRate } from "./hub/hub";
import { createHub } from "./hub/hub";
import type { SwarmDelta } from "./hub/types";
import { buildApp } from "./server/app";
import { startServer } from "./server/listen";

const { version } = packageJson as { version: string };

export default Plugin.define({
  id: "ocswarm",
  async setup(ctx) {
    console.log(`[ocswarm] plugin loaded (server) — opencode ${ctx.app.version}`);
    // Live cost (F5.2): models.dev pricing ships inside the OpenCode server,
    // so list models once at setup and key rates (USD per million tokens) by
    // `providerID/modelID`. Unknown models price to undefined → costUSD stays
    // 0. Base tier = the untiered cost entry, falling back to the first tier.
    //
    // Deferred ON PURPOSE: the event tap below must subscribe before this
    // setup promise yields. Awaiting model.list() first registered the tap
    // after a real async gap and it never received another event (live
    // regression). Late rate resolution is harmless: usage tokens are
    // cumulative, so the next usage.updated recomputes the cost anyway.
    const rates = new Map<string, PricingRate>();
    void ctx.model.list().then(
      (models) => {
        for (const model of models.data) {
          const cost = model.cost.find((entry) => entry.tier === undefined) ?? model.cost[0];
          if (!cost) continue;
          rates.set(`${model.providerID}/${model.modelID}`, {
            input: cost.input,
            output: cost.output,
            cacheRead: cost.cache.read,
            cacheWrite: cost.cache.write,
          });
        }
        // Debug (F5.2 verification): confirm the map populated. Remove once
        // live cost is verified.
        console.warn(`[ocswarm] pricing map loaded: ${rates.size} models`);
      },
      (error) => console.warn(`[ocswarm] model pricing unavailable — live cost disabled (${error})`),
    );
    const hub = createHub({
      pricing: ({ providerID, modelID }) => {
        const rate = rates.get(`${providerID}/${modelID}`);
        if (!rate) {
          console.warn(`[ocswarm] no pricing for ${providerID}/${modelID} (map has ${rates.size})`);
        }
        return rate;
      },
    });
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
      // Built dashboard bundle (`bun run build:web`). serveStaticFile checks
      // existence per request, so a missing build falls back to the placeholder.
      staticRoot: new URL("../dist/web", import.meta.url).pathname,
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
