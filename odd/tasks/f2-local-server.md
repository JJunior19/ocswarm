# Feature: F2 local server (ocswarm)

## Objective

Serve the SwarmHub over local HTTP: Hono app bound to 127.0.0.1 with
`GET /api/state` (snapshot), `GET /api/stream` (SSE of hub deltas),
`GET /api/info` (URL discovery for the TUI plugin, plan.md risk #1), port
fallback +1..+10, and a placeholder index until the web build exists (F3).

## Why / context

F1 delivered `createHub()` (pure, apply -> deltas). F2 wires the wire
protocol: the server plugin applies events and broadcasts deltas to SSE
clients; the dashboard (F3) and TUI (F4) consume the endpoints.

## Design decisions (pre-delegated, evidence-based)

- **Hono over Bun.serve** (`hono` dep, `^4`): plan.md default; the OpenCode
  plugin process is a compiled Bun binary (verified via binary strings:
  $bunfs chunks), and Hono's `app.fetch` is runtime-agnostic so tests run
  under vitest/node without any server.
- **Hub stays pure**: no hub changes. `src/index.ts` wires
  `hub.apply(event)` -> broadcaster Set<(deltas) => void>; `app.ts`
  receives a `subscribeDeltas(cb)` function. SSE initial batch replays
  snapshot as agent.upsert/root.upsert events, then forwards live deltas.
- **Port fallback lives in a pure helper** (tries base..base+10 with an
  injected serve function) so it is unit-testable; production passes a
  Bun.serve-backed adapter accessed lazily via `globalThis.Bun` (never a
  top-level import — vitest runs under node).
- **Statics deferred**: `GET /` returns a placeholder text response until
  the Vite build exists (F3). No dist/web serving yet.
- **Binding**: hostname hardcoded `127.0.0.1`, local-first.

## Constraints

- Read-only toward OpenCode; no telemetry; bind 127.0.0.1 only.
- No new runtime deps beyond `hono`.
- Real-session verification at close: plugin loads AND /api/info answers.

## Tasks

- [x] T1 — Server app + wiring: `src/server/app.ts` (routes incl. streamSSE),
      `src/server/listen.ts` (port fallback, lazy Bun adapter),
      `src/index.ts` wiring (hub + broadcaster + server lifecycle),
      `package.json` (+hono 4.13.13), tests for state/info/SSE-initial-batch/port
      fallback. Route: delegated writer. Commit: 0a421fd
      Evidence: 28/28 tests (19 hub + 4 app + 5 listen), typecheck clean, lint clean.
      hono 4.13 note: SSE helper lives in "hono/streaming"; hono does not wire the
      request abort signal on node (server adds its own signal listener + stream.abort).
- [x] T2 — Real-session verification: plugin serves on 127.0.0.1:7777 from the
      RESTARTED background service (project config re-scanned after restart), and
      standalone runs work with port fallback. Route: parent. Commit: — (verification)
      Evidence: `curl 127.0.0.1:7777/api/info` -> {"name":"ocswarm","version":"0.1.0",...};
      `/api/state` -> live SwarmState with the current real session (running) and a
      completed subagent session (both late-joined as "unknown" agents — matches the
      documented materialization rule); `/api/stream` -> 200 text/event-stream.

## Verification evidence

- `bun run test` 28/28; `bun run typecheck` exit 0; `bun run lint` exit 0.
- Live check (see T2): plugin instance of the real background service answering on
  127.0.0.1:7777 with real event data; SSE headers correct; port released cleanly on
  exit.
- Head-up: an external gentle-ai tooling run overwrote `opencode.jsonc` with a merged
  copy of the user's global config (agents/permissions). Restored to the committed
  4-line version (git checkout); the tooling artifact `.gentle-ai-default-agent.json`
  remains untracked and was not committed.

## Delivery strategy

ask-on-risk (default). Forecast ~300-400 authored lines. Single work-unit
commit for T1; T2 is verification only. No push/PR (user decides).

## Open items / next

- F3: Vite+React19 dashboard consuming /api/state + /api/stream.
- F4: TUI toast with discovered URL (port scan /api/info), footer slot,
  /swarm panel.
- Mirror: Engram topic `odd/f2-local-server/tasks`.
