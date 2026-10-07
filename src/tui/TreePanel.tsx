/**
 * Swarm tree panel — a Solid/OpenTUI component for the `session.panel` slot.
 *
 * Reads sessions reactively from the plugin data layer, shapes them with the
 * pure buildTreeRows, and registers its `o` keybind inside the component so
 * the layer auto-disposes when the panel closes.
 */

import { usePlugin } from "@opencode/plugin/tui";
import { createEffect, createMemo, For } from "solid-js";
import { openInBrowser, withSession } from "./open";
import { buildTreeRows } from "./tree";
import { getDiscoveredUrl } from "./urls";

const MAX_TITLE = 48;

/** SessionIDs whose title was already POSTed to the dashboard (F5.3-B). */
const titlesSynced = new Set<string>();

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
  // Title backfill (F5.3-B): the dashboard may have joined this session's
  // life late, so POST the real TUI title once per session while the panel
  // is open. Fire-and-forget: skipped silently without a discovered URL or
  // a non-empty title, and all fetch errors are swallowed.
  createEffect(() => {
    const sessionID = props.sessionID;
    if (sessionID === undefined || titlesSynced.has(sessionID)) return;
    const dashboard = getDiscoveredUrl();
    // .d.ts ground truth: session.get is SYNC (SessionInfo | undefined).
    const title = context.data.session.get(sessionID)?.title?.trim();
    if (dashboard === undefined || !title) return;
    titlesSynced.add(sessionID);
    void fetch(`${dashboard}/api/title`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionID, title }),
    }).catch(() => {});
  });
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
