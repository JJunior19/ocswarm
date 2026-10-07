import {
  forceCollide,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type SimulationNodeDatum,
} from "d3-force";
import { AnimatePresence, MotionConfig, motion } from "framer-motion";
import { useMemo, useRef } from "react";
import { EdgeParticles, type Pos } from "./EdgeParticles";
import { formatElapsed } from "./format";
import type { AgentRow } from "./reducer";
import type { AgentStatus, SwarmAgent } from "./types";
import { useNow } from "./useNow";

// Fixed logical viewport; the SVG scales to its container via CSS.
const WIDTH = 880;
const HEIGHT = 560;
const NODE_RADIUS = 26;
const ROOT_Y = 90; // roots pinned along the top
const FIELD_Y = 380; // vertical attractor for the flat subagent cloud
const CLOUD_TOP = 300; // depth-1 band once the tree nests deeper…
const CLOUD_BOTTOM = 460; // …deepest level (both inside the clamp range)
const TASK_MAX_CHARS = 40;

const STATUS_COLORS: Record<AgentStatus, string> = {
  running: "var(--green)",
  idle: "var(--idle)",
  done: "var(--blue)",
  error: "var(--error)",
};

interface LayoutNode extends SimulationNodeDatum {
  id: string;
  depth: number;
}

function truncate(text: string, max = TASK_MAX_CHARS): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Vertical attractor for a subagent at `depth`: the flat cloud sits on
 * FIELD_Y exactly as before F5.1; a nested tree fans deeper levels from
 * CLOUD_TOP down to CLOUD_BOTTOM so ranks read top-to-bottom.
 */
function cloudY(depth: number, maxDepth: number): number {
  if (maxDepth <= 1) return FIELD_Y;
  const t = (depth - 1) / (maxDepth - 1);
  return CLOUD_TOP + t * (CLOUD_BOTTOM - CLOUD_TOP);
}

/**
 * Positions for every agent. Depth-0 roots sit along the top (single root =
 * top center); subagents are spread by a d3-force simulation run
 * synchronously (~300 ticks) — the simulation itself is never animated.
 */
function computeLayout(rows: AgentRow[]): Map<string, Pos> {
  const positions = new Map<string, Pos>();
  const maxDepth = rows.reduce((max, row) => Math.max(max, row.depth), 0);

  const roots = rows.filter((row) => row.depth === 0);
  roots.forEach((row, index) => {
    const x = roots.length === 1 ? WIDTH / 2 : ((index + 1) / (roots.length + 1)) * WIDTH;
    positions.set(row.agent.sessionID, { x, y: ROOT_Y });
  });

  const nodes: LayoutNode[] = rows
    .filter((row) => row.depth > 0)
    .map((row) => ({ id: row.agent.sessionID, depth: row.depth, x: WIDTH / 2, y: FIELD_Y }));
  if (nodes.length > 0) {
    const simulation = forceSimulation(nodes)
      .force("x", forceX<LayoutNode>(WIDTH / 2).strength(0.06))
      .force(
        "y",
        forceY<LayoutNode>()
          .y((node) => cloudY(node.depth, maxDepth))
          .strength(0.1),
      )
      .force("charge", forceManyBody<LayoutNode>().strength(-260))
      .force("collide", forceCollide<LayoutNode>(NODE_RADIUS + 36))
      .stop();
    simulation.tick(300);
    for (const node of nodes) {
      positions.set(node.id, {
        x: clamp(node.x ?? WIDTH / 2, 70, WIDTH - 70),
        y: clamp(node.y ?? FIELD_Y, ROOT_Y + 140, HEIGHT - 70),
      });
    }
  }

  return positions;
}

/**
 * Memoized layout keyed by the node id set: positions recompute only when
 * agents appear or disappear, not on every status/tool delta.
 */
function useNodeLayout(rows: AgentRow[]): Map<string, Pos> {
  const cache = useRef<{ key: string; positions: Map<string, Pos> } | null>(null);
  const key = rows
    .map((row) => row.agent.sessionID)
    .sort()
    .join("|");
  if (cache.current === null || cache.current.key !== key) {
    cache.current = { key, positions: computeLayout(rows) };
  }
  return cache.current.positions;
}

/**
 * The agent graph for the VISIBLE agents (F5.1: whole swarm in the "all"
 * view, one root's subtree when a session pill is selected). `depth` maps
 * each visible session id to its tree depth (0 = root). Node visuals and
 * selection behavior are unchanged.
 */
