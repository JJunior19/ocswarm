# Feature: F0 scaffold + F1 SwarmHub (ocswarm)

## Objective

Implement F0 (scaffold) and F1 (SwarmHub) of plan.md for `ocswarm`, an OpenCode plugin
(dual entry: server plugin `.` + CLI/TUI plugin `./tui`). No dashboard (F3), no full TUI (F4).

## Problem / why

ocswarm shows what OpenCode subagents are doing right now. The hub is the core: it folds
server events into an in-RAM SwarmState and emits deltas. Everything else (server, dashboard,
TUI) consumes it.

## Key evidence gathered (source of truth corrections vs plan.md)

- Plugin V2 APIs confirmed from https://opencode.ai/v2/docs/build/plugins and /build/plugins/cli:
  `Plugin.define({id, setup(ctx)})`, `ctx.event.subscribe({signal})`,
  TUI: `@opencode/plugin/tui`, `context.ui.toast.show`, `context.ui.slot`, `context.keymap.layer`,
  `context.ui.panel.open`, package exports `"."` + `"./tui"`, peers `@opentui/core`,
  `@opentui/solid >=0.5.8`, `solid-js >=1.9.0`.
- REAL V2 event names (from `@opencode/client` generated types v2.0.24) DIFFER from plan.md's table:
  - `session.created` OK (data: sessionID, parentID?, title?, agent?, model?, projectID, ...)
  - `session.deleted` OK (data: sessionID)
  - `session.status` OK (data: status {type:"idle"|"busy"|"retry",...})
  - `session.idle` OK (data: sessionID)
  - `session.updated` does NOT exist -> `session.renamed` (data: sessionID, title)
  - `message.part.updated` does NOT exist -> tool flow is:
    `session.tool.input.started` (data has tool **name**) -> `session.tool.called` (input) ->
    `session.tool.progress` (metadata) -> `session.tool.success` / `session.tool.failed`.
    All keyed by part `id`; the hub keeps a pending map partID->{name, startedAt}.
  - Bonus events for status/tokens: `session.execution.started/succeeded/failed/interrupted`,
    `session.step.ended` (finish, cost, tokens, files?), `session.usage.updated` (cost, tokens).
- Real session data confirmed via `GET /api/session`: child sessions carry `parentID`,
  `agent`, title. In v2.0.24 titles NO LONGER carry the `(@agent subagent)` suffix
  (older sessions did). Parser must support both: agent primarily from `data.agent`,
  title suffix as fallback; task = title with suffix stripped.
- Event envelope: `{id, created, metadata?, type, durable?, location?, data}`.
- SSE auth: background service requires auth; `opencode api` buffers the whole stream and
  loses it on kill -> capture via `@opencode/client` `Service.discover()` + `Service.headers()`
  in `scripts/capture-events.ts` (also a project tool for regenerating fixtures).

## Scope (authorized)

F0: package.json (dual exports, deps/peers per plan), tsconfig strict, biome, vitest,
.gitignore, minimal loadable plugin src/index.ts (id "ocswarm") + minimal src/tui.tsx
(toast only, no JSX), opencode.jsonc in repo pointing plugins to the absolute repo path.
F1: src/hub/types.ts (SwarmAgent, SwarmState per plan.md section 3), src/hub/hub.ts
(createHub -> {apply, snapshot, deltas}), parser for task/agent from title,
deltas agent.upsert/agent.status/agent.tool/agent.removed/root.upsert,
tests from REAL captured fixtures in src/hub/__fixtures__/.
Tooling: scripts/capture-events.ts (fixtures capture).

Out of scope: Hono server, SSE endpoints, dashboard web, full TUI panel (F2-F4).

## Constraints

- Read-only toward OpenCode; no session mutation anywhere.
- Local-first: nothing leaves the machine; no telemetry.
- Package name `ocswarm`; bind 127.0.0.1 (relevant from F2 on).
- Don't invent plugin APIs - only doc-confirmed APIs.
- Artifacts (code/comments) in English; conversation in Spanish.

## Tasks

- [x] T1 — F0 scaffold: package.json, tsconfig.json, biome.json, vitest.config.ts,
      .gitignore, src/index.ts (minimal server plugin), src/tui.tsx (minimal CLI plugin),
      opencode.jsonc (plugins -> absolute repo path); install green.
      Route: delegated writer. Commit: 1d68e2f
