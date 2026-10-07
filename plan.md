# ocswarm — Plan de implementación

> 🐝 **Live mission control for OpenCode subagents** — mira cómo evoluciona tu enjambre de
> subagentes en tiempo real: qué tarea hace cada uno, qué herramienta está corriendo,
> cuánto lleva, cuánto cuesta.
>
> Distribución: **plugin de OpenCode** (`plugins: ["ocswarm"]`).

---

## 1. Qué es

Cuando el agente padre lanza subagentes (`explore`, `general`, `reviewer`, …), hoy son una
caja negra: sabes que están ahí, pero no qué hacen ni cómo van. `ocswarm` lo hace visible:

- **En el TUI**: algo breve — un toast al arrancar, un indicador en el footer con el número
  de agentes activos y un comando `/swarm` que abre un panel compacto con la URL del
  dashboard completo.
- **En el navegador**: la vista rica y animada — el agente padre como nodo raíz, los
  subagentes naciendo con animación spring, anillos pulsantes mientras trabajan,
  partículas en las aristas, badge de la herramienta actual, y click → panel de detalle.

**Posicionamiento**: `ocmonitor` te dice cuánto te cuestan los agentes (agregado);
`OpencodeBar` te dice el coste por sesión/subagente; `ocswarm` te dice **qué están
haciendo ahora mismo**. Referente previo: `agentdeck` existe pero es control remoto móvil
vía tmux/PTY para Claude Code — nicho distinto que valida la demanda.

---

## 2. Decisión clave: plugin de OpenCode (dual entry)

Un solo paquete npm `ocswarm` con **dos entrypoints** (patrón oficial de la doc V2):

```jsonc
// package.json
{
  "name": "ocswarm",
  "type": "module",
  "exports": {
    ".": "./src/index.ts",      // server plugin — corre dentro del servidor de OpenCode
    "./tui": "./src/tui.tsx"    // CLI plugin — extiende el TUI
  },
  "dependencies": { "@opencode/plugin": "latest" },
  "peerDependencies": {
    "@opentui/core": ">=0.5.8",
    "@opentui/solid": ">=0.5.8",
    "solid-js": ">=1.9.0"
  }
}
```

**Ventajas de ser plugin vs. CLI standalone:**

- Cero descubrimiento de servicio: el plugin corre **dentro** del servidor y recibe los
  eventos directamente vía `ctx.event.subscribe()`.
- Instalación trivial: `"plugins": ["ocswarm"]` en `opencode.json(c)` (global o proyecto).
- Extensión del TUI nativa: slash commands, session panels, slots del footer/sidebar,
  toasts y notificaciones del sistema (`context.attention.notify`).
- Datos de sesión ya cacheados por el TUI: `context.data.session.family(id)` (jerarquía
  padre→hijos), `.cost(id)`, `.status(id)` — sin reconstruir nada.

El modo standalone (`npx ocswarm` contra un servidor remoto/headless) queda como fase
posterior: `@opencode/client` ya sabe descubrir/arrancar el servicio.

```
┌─────────────────────────────────────────────────────────┐
│                servidor de OpenCode                     │
│                                                         │
│  ocswarm (server plugin)                                │
│  ├─ ctx.event.subscribe() ──► SwarmHub (estado en RAM)  │
│  ├─ ctx.model.list() ──► pricing (coste por subagente)  │
│  └─ Hono en 127.0.0.1:7777                              │
│       ├─ GET /              dashboard (build embebido)  │
│       ├─ GET /api/state     snapshot completo           │
│       ├─ GET /api/stream    SSE de deltas               │
│       └─ GET /api/session/:id  detalle (mensajes/diff)  │
└───────────────┬─────────────────────────────────────────┘
                │ SSE
        ┌───────▼────────┐          ┌──────────────────────┐
        │   Navegador    │          │  TUI (cli plugin)    │
        │  dashboard     │          │  /swarm → panel      │
        │  animado       │          │  toast + footer slot │
        └────────────────┘          │  attention.notify    │
                                    └──────────────────────┘
```

---

## 3. Modelo de datos (SwarmHub)

```ts
type AgentStatus = "running" | "idle" | "done" | "error"

interface SwarmAgent {
  sessionID: string
  parentID?: string            // presente ⇒ es subagente
  agent: string                // "explore" | "general" | "reviewer" | …
  title: string                // título de la child session
  task: string                 // descripción del tool call `subagent` del padre
  status: AgentStatus
  startedAt: number
  endedAt?: number
  currentTool?: { name: string; summary?: string; startedAt: number }
  toolCalls: { name: string; status: string; at: number }[]
  tokens: { input: number; output: number; cacheRead: number; cacheWrite: number }
  costUSD: number
  filesTouched: string[]       // perezoso: via /api/session/:id (diff)
}

interface SwarmState {
  roots: string[]                          // sessionIDs de nivel superior
  agents: Record<string, SwarmAgent>       // por sessionID
  updatedAt: number
}
```

