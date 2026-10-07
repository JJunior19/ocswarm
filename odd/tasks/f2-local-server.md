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

- [ ] T1 — Server app + wiring: `src/server/app.ts` (routes incl. streamSSE),
      `src/server/listen.ts` (port fallback, lazy Bun adapter),
      `src/index.ts` wiring (hub + broadcaster + server lifecycle),
      `package.json` (+hono), tests for state/info/SSE-initial-batch/port
      fallback. Route: delegated writer. Commit: -
- [ ] T2 — Real-session verification: `opencode run --standalone` in repo,
      then curl 127.0.0.1:<port>/api/info and /api/state; confirm SSE
      content-type on /api/stream. Route: parent. Commit: -

## Verification evidence

- (pending)

## Delivery strategy

ask-on-risk (default). Forecast ~300-400 authored lines. Single work-unit
commit for T1; T2 is verification only. No push/PR (user decides).

## Open items / next

- F3: Vite+React19 dashboard consuming /api/state + /api/stream.
- F4: TUI toast with discovered URL (port scan /api/info), footer slot,
  /swarm panel.
- Mirror: Engram topic `odd/f2-local-server/tasks`.