- [x] T2 — Fixture capture tooling: scripts/capture-events.ts using @opencode/client
      (Service.discover + headers), NDJSON output. Route: delegated writer (with T1). Commit: 1d68e2f
- [x] T3 — Capture REAL fixtures: run capture + spawn real subagent(s); curate NDJSON into
      src/hub/__fixtures__/*.json (one scenario per file). Route: parent (live orchestration
      with real subagents cannot be delegated). Commit: 9fa99ce
- [x] T4 — F1 hub: src/hub/types.ts + src/hub/hub.ts (apply/snapshot/deltas, title parser,
      tool-name resolution via pending map). Route: delegated writer. Commit: 7612005
- [x] T5 — Hub tests: src/hub/events.test.ts driving hub.apply over real fixtures;
      test-first where applicable (fixtures exist before hub code). Route: delegated writer (with T4). Commit: 7612005
      Evidence: RED observed first (Cannot find module './hub'), then GREEN 19/19.
      Parent spot check re-ran `bun run test` -> 19 passed.
- [x] T6 — Verify plugin loads in a real OpenCode session (run session in repo with
      opencode.jsonc plugin path; check log for load line).
      Route: parent. Commit: — (verification only)
      Evidence: `opencode run --standalone` -> log line
      `msg="loading plugin" id=/Users/.../ocswarm entrypoint=file://.../server.ts role=server`
      with no failure, OpenCode watches server.ts + src/index.ts, and a temporary
      setup probe wrote "setup ran: opencode 2.0.24" (probe removed afterwards).
      Requires root shims + "./server" export (commit baea6e7); console.log from plugin
      setup is NOT visible in `run --standalone` output — do not rely on it.

## Key load-discovery (v2.0.24)

- Local directory plugins: loader resolves root FILES via Bun.resolveSync:
  server entry = `<repo>/server.ts` (or `<repo>/index.ts`), TUI entry = `<repo>/tui.tsx`.
  The package exports map is NOT consulted for local directories; without a resolvable
  server entry the plugin is silently skipped (no warning).
- Registry packages (by name): specifier `<name>/server` / `<name>/tui` / `<name>` —
  hence exports {".", "./server", "./tui"} covers both worlds.
- `opencode.jsonc` project config IS read (verified via `opencode debug config`);
  `.jsonc` and `.json` both work. Background service needs a restart (or use
  `opencode run --standalone`) to pick up newly added project plugins.

## Verification evidence

- T1/T2: bun install clean; tsc --noEmit clean; biome clean; vitest passWithNoTests;
  capture tool smoke-tested live (captured server.connected, SIGINT exit 0).
- T3: 80 real events across 3 fixtures (25 lifecycle / 48 parallel / 7 root-failure),
  verbatim payloads, original order; captured from real subagent runs spawned during
  this session + one `opencode run` provider failure.
- T4/T5: `bun run test` -> 19/19 (real fixture flows + synthetic tool.failed/deleted +
  parser + status mapping + late-join + snapshot isolation + zero-I/O guard).
  `bun run typecheck` clean; `bun run lint` exit 0. RED->GREEN observed by the writer;
  parent spot check reproduced the passing run. Hub modules import nothing beyond
  ./types (no node:/@opencode imports — enforced by a test).
- T6: see T6 block above. Plugin setup executed in a real standalone session.
- RDD is OFF (global user setting): no review ceremony; ordinary checks only.
  `gentle-ai review assess` over residual docs change: passive, review_due false.

## Delivery strategy

ask-on-risk (default). Total authored lines this feature ~1.4k (incl. fixtures/tests) —
single feature branch feat/f0-f1-hub, one work-unit commit per task:
c73c21e (docs), 1d68e2f (scaffold+tool), baea6e7+88e5164 (load fix), 9fa99ce (fixtures),
7612005 (hub+tests). No push/PR (user decides).

## Open items / next

- F2: Hono server on 127.0.0.1, /api/state, /api/stream (SSE of hub deltas), /api/info,
  port fallback; URL discovery for the TUI plugin (candidate: GET /api/info port scan).
- F3/F4 as per plan.md (dashboard web, TUI panel).
- Mirror: Engram topic `odd/f0-f1-scaffold-hub/tasks` (synced through T5).
