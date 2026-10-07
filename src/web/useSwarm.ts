import { useEffect, useState } from "react";
import { applyDelta, applySnapshot, type ClientDelta, type ClientState } from "./reducer";
import type { SwarmState } from "./types";

const EMPTY: ClientState = { roots: [], agents: {} };

/** SSE event names == delta types (see src/server/app.ts). */
const EVENT_TYPES = [
  "agent.upsert",
  "agent.status",
  "agent.tool",
  "agent.removed",
  "root.upsert",
] as const;

/**
 * Live swarm view: bootstrap from GET /api/state, then tail GET /api/stream.
 * EventSource reconnects on its own; `connected` flips false on error and
 * back to true on the next open, so the UI can show the link state.
 */
export function useSwarm(): { state: ClientState; connected: boolean } {
  const [state, setState] = useState<ClientState>(EMPTY);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    let cancelled = false;

    fetch("/api/state")
      .then((res) => {
        if (!res.ok) throw new Error(`GET /api/state → HTTP ${res.status}`);
        return res.json() as Promise<SwarmState>;
      })
      .then((snap) => {
        if (!cancelled) setState((prev) => applySnapshot(prev, snap));
      })
      .catch(() => {
        // Snapshot fetch failed (e.g. server restarting); the SSE replay
        // below still rebuilds the view once the connection comes up.
      });

    const source = new EventSource("/api/stream");
    source.onopen = () => {
      if (!cancelled) setConnected(true);
    };
    source.onerror = () => {
      if (!cancelled) setConnected(false);
    };

    const onDelta = (event: MessageEvent<string>) => {
      const payload = JSON.parse(event.data) as Omit<ClientDelta, "type">;
      const delta = { type: event.type, ...payload } as ClientDelta;
      if (!cancelled) setState((prev) => applyDelta(prev, delta));
    };
    for (const type of EVENT_TYPES) {
      source.addEventListener(type, onDelta as EventListener);
    }

    return () => {
      cancelled = true;
      source.close();
    };
  }, []);

  return { state, connected };
}
