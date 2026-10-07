/**
 * Port-fallback server bootstrap — pure, injectable, no runtime imports.
 *
 * Why lazy `globalThis.Bun`: the OpenCode plugin process runs as a compiled
 * Bun binary where `Bun.serve` exists, but vitest executes under node where
 * it does not. A static Bun import would break the whole test suite, so the
 * default serve implementation is resolved from the global at call time;
 * tests inject a fake instead.
 */

export type ServeFetch = (req: Request) => Response | Promise<Response>;

export interface ServeOptions {
  port: number;
  hostname: string;
  fetch: ServeFetch;
}

export interface ServeHandle {
  stop(): void;
  port: number;
}

export type ServeLike = (options: ServeOptions) => ServeHandle;

export interface StartServerOptions {
  fetch: ServeFetch;
  port?: number;
  hostname?: string;
  serve?: ServeLike;
}

export interface RunningServer {
  url: string;
  port: number;
  stop: () => void;
}

/** Ordered candidate ports: start..start+attempts-1. */
export function pickPort(start: number, attempts = 11): number[] {
  return Array.from({ length: attempts }, (_, index) => start + index);
}

/** Resolve `globalThis.Bun.serve` lazily — see the module docblock. */
function defaultServe(): ServeLike {
  const bun = (globalThis as { Bun?: { serve?: unknown } }).Bun;
  const serve = bun?.serve;
  if (typeof serve !== "function") {
    throw new Error(
      "ocswarm: cannot start the local server — globalThis.Bun.serve is unavailable " +
        "(the plugin runtime must be Bun, or inject a `serve` implementation)",
    );
  }
  return serve as ServeLike;
}

/**
 * Bind an HTTP server on the first free candidate port, always on localhost.
 * The serve implementation reports the port it ACTUALLY bound (Bun.serve does
 * too) — the returned `url`/`port` never assume it equals the candidate.
 */
export async function startServer(options: StartServerOptions): Promise<RunningServer> {
  const hostname = options.hostname ?? "127.0.0.1"; // always localhost
  const serve = options.serve ?? defaultServe();
  const candidates = pickPort(options.port ?? 7777);
  let lastError: unknown;
  for (const port of candidates) {
    try {
      const server = serve({ port, hostname, fetch: options.fetch });
      return {
        url: `http://${hostname}:${server.port}`,
        port: server.port,
        stop: () => server.stop(),
      };
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(
    `ocswarm: no free port for the local server after ${candidates.length} attempts ` +
      `(${candidates[0]}–${candidates[candidates.length - 1]})`,
    { cause: lastError },
  );
}
