# Feature: F3 dashboard + F4 TUI (ocswarm)

## Objective

Finish plan.md through F4:
- F3: web dashboard MVP (Vite + React 19 + Framer Motion + d3-force) served by the
  F2 Hono server from `dist/web/`.
- F4: TUI plugin (URL discovery, toast, `home.footer.status` slot, `/swarm` panel,
  `o` opens browser).

## Design decisions (pre-delegated)

- **Branch topology**: stacked branches `feat/f3-dashboard` -> `feat/f4-tui` on top of
  `feat/f2-local-server` (same pattern as F0-F2). Merges/push remain user decisions.
- **Statics**: custom portable handler in `src/server/app.ts` (node:fs content-type map)
  with a configurable `staticRoot` dep; falls back to the F2 placeholder when `dist/web`
  is absent (dev mode). Avoids platform-specific hono serveStatic (tests run under node).
  `dist/` stays gitignored (publish wiring is F6).
- **Dashboard MVP scope (plan §6 F3 exactly)**: fetch `/api/state` + `EventSource /api/stream`;
  parent->children graph (d3-force for layout); spring spawn animation (Framer Motion);
  status colors (running pulse green/done, red error, gray idle); current-tool badge;
  per-agent timer. Explicitly OUT: detail side panel, edge particles, Gantt (F5).
- **SSE client state**: pure reducer module (`applyDelta(state, delta)`) mirroring hub
  semantics; unit-tested in vitest node env (no DOM deps). Components themselves untested (MVP).
- **TUI data source**: plan §5 — the TUI uses OpenCode's own cached session data
  (`context.data.session.*`), NOT the HTTP API. URL discovery: port scan `GET /api/info`
  7777..7786 (first `{name:"ocswarm"}` wins), pure + injected-fetch for tests.
- **F4 scope (plan §5 exactly)**: toast on load with URL; `home.footer.status` slot
  `🐝 N agents`; `/swarm` slash command -> `session.panel` `ocswarm.tree` with compact
  tree (parent -> children, status, elapsed); `o` in panel opens the browser
  (`open`/`xdg-open`). OUT: attention.notify on background completion (F5).

## Constraints

- Paleta: fondo `#0d1117`, verde `#7ee787`, azul `#79c0ff`.
- Read-only hacia OpenCode; local-first; bind 127.0.0.1 (ya cubierto por F2).
- TUI: Solid JSX (tsconfig ya tiene jsx preserve + solid-js importSource; peers
  auto-instalados por bun). Server plugin: sin I/O en src/hub (regla ya testeada).

## Tasks

- [ ] T1 — Dashboard: `src/web/` (Vite app: index.html, App, reducer, hook SSE, graph
      view, theme), statics en `src/server/app.ts` (staticRoot dep + tests), deps
      (react 19, framer-motion, d3-force, vite, plugin-react, types), scripts de build.
      Route: delegated writer. Commit: -
- [ ] T2 — Live verification dashboard: `vite build` + standalone run + curl `/`
      (HTML) y un asset. Route: parent. Commit: -
- [ ] T3 — TUI: `src/tui.tsx` real (toast, slot footer, /swarm -> panel ocswarm.tree,
      `o` abre navegador), `src/tui/discover.ts` (port scan) + tree builder + tests.
      Route: delegated writer. Commit: -
- [ ] T4 — Cierre: typecheck/lint/test completos; instrucciones de verificación manual
      del TUI (interactivo). Route: parent. Commit: -

## Verification evidence

- (pending)

## Delivery strategy

ask-on-risk. Forecast ~800-1000 líneas entre ambas fases; branches apiladas ya
acordadas arriba; sin push/PR (decisión del usuario).

## Open items / next

- F5: panel de detalle + coste en vivo + Gantt + attention.notify.
- F6: release (GIF, npm publish, files map).
- Mirror: Engram topic `odd/f3-f4-dashboard-tui/tasks`.
