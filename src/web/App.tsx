import { useCallback, useEffect, useMemo, useState } from "react";
import { AgentDetail } from "./AgentDetail";
import { formatCost, formatTokens } from "./format";
import { Gantt } from "./Gantt";
import { GraphView } from "./GraphView";
import { rootSessions, subtreeOf } from "./tree";
import { useSwarm } from "./useSwarm";

/** Sentinel view: every root session's tree in one graph (pre-F5.1 behavior). */
const ALL_VIEW = "all";

/** Deep link support: `?session=<rootID>` selects that session's subtree. */
function initialView(): string {
  return new URLSearchParams(window.location.search).get("session") ?? ALL_VIEW;
}

export function App() {
  const { state, connected } = useSwarm();
  const [selected, setSelected] = useState<string | undefined>(undefined);
  const [view, setView] = useState<string>(initialView);
  const onSelect = useCallback((sessionID: string | undefined) => setSelected(sessionID), []);

  // View switch also rewrites the URL (no reload) so the diagram is linkable.
  const onSelectView = useCallback((next: string) => {
    setView(next);
    setSelected(undefined); // the detail panel only makes sense within a view
    history.replaceState(null, "", next === ALL_VIEW ? "/" : `/?session=${next}`);
  }, []);

  // Esc clears the selection (panel + gantt + graph highlight).
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelected(undefined);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Selector candidates: agents without parentID, most recent first.
  const roots = useMemo(() => rootSessions(state), [state]);

  // A stale deep link (root deleted / unknown) falls back to the full view.
  useEffect(() => {
    if (view === ALL_VIEW) return;
    if (roots.length > 0 && !roots.some((root) => root.sessionID === view)) {
      setView(ALL_VIEW);
      history.replaceState(null, "", "/");
    }
  }, [view, roots]);

  // Selected subtree — undefined means "all", i.e. exactly the F5 behavior.
  const scope = useMemo(
    () => (view === ALL_VIEW ? undefined : subtreeOf(state, view)),
    [state, view],
  );

  const agents = useMemo(() => {
    if (!scope) return Object.values(state.agents);
    return [...scope.ids].flatMap((id) => {
      const agent = state.agents[id];
      return agent ? [agent] : [];
    });
  }, [state, scope]);

  // Layout depth per visible agent: BFS depth in a scoped view, flat 0/1 in
  // the full view (same shapes deriveRows used before F5.1).
  const depth = useMemo(() => {
    if (scope) return scope.depth;
    return new Map(agents.map((agent) => [agent.sessionID, agent.parentID ? 1 : 0]));
  }, [scope, agents]);

  // Pill data: subtree agent count per root session.
  const pills = useMemo(
    () => roots.map((root) => ({ root, count: subtreeOf(state, root.sessionID).ids.size })),
    [roots, state],
  );

  const selectedAgent = selected === undefined ? undefined : state.agents[selected];

  const totalTokens = agents.reduce(
    (sum, agent) => sum + agent.tokens.input + agent.tokens.output,
    0,
  );
  const totalCost = agents.reduce((sum, agent) => sum + agent.costUSD, 0);

  return (
    <div className="app">
      <header className="header">
        <span className="brand">{"🐝 ocswarm"}</span>
        <span className="status">
          <span className={connected ? "dot dot-on" : "dot dot-off"} aria-hidden="true" />
          {connected ? "live" : "connecting"}
        </span>
        <span className="count">
          {agents.length} agent{agents.length === 1 ? "" : "s"}
        </span>
        <span className="totals">
          {`Σ ${formatTokens(totalTokens)} tok · ${formatCost(totalCost)}`}
        </span>
      </header>
      <nav className="view-bar" aria-label="session views">
        <button
          type="button"
          className={view === ALL_VIEW ? "view-pill view-pill-active" : "view-pill"}
          aria-pressed={view === ALL_VIEW}
          onClick={() => onSelectView(ALL_VIEW)}
        >
          all sessions
        </button>
        {pills.map(({ root, count }) => (
          <button
            key={root.sessionID}
            type="button"
            className={view === root.sessionID ? "view-pill view-pill-active" : "view-pill"}
            aria-pressed={view === root.sessionID}
            title={root.title || root.task}
            onClick={() => onSelectView(root.sessionID)}
          >
            <span className={`dot detail-dot detail-${root.status}`} aria-hidden="true" />
            <span className="view-pill-label">{root.agent}</span>
            <span className="view-count">{`+${count}`}</span>
          </button>
        ))}
      </nav>
      <main className="main">
        <div className="main-body">
          <GraphView agents={agents} depth={depth} selected={selected} onSelect={onSelect} />
          {selectedAgent && (
            <AgentDetail agent={selectedAgent} onClose={() => onSelect(undefined)} />
          )}
        </div>
        <Gantt agents={agents} selected={selected} onSelect={onSelect} />
      </main>
      <footer className="footer">
        subagents appear as the orchestrator spawns them · snapshot: /api/state · stream:
        /api/stream
      </footer>
    </div>
  );
}
