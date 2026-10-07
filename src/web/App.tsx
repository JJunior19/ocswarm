import { GraphView } from "./GraphView";
import { useSwarm } from "./useSwarm";

export function App() {
  const { state, connected } = useSwarm();
  const count = Object.keys(state.agents).length;

  return (
    <div className="app">
      <header className="header">
        <span className="brand">{"🐝 ocswarm"}</span>
        <span className="status">
          <span className={connected ? "dot dot-on" : "dot dot-off"} aria-hidden="true" />
          {connected ? "live" : "connecting"}
        </span>
        <span className="count">
          {count} agent{count === 1 ? "" : "s"}
        </span>
      </header>
      <main className="main">
        <GraphView state={state} />
      </main>
      <footer className="footer">
        subagents appear as the orchestrator spawns them · snapshot: /api/state · stream:
        /api/stream
      </footer>
    </div>
  );
}
