import { Plugin } from "@opencode/plugin";

export default Plugin.define({
  id: "ocswarm",
  async setup(ctx) {
    console.log(`[ocswarm] plugin loaded (server) — opencode ${ctx.app.version}`);
    const controller = new AbortController();
    // Event stream wiring arrives with the SwarmHub in F1/F2; drain for now.
    void (async () => {
      for await (const _event of ctx.event.subscribe({ signal: controller.signal })) {
        // consumed by the SwarmHub from F1 onward
      }
    })();
    return () => {
      controller.abort();
      console.log("[ocswarm] server plugin unloading");
    };
  },
});
