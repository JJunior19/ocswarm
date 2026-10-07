/**
 * Swarm tree panel — a Solid/OpenTUI component for the `session.panel` slot.
 *
 * Reads sessions reactively from the plugin data layer, shapes them with the
 * pure buildTreeRows, and registers its `o` keybind inside the component so
 * the layer auto-disposes when the panel closes.
 */

import { usePlugin } from "@opencode/plugin/tui";
import { createMemo, For } from "solid-js";
import { openInBrowser, withSession } from "./open";
import { buildTreeRows } from "./tree";
import { getDiscoveredUrl } from "./urls";

const MAX_TITLE = 48;

const STYLES: Record<string, { glyph: string; fg: string }> = {
  running: { glyph: "●", fg: "#7ee787" },
  done: { glyph: "✔", fg: "#e6edf3" },
  error: { glyph: "✗", fg: "#ff7b72" },
  idle: { glyph: "○", fg: "#8b949e" },
};

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export function TreePanel(props: { sessionID?: string }) {
  const context = usePlugin();
  const rows = createMemo(() =>
    buildTreeRows(context.data.session.list(), props.sessionID, Date.now()),
  );
  context.keymap.layer(() => ({
    mode: "global",
    commands: [
      {
        id: "ocswarm.openDashboard",
        title: "Open ocswarm dashboard",
        bind: "o",
        run: () => {
          const url = getDiscoveredUrl();
          if (url === undefined) return;
          // Deep link: this panel knows its session, so jump straight to ITS
          // diagram (F5.1). No session in context → plain dashboard.
          openInBrowser(props.sessionID ? withSession(url, props.sessionID) : url);
        },
      },
    ],
  }));
  return (
    <box title={`🐝 swarm — ${getDiscoveredUrl() ?? "dashboard not found"}`}>
      <For each={rows()}>
        {(row) => {
          const style = STYLES[row.status] ?? { glyph: "•", fg: "#e6edf3" };
          return (
            <text fg={style.fg}>
              {`${style.glyph} ${row.agent} ${truncate(row.title, MAX_TITLE)} (${row.elapsedLabel})`}
            </text>
          );
        }}
      </For>
    </box>
  );
}
