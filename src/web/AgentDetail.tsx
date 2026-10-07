import { formatCost, formatElapsed, formatTime, formatTokens } from "./format";
import type { SwarmAgent } from "./types";
import { useNow } from "./useNow";

/** Glyph per tool-call status; unknown statuses fall back to the running dot. */
const TOOL_GLYPH: Record<string, string> = {
  completed: "✔",
  error: "✗",
  running: "●",
};

function totalTokens(agent: SwarmAgent): number {
  const { input, output, cacheRead, cacheWrite } = agent.tokens;
  return input + output + cacheRead + cacheWrite;
}

/**
 * Right-hand detail panel for the selected agent (F5). Everything shown is
 * already in the client mirror — no extra fetches. Elapsed ticks live via the
 * shared 1Hz clock while the agent is still open.
 */
export function AgentDetail({ agent, onClose }: { agent: SwarmAgent; onClose: () => void }) {
  const now = useNow();
  const elapsed = formatElapsed((agent.endedAt ?? now) - agent.startedAt);

  return (
    <aside className="detail" aria-label={`agent detail: ${agent.agent}`}>
      <header className="detail-header">
        <span className={`dot detail-dot detail-${agent.status}`} aria-hidden="true" />
        <span className="detail-name">{agent.agent}</span>
        <button type="button" className="detail-close" onClick={onClose} aria-label="close">
          ×
        </button>
      </header>

      <div className="detail-body">
        <h2 className="detail-title">{agent.title || agent.agent || "untitled"}</h2>
        {agent.task && <p className="detail-task">{agent.task}</p>}

        <dl className="detail-meta">
          <dt>status</dt>
          <dd>{agent.status}</dd>
          <dt>started</dt>
          <dd>{formatTime(agent.startedAt)}</dd>
          {agent.endedAt !== undefined && (
            <>
              <dt>ended</dt>
              <dd>{formatTime(agent.endedAt)}</dd>
            </>
          )}
          <dt>elapsed</dt>
          <dd className="detail-elapsed">{elapsed}</dd>
        </dl>

        {agent.currentTool && (
          <p className="detail-tool">
            {`▸ ${agent.currentTool.name}`}
            {agent.currentTool.summary && (
              <span className="detail-tool-summary">{` — ${agent.currentTool.summary}`}</span>
            )}
          </p>
        )}

        <section className="detail-section">
          <h3>tool calls</h3>
          {agent.toolCalls.length === 0 ? (
            <p className="detail-empty">none yet</p>
          ) : (
            <ul className="detail-toolcalls">
              {agent.toolCalls.map((call) => (
                <li key={`${call.at}-${call.name}`} className="detail-toolcall">
                  <span className={`detail-glyph detail-glyph-${call.status}`} aria-hidden="true">
                    {TOOL_GLYPH[call.status] ?? "●"}
                  </span>
                  <span className="detail-toolcall-name">{call.name}</span>
                  <span className="detail-toolcall-at">{formatTime(call.at)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="detail-section">
          <h3>tokens</h3>
          <dl className="detail-meta">
            <dt>input</dt>
            <dd>{formatTokens(agent.tokens.input)}</dd>
            <dt>output</dt>
            <dd>{formatTokens(agent.tokens.output)}</dd>
            <dt>cache read</dt>
            <dd>{formatTokens(agent.tokens.cacheRead)}</dd>
            <dt>cache write</dt>
            <dd>{formatTokens(agent.tokens.cacheWrite)}</dd>
            <dt>total</dt>
            <dd className="detail-total">{formatTokens(totalTokens(agent))}</dd>
          </dl>
          <p className="detail-cost">{formatCost(agent.costUSD)}</p>
        </section>

        {agent.filesTouched.length > 0 && (
          <section className="detail-section">
            <h3>files touched</h3>
            <ul className="detail-files">
              {agent.filesTouched.map((file) => (
                <li key={file} className="detail-file" title={file}>
                  {file}
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </aside>
  );
}
