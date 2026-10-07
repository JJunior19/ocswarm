/**
 * ocswarm TUI plugin — real CLI surface (F4).
 *
 * - Discovers the local dashboard (server plugin on 127.0.0.1:7777..7786) and
 *   announces it with a toast.
 * - Claims `home.footer.status` with a live subagent-count badge.
 * - Registers the `/swarm` command (palette + slash) that opens the swarm
 *   tree panel in the current session; `o` inside the panel opens the
 *   dashboard in the browser.
 */

import { Plugin, usePlugin } from "@opencode/plugin/tui";
import { createMemo, Show } from "solid-js";
import { discoverDashboard } from "./tui/discover";
import { TreePanel } from "./tui/TreePanel";
import { setDiscoveredUrl } from "./tui/urls";

/** Persistent footer indicator: how many subagents are alive right now. */
function FooterBadge() {
  const context = usePlugin();
  const agents = createMemo(
    () => context.data.session.list().filter((session) => session.parentID !== undefined).length,
  );
  return <text fg="#7ee787">🐝 {agents() === 1 ? "1 agent" : `${agents()} agents`}</text>;
}

export default Plugin.define({
  id: "ocswarm.tui",
  setup(context) {
    void discoverDashboard().then((url) => {
      setDiscoveredUrl(url);
      if (url !== undefined) {
        context.ui.toast.show({
          message: `🐝 ocswarm → ${url}`,
          variant: "success",
          duration: 3000,
        });
      }
    });
    context.ui.slot({ append: "home.footer.status", render: () => <FooterBadge /> });
    context.ui.slot({
      append: "session.panel",
      render: (panel) => (
        <Show when={panel.name === "ocswarm.tree"}>
          <TreePanel sessionID={panel.sessionID} />
        </Show>
      ),
    });
    context.keymap.layer(() => ({
      mode: "global",
      commands: [
        {
          id: "ocswarm.swarm",
          title: "Show ocswarm swarm",
          palette: true,
          slash: { name: "swarm" },
          run: () => {
            context.ui.panel.open("ocswarm.tree");
          },
        },
      ],
    }));
  },
});
