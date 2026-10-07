import { useCallback, useEffect, useMemo, useState } from "react";
import { AgentDetail } from "./AgentDetail";
import { formatCost, formatTokens } from "./format";
import { Gantt } from "./Gantt";
import { GraphView } from "./GraphView";
import { useSwarm } from "./useSwarm";

export function App() {
  const { state, connected } = useSwarm();
  const [selected, setSelected] = useState<string | undefined>(undefined);
  const onSelect = useCallback((sessionID: string | undefined) => setSelected(sessionID), []);

  // Esc clears the selection (panel + gantt + graph highlight).
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelected(undefined);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const agents = useMemo(() => Object.values(state.agents), [state.agents]);
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
      <main className="main">
        <div className="main-body">
          <GraphView state={state} selected={selected} onSelect={onSelect} />
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