export function GraphView({
  agents,
  depth,
  selected,
  onSelect,
}: {
  agents: SwarmAgent[];
  depth: Map<string, number>;
  selected: string | undefined;
  onSelect: (sessionID: string | undefined) => void;
}) {
  const rows = useMemo(
    () =>
      agents
        .map((agent) => ({ agent, depth: depth.get(agent.sessionID) ?? (agent.parentID ? 1 : 0) }))
        .sort(
          (a, b) =>
            a.agent.startedAt - b.agent.startedAt ||
            a.agent.sessionID.localeCompare(b.agent.sessionID),
        ),
    [agents, depth],
  );
  const positions = useNodeLayout(rows);
  const now = useNow();

  // Edges parent→child, drawn under the nodes. A child whose parent is not
  // visible (e.g. materialized orphan) hangs off the first root when one exists.
  // `flow` marks running non-archived children (edge particles, F5.3);
  // `archived` dims the line with the node.
  const fallbackRoot = rows.find((row) => row.depth === 0)?.agent.sessionID;
  const edges: {
    id: string;
    from: Pos;
    to: Pos;
    flow: boolean;
    archived: boolean;
  }[] = [];
  for (const row of rows) {
    if (row.depth === 0) continue;
    const from = positions.get(row.agent.parentID ?? fallbackRoot ?? "");
    const to = positions.get(row.agent.sessionID);
    if (from && to)
      edges.push({
        id: row.agent.sessionID,
        from,
        to,
        flow: row.agent.status === "running" && !row.agent.archived,
        archived: row.agent.archived === true,
      });
  }

  const placed = rows
    .map((row) => ({ row, pos: positions.get(row.agent.sessionID) }))
    .filter((entry): entry is { row: AgentRow; pos: Pos } => entry.pos !== undefined);

  return (
    // reducedMotion="user": under prefers-reduced-motion, framer-motion turns
    // transform animations (spawn springs, hover lift) into instant placement.
    <MotionConfig reducedMotion="user">
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: SVG canvas is pointer-first; keyboard users clear selection with the global Escape handler. */}
      <svg
        className="graph"
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role="img"
        aria-label="ocswarm live agent graph"
        onClick={() => onSelect(undefined)}
      >
        <title>ocswarm live agent graph</title>

        {edges.map(({ id, from, to, archived }) => (
          <line
            key={id}
            className={archived ? "edge edge-archived" : "edge"}
            x1={from.x}
            y1={from.y}
            x2={to.x}
            y2={to.y}
          />
        ))}

        {/* Flow dots under the nodes, only while a child is running (F5.3). */}
        {edges
          .filter((edge) => edge.flow)
          .map(({ id, from, to }) => (
            <EdgeParticles key={id} from={from} to={to} />
          ))}

        <AnimatePresence>
          {placed.map(({ row, pos }, index) => {
            const archived = row.agent.archived === true;
            // Spawn stagger follows the sorted-by-startedAt order: later agents
            // pop in just after their earlier siblings.
            const spawnDelay = Math.min(index * 0.05, 0.25);
            return (
              // Outer <g> owns the static position and the click target; inner
              // motion.g owns the spawn/exit spring so CSS scale never fights the
              // transform.
              // biome-ignore lint/a11y/useSemanticElements: SVG node groups cannot be <button>; role + tabIndex is the SVG idiom.
              <g
                key={row.agent.sessionID}
                className={`node-group${archived ? " node-group-archived" : ""}${
                  selected === row.agent.sessionID ? " node-group-selected" : ""
                }`}
                role="button"
                tabIndex={0}
                aria-label={`select ${row.agent.agent}`}
                transform={`translate(${pos.x} ${pos.y})`}
                onClick={(event) => {
                  event.stopPropagation(); // keep the svg background clear-click
                  onSelect(row.agent.sessionID);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onSelect(row.agent.sessionID);
                  }
                }}
              >
                <motion.g
                  initial={{ scale: 0, opacity: 0 }}
                  animate={{
                    scale: 1,
                    opacity: 1,
                    transition: {
                      type: "spring",
                      stiffness: 300,
                      damping: 20, // slight overshoot on the pop-in
                      delay: spawnDelay,
                    },
                  }}
                  exit={{
                    scale: 0,
                    opacity: 0,
                    transition: { duration: 0.18, ease: "easeIn" },
                  }}
                  whileHover={
                    archived
                      ? undefined // archived nodes stay put; still clickable
                      : {
                          scale: 1.06,
                          transition: { type: "spring", stiffness: 400, damping: 17 },
                        }
                  }
                  transition={{ type: "spring", stiffness: 300, damping: 20 }}
                  style={{ originX: 0.5, originY: 0.5 }}
                >
                  {row.agent.status === "running" && !archived && (
                    <circle className="pulse-ring" r={NODE_RADIUS + 6} />
                  )}
                  {selected === row.agent.sessionID && (
                    <circle className="node-selected" r={NODE_RADIUS + 3} />
                  )}
                  <circle
                    className="node-circle"
                    r={NODE_RADIUS}
                    stroke={STATUS_COLORS[row.agent.status]}
                  />
                  <text className="node-name" y={-(NODE_RADIUS + 24)} textAnchor="middle">
                    {row.agent.agent}
                  </text>
                  <text className="node-task" y={-(NODE_RADIUS + 8)} textAnchor="middle">
                    {truncate(row.agent.task || row.agent.title)}
                  </text>
                  {row.agent.currentTool && (
                    <text className="node-tool" y={NODE_RADIUS + 18} textAnchor="middle">
                      {`▸ ${row.agent.currentTool.name}`}
                    </text>
                  )}
                  <text className="node-elapsed" y={NODE_RADIUS + 38} textAnchor="middle">
                    {formatElapsed((row.agent.endedAt ?? now) - row.agent.startedAt)}
                  </text>
                </motion.g>
              </g>
            );
          })}
        </AnimatePresence>
      </svg>
    </MotionConfig>
  );
}
