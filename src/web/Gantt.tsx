import { useMemo } from "react";
import { computeGanttScale } from "./ganttScale";
import type { SwarmAgent } from "./types";
import { useNow } from "./useNow";

/**
 * Bottom timeline strip (F5): one row per agent on a shared x axis
 * [minStart, maxEnd]. Running bars extend live via the shared 1Hz clock and
 * pulse; clicking a bar selects the agent in the graph and detail panel.
 */
export function Gantt({
  agents,
  selected,
  onSelect,
}: {
  agents: SwarmAgent[];
  selected: string | undefined;
  onSelect: (sessionID: string | undefined) => void;
}) {
  const now = useNow();
  const scale = useMemo(() => computeGanttScale(agents, now), [agents, now]);
  const byID = useMemo(() => new Map(agents.map((agent) => [agent.sessionID, agent])), [agents]);

  if (agents.length === 0) return null;

  return (
    <section className="gantt" aria-label="agent timeline">
      <div className="gantt-rows">
        {scale.bars.map((bar) => {
          const agent = byID.get(bar.sessionID);
          if (!agent) return null;
          const archived = agent.archived === true;
          const classes = [
            "gantt-bar",
            `gantt-${agent.status}`,
            selected === bar.sessionID ? "gantt-bar-selected" : "",
          ]
            .filter(Boolean)
            .join(" ");
          return (
            // Archived rows dim label + bar together; bars stay clickable.
            <div
              key={bar.sessionID}
              className={archived ? "gantt-row gantt-row-archived" : "gantt-row"}
            >
              <span className="gantt-label" title={agent.title || agent.task}>
                {agent.title || agent.task}
              </span>
              <div className="gantt-track">
                <button
                  type="button"
                  className={classes}
                  style={{ left: `${bar.left * 100}%`, width: `${bar.width * 100}%` }}
                  onClick={() => onSelect(bar.sessionID)}
                  aria-label={`select ${agent.agent}`}
                />
              </div>
            </div>
          );
        })}
      </div>
      {/* Same label+track grid as the rows, so tick % and bar % line up. */}
      <div className="gantt-row gantt-axis">
        <span className="gantt-label" aria-hidden="true" />
        <div className="gantt-track gantt-ticks">
          {scale.ticks.map((tick) => (
            <span key={tick.at} className="gantt-tick" style={{ left: `${tick.at * 100}%` }}>
              {tick.label}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}
