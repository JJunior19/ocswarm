# ocswarm 🐝

Live mission control for [OpenCode](https://opencode.ai) subagents.

A local-first OpenCode plugin that folds your orchestrator sessions into a
real-time swarm: a web dashboard (graph, Gantt, live tokens and cost), TUI
commands and notifications. The hub is 100% pure and unit-tested against real
captured event fixtures. Zero telemetry — the server binds `127.0.0.1` only.

<!-- TODO(F6): demo GIF — dashboard graph + /swarm panel side by side -->

## Features

- 🕸 **Live swarm graph** — parent → children with spawn springs, edge
  particles while subagents run, status colors and pulse, session-scoped
  views with deep links (`?session=<id>`).
- 📊 **Detail panel** — click a node: task, tool calls, tokens, live cost,
  files touched, timings.
- ⏱ **Gantt timeline** — parallel agent lifetimes on a shared time axis.
- 💸 **Live cost** — computed from the models.dev pricing already shipped
  inside your OpenCode server (no network). Subscription-plan providers that
  publish zero prices fall back to the real rate published for the same
  model under other providers. Estimates, never fabricated.
- 🐝 **TUI integration** — toast with the dashboard URL, `🐝 N agents` footer
  badge, `/swarm` tree panel (`o` opens the dashboard scoped to the current
  session), and attention notifications when subagents finish or fail.
- 🗂 **History** — deleted subagent sessions stay visible as dimmed archived
  agents so you can see what ran.

## Install

Requires OpenCode v2 (Bun runtime).

```jsonc
// opencode.jsonc
{
  "plugins": ["ocswarm"]
}
```

For local development point the entry at your checkout instead:

```jsonc
{ "plugins": ["/absolute/path/to/ocswarm"] }
```

## Usage

- The dashboard starts automatically on
  [`http://127.0.0.1:7777`](http://127.0.0.1:7777) (the port falls forward up
  to 7786 when busy). The TUI toast shows the active URL.
- Type `/swarm` in the TUI for the compact tree of the current session;
  press `o` inside the panel to open its diagram in the browser.
- Subagent completion notifications fire only while your terminal is blurred.

## How it works

```
OpenCode server events ──► SwarmHub (pure fold, fixture-tested)
                              │
                              ├─► Hono API on 127.0.0.1 ──► dashboard (Vite + React 19)
                              └─► TUI plugin (Solid) ──► /swarm, badge, notifications
```

The hub folds V2 server events into swarm state and emits deltas; clients
(snapshot + SSE) mirror the same fold. Cost is priced from the plugin's model
catalog — sessions that join late recover their names and titles via step
events and the TUI title sync.

## Development

```sh
bun install
bun run test        # vitest, 116 tests (hub fixtures, server, web, tui)
bun run typecheck
bun run build:web   # dashboard bundle → dist/web
bun run lint
```

Capture real event fixtures from a running service with
`bun scripts/capture-events.ts <output.ndjson>`.

## License

[MIT](./LICENSE)