### Mapeo eventos V2 → estado

| Evento / API | Uso |
|---|---|
| `session.created` / `session.updated` | alta/actualización de nodo; `info.parentID` ⇒ subagente |
| título de child session | V2 lo genera como `"{description} (@{agent} subagent)"` → parsear `task` y `agent` |
| `message.part.updated` | `Session.Message.Assistant.Tool` + `ToolState.Running/Completed/Error` ⇒ **herramienta actual** y log de tool calls |
| `session.status` / `session.idle` | transiciones de estado del agente |
| `session.deleted` | retirar nodo (con animación de salida) |
| tokens por mensaje (`TokenUsage.Info`) × coste del modelo (`ctx.model.list()`) | coste en vivo — misma lógica de pricing que OpencodeBar (LiteLLM/models.dev) |
| `GET /api/session/:id/diff` (bajo demanda) | ficheros tocados, para el panel de detalle |

Reglas del hub:
- Estado en RAM, snapshot inicial reconstruido con `ctx.session.*` / lectura de sesiones
  al arrancar (para ver subagentes de sesiones previas al arranque del plugin, si la API
  lo permite; si no, solo sesiones nuevas — anotar en el README).
- Emitir **deltas** (no snapshots) por SSE: `agent.upsert`, `agent.status`,
  `agent.tool`, `agent.removed`, `root.upsert`.
- Si el proceso del plugin muere, no corrompe nada: es read-only hacia OpenCode.

---

## 4. Server plugin (`src/index.ts`)

```ts
import { Plugin } from "@opencode/plugin"
import { createHub } from "./hub"
import { createServer } from "./server"

export default Plugin.define({
  id: "ocswarm",
  async setup(ctx) {
    const hub = createHub()
    const controller = new AbortController()

    void (async () => {
      for await (const event of ctx.event.subscribe({ signal: controller.signal })) {
        hub.apply(event)          // session.*, message.part.updated, …
      }
    })()

    const srv = await createServer({ hub, ctx, port: ctx.options.port ?? 7777 })

    // Anunciar la URL hacia el TUI (vía evento/estado; el cli plugin la muestra)
    return () => {
      controller.abort()
      srv.stop()
    }
  },
})
```

- HTTP con **Hono** (o `Bun.serve` si el runtime lo permite — probar primero; Hono es
  runtime-agnóstico y va sobre fetch).
- **Bind siempre a `127.0.0.1`** — local-first, cero telemetría, sin auth necesaria.
- Puerto: `options.port`; si está ocupado, probar `port+1…+10` y reportar el elegido.
- El frontend servido es el build de Vite embebido en el paquete (`dist/web/`).

## 5. CLI/TUI plugin (`src/tui.tsx`)

Con `@opencode/plugin/tui`:

- **Toast al cargar**: `🐝 ocswarm → http://localhost:7777` (ésto es el "banner breve"
  que pide la UX).
- **Slot `home.footer.status`**: indicador persistente `🐝 2 agents` + la URL abreviada
  (reactivo con `context.data.session.*`).
- **Comando `/swarm`** (keymap layer, `palette: true`, `slash: { name: "swarm" }`):
  - abre un **`session.panel`** (`panel.name: "ocswarm.tree"`) con el árbol compacto
    renderizado en Solid/OpenTUI: padre → hijos, estado, herramienta actual, tiempo.
  - acción en el panel: `o` = abrir el dashboard en el navegador
    (`open "http://localhost:7777"`).
- **`context.attention.notify`** cuando un subagente en background termina o falla
  (`notification: { when: "blurred" }`).
- Datos reactivos: `context.data.listen(...)` + `context.data.session.family(id)`.

## 6. Dashboard web (`src/web/`)

- **Vite + React 19 + Framer Motion + d3-force** (SVG; canvas solo si el nº de nodos lo
  exige). Tema con la paleta del perfil: fondo `#0d1117`, verde `#7ee787`, azul `#79c0ff`.
- Vista:
  - Grafo: nodo padre arriba/centro; subagentes nacen con **spring desde el padre**
    (Framer Motion `layout` + d3-force para repartir).
  - Anillo pulsante mientras `running` → verde `done` → rojo `error` → gris `idle`.
  - Partículas fluyendo padre↔hijo mientras hay tool calls activos.
  - Badge de herramienta actual: `▸ editing auth.ts`, `▸ reading 42 files`.
  - Click en nodo → panel lateral: tarea, stream de mensajes, tool calls, tokens/coste,
    ficheros tocados (`/api/session/:id`).
  - Franja inferior Gantt con las vidas de los agentes en paralelo.
- Conexión: `EventSource("/api/stream")` + `fetch("/api/state")` al montar.

