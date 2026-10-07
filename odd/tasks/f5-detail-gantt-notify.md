# Feature: F5 detail, metrics and notifications (ocswarm)

## Objective

Finish plan.md F5 "Detalle y métricas":
- Dashboard: click → detail side panel (task, tool calls, tokens/cost, files touched).
- Tokens + live cost (aggregate + per agent).
- Bottom Gantt strip with parallel agent lifetimes.
- TUI: `context.attention.notify` when a background subagent ends/fails,
  differentiated success/error.

## Design decisions (pre-delegated)

- **Branch topology**: `feat/f5-detail` stacked on `feat/f4-tui` (same pattern). No
  push/PR — user decision.
- **Detail panel data source (MVP)**: render from **client state** — the hub already
  ships task, status, timing, toolCalls (name/status/at), tokens, costUSD and
  filesTouched via `/api/state` + stream. No `GET /api/session/:id` in F5: the client
  already holds this data, and a messages-stream endpoint has no grounded data source
  yet. Writer A does ONE bounded check of the server-plugin types for a real
  messages/diff read API; if and only if it is trivially grounded, add
  `GET /api/session/:id`; otherwise the limitation is documented here (defer).
- **Gantt**: hand-rolled SVG strip (no new deps). Shared time axis [minStart,
  maxEndOrNow]; running bars extend to now; bars share the node palette and clicking
  one selects the same detail panel.
- **Cost/tokens**: per-agent in the detail panel; header shows live totals
  (Σ tokens in/out, Σ costUSD). costUSD already comes from cumulative
  `session.usage.updated` events — display work only, no pricing lookup needed.
- **attention.notify data source**: writer B checks the installed TUI plugin types
  (`node_modules/@opencode/plugin/dist/tui/`) for `context.attention` and
  `context.data.listen`. Preferred: a grounded `data.listen` session stream; fallback:
  SSE subscribe to the already-discovered dashboard URL and watch `agent.status`
  deltas for subagent sessions (parentID present). Decision logic (delta → notify?)
  is a pure, unit-tested function; variant success/error differentiated. Notify only
  when the session is blurred if the API exposes that option (plan: `when: "blurred"`).

## Constraints

- Palette `#0d1117` / `#7ee787` / `#79c0ff` (+ red `#f85149`, gray `#8b949e`).
- No new runtime deps for the dashboard (Gantt is plain SVG + existing framer-motion).
- Hub stays pure; TUI/server may do I/O. Read-only toward OpenCode.
- plan.md §6 "partículas en las aristas" stays OUT of F5 (listed under MVP extras, not
  in the F5 checklist; revisit if the user asks).

## Tasks

- [ ] T1 — Dashboard: AgentDetail side panel (click + Esc/× close), Gantt bottom strip,
      header token/cost totals, pure format/selector helpers + tests. Bounded type
      check for a messages/diff API → `/api/session/:id` only if grounded.
      Route: delegated writer. Commit: -
- [ ] T2 — TUI: attention.notify on subagent done/error, differentiated variant,
      decision logic pure + tested, grounded data source (data.listen or SSE fallback).
      Route: delegated writer (sequential after T1). Commit: -
- [ ] T3 — Close-out: full test/typecheck/lint, vite build, live dashboard check,
      docs + mirror update. Route: parent. Commit: -

## Verification evidence

- (pending)

## Delivery strategy

Stacked branch on feat/f4-tui. Forecast ~400-600 authored lines (web panel + gantt +
tests + tui notify). No push (user decision).

## Open items / next

- Messages stream + real file diffs: needs a grounded read API (investigate upstream
  plugin surface; possible F5.1).
- F6: release (README GIF, npm publish files map, tag).
- Mirror: Engram topic `odd/f5-detail-gantt-notify/tasks`.
