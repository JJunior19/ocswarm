/**
 * Subagent watcher — wires the pure notify decisions to the plugin data layer.
 *
 * Source of truth is `context.data.listen` (grounded in the installed plugin
 * types): `session.execution.succeeded` / `session.execution.failed` carry the
 * ending session's `sessionID`, and `session.created` carries a new subagent's
 * `parentID`. Only tracked subagents (sessions with a parentID) notify, each
 * at most once. OS notifications are requested only while the TUI is blurred
 * (`notification: { when: "blurred" }`); sounds differentiate outcome
 * (`subagent_done` vs `error`).
 */

import type { Plugin } from "@opencode/plugin/tui";
import { type DecidedNotify, decideNotify, subagentIndex } from "./notify";

/** Dependencies of the watcher, narrowed to what it actually touches. */
export type WatcherContext = Pick<Plugin.Context, "data" | "attention">;

/** Subscribes to the session lifecycle stream; returns the unsubscribe hook. */
export function startSubagentWatcher(context: WatcherContext): () => void {
  const notified = new Set<string>();
  const index = subagentIndex(context.data.session.list());
  const show = (decision: DecidedNotify): void => {
    void context.attention
      .notify({
        title: "ocswarm",
        message: decision.message,
        notification: { when: "blurred" },
        sound: { name: decision.variant === "success" ? "subagent_done" : "error" },
      })
      .catch(() => {
        // Attention is best-effort UI sugar — a refused notification must not break the watcher.
      });
  };
  return context.data.listen(({ details }) => {
    if (details.type === "session.created") {
      // Fresh subagents enter the index straight from the event payload —
      // the data layer's list may not have ingested the session yet.
      if (details.data.parentID !== undefined) {
        index.set(details.data.sessionID, {
          agent: details.data.agent ?? "agent",
          title: details.data.title ?? "",
        });
      }
      return;
    }
    if (
      details.type !== "session.execution.succeeded" &&
      details.type !== "session.execution.failed"
    ) {
      return;
    }
    const status = details.type === "session.execution.succeeded" ? "done" : "error";
    const decision = decideNotify(index, { sessionID: details.data.sessionID, status }, notified);
    if (decision !== undefined) show(decision);
  });
}