## 7. Estructura del repo

```
ocswarm/
├── plan.md                  ← este documento
├── README.md                ← English, con GIF (se escribe en F6)
├── package.json             ← exports "." y "./tui"
├── tsconfig.json
├── biome.json / .eslintrc   ← lint/format (Biome recomendado)
├── vitest.config.ts
├── src/
│   ├── index.ts             ← server plugin
│   ├── hub/                 ← SwarmHub: eventos → estado (unit-testeable, sin I/O)
│   │   ├── hub.ts
│   │   ├── events.test.ts
│   │   └── types.ts
│   ├── server/              ← Hono: /api/state, /api/stream, estáticos
│   ├── tui.tsx              ← cli plugin (Solid + OpenTUI)
│   └── web/                 ← dashboard (Vite/React)
│       ├── index.html
│       ├── src/App.tsx
│       └── src/graph/…
└── dist/                    ← builds (web embebido en el paquete npm)
```

`pnpm` + workspace opcional si `web` crece; empezar single-package.

---

## 8. Roadmap

### F0 — Scaffold
- [ ] `package.json` con dual entry + peers OpenTUI; tsconfig strict; Biome; vitest.
- [ ] Plugin mínimo cargable: `id: "ocswarm"`, `setup` log + toast desde `./tui`.
- [ ] Instalarlo local: `opencode.jsonc` global con `"plugins": [{ "package": "<ruta local>", ... }]`.

### F1 — SwarmHub (el corazón)
- [ ] `hub.apply(event)` para `session.created/updated/deleted`, `session.status`,
      `session.idle`, `message.part.updated`.
- [ ] Parseo de `task`/`agent` desde el título de child session.
- [ ] Tests con fixtures de eventos reales (capturar una sesión de verdad con `opencode api get /api/event` o logs).

### F2 — Servidor local
- [ ] Hono en 127.0.0.1, `GET /api/state`, `GET /api/stream` (SSE deltas), estáticos.
- [ ] Fallback de puerto + `GET /api/info` (para que el TUI descubra la URL).

### F3 — Dashboard MVP
- [ ] Snapshot + SSE; grafo padre→hijos; spawn animation; estados con colores;
      badge de herramienta actual; timer por agente.

### F4 — TUI
- [ ] Toast con URL; slot `home.footer.status`; `/swarm` → panel compacto;
      `o` abre navegador; `attention.notify` al terminar/fallar un subagente.

### F5 — Detalle y métricas
- [ ] Panel de detalle (mensajes, tool calls, diff de ficheros).
- [ ] Tokens + coste en vivo (reutilizar pricing de OpencodeBar).
- [ ] Gantt inferior; notificación diferenciada error/éxito.

### F6 — Release
- [ ] GIF del dashboard para el README (vhs/terminalizer sobre el panel + navegador).
- [ ] `npm publish` (files: dist, src; exports correctos).
- [ ] PR a `awesome-opencode`; entrada en el README del perfil junto a csizer/OpencodeBar.
- [ ] Tag v0.1.0.

---

## 9. Riesgos y decisiones abiertas

1. **Visibilidad de la URL en TUI**: el server plugin no debe depender de `console.log`
   (va a logs). La URL la muestra el cli plugin (toast/footer) — verificar cómo el cli
   plugin descubre el puerto del server plugin (candidato: `ctx.storage` compartido o
   `GET /api/info` barriendo puertos; decidir en F2/F4).
2. **Subagentes previos al arranque del plugin**: definir si el snapshot inicial se
   reconstruye desde el store o solo se ven sesiones nuevas. Empezar simple: nuevas.
3. **Runtime del server plugin**: confirmar si corre en Bun o Node para elegir
   `Bun.serve` vs Hono sobre fetch. Hono cubre ambos — default Hono.
4. **Sesiones remotas**: el cli plugin funciona contra servidores remotos; el server
   plugin corre donde corre el servidor. Documentar que el dashboard vive en la máquina
   del servidor (con `opencode serve` remoto, abrir el puerto por SSH tunnel).
5. **Seguridad**: bind 127.0.0.1, sin persistencia de código fuente en notificaciones.
6. **Nombre del paquete npm**: `ocswarm` (libre, verificado 2026-10-07).

## 10. Referencias

- Plugins: https://opencode.ai/v2/docs/build/plugins
- CLI/TUI plugins: https://opencode.ai/v2/docs/build/plugins/cli
- Cliente: https://opencode.ai/v2/docs/build/client
- API (OpenAPI): https://opencode.ai/v2/docs/api · https://opencode.ai/v2/openapi.json
- Eventos y children en la práctica: cmux issue #2479 (GET /session/:id/children, /event)
- Issue #14053: sesiones subagent tienen `parentID` (la Web UI oficial aún no las filtra bien — oportunidad)
