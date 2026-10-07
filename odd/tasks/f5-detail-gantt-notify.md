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

- [x] T1 — Dashboard: AgentDetail side panel (click + Esc/× close), Gantt bottom strip,
      header token/cost totals, pure format/selector helpers + tests. Bounded type
      check for a messages/diff API → `/api/session/:id` only if grounded.
      Route: delegated writer. Commit: 469c428
      Evidence: 73/73 tests (15 nuevos: 9 format, 6 ganttScale), vite build OK,
      typecheck root + web. **Endpoint NO agregado con evidencia**: el contexto de
      plugin (`plugin.d.ts`) expone `session: Pick<...>` sin diff ni messages;
      `session.diff` existe solo en `@opencode/client` crudo (plugins nunca lo
      reciben) y `ctx.vcs.diff` pide un VcsScope no grounded → limitación documentada.
- [x] T2 — TUI: attention.notify on subagent done/error, differentiated variant,
      decision logic pure + tested, grounded data source (data.listen or SSE fallback).
      Route: delegated writer (sequential after T1). Commit: 7a8c36e
      Evidence: 81/81 tests (8 nuevos en notify.test.ts), typecheck+lint clean.
      **Path tomado: `data.listen`** (no hizo falta SSE): emite
      `session.execution.succeeded/failed` con `data.sessionID`. notify usa options
      object: `notification: {when:"blurred"}` + `sound: subagent_done|error` (la API
      no tiene `variant` — diferenciación por prefijo ✔/✗ + sonido). `setup` retorna
      Cleanup → watcher con dispose determinista.
- [x] T3 — Close-out: full test/typecheck/lint, vite build, live dashboard check,
      docs + mirror update. Route: parent.
      Evidence: parent re-ran `bun run test` → 81/81 (9 files), `typecheck` exit 0.
      Live: 7777 sirve el bundle nuevo (index-DB0-zHF0.js → 200). Spot check del
      notify wiring en watch.ts: `when:"blurred"` + sonidos diferenciados ✓.

## Verification evidence

- `bun run test` → 81/81 (hub 21, server 15, web format/gantt/reducer 26, tui 19).
- `bun run typecheck` exit 0; lint: 0 findings en archivos tocados (warnings
  pre-existentes en src/hub/** quedan como están, fuera de alcance).
- Dashboard en vivo: `/` + asset 200 con el build F5 (panel + gantt + totales).
- TUI notify: verificación automática cubre decisión pura + wiring typecheck; el
  disparo real (sesión blurred + subagent terminando) es verificación manual.

## Known limitations (documented, not defects)

- **Mensajes stream + diff real de ficheros**: imposibles hoy desde un plugin — el
  contexto no expone lectores de mensajes ni `session.diff` (solo el client crudo).
  Panel muestra todo lo que el hub sí tiene: task, tool calls, tokens, coste,
  ficheros tocados (lista), timings. Posible F5.1 si upstream expone la API.
- Gantt: agentes materializados late-join tienen startedAt del primer evento
  observado (límite del hub, ya conocido).

## Delivery strategy

Stacked branch feat/f5-detail (6ac8000 → 469c428 → 7a8c36e) sobre feat/f4-tui.
~700 líneas autorizadas. Sin push/PR (decisión del usuario).

## Open items / next

- F6: release (README + GIF, npm publish files map, tag, PR awesome-opencode).
- Mirror: Engram topic `odd/f5-detail-gantt-notify/tasks` (synced).
