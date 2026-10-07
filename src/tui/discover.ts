/**
 * Dashboard discovery — pure, injectable fetch.
 *
 * The server plugin binds 127.0.0.1 on 7777..7786 (see src/server/listen.ts).
 * The TUI plugin runs in a different process, so it probes `/api/info` on each
 * candidate port; the first response identifying itself as `ocswarm` wins.
 * Every per-port failure (refused, timeout, non-JSON) is swallowed and the
 * scan continues.
 */

export type DiscoverDeps = {
  fetch?: typeof fetch;
  /** Inclusive [min, max] port range to scan. */
  ports?: [number, number];
  host?: string;
  timeoutMs?: number;
};

const DEFAULT_PORTS: [number, number] = [7777, 7786];
const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_TIMEOUT_MS = 400;

export async function discoverDashboard(deps?: DiscoverDeps): Promise<string | undefined> {
  const doFetch = deps?.fetch ?? globalThis.fetch.bind(globalThis);
  const [min, max] = deps?.ports ?? DEFAULT_PORTS;
  const host = deps?.host ?? DEFAULT_HOST;
  const timeoutMs = deps?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  for (let port = min; port <= max; port++) {
    const url = `http://${host}:${port}`;
    try {
      const response = await doFetch(`${url}/api/info`, { signal: AbortSignal.timeout(timeoutMs) });
      const body = (await response.json()) as { name?: unknown };
      if (typeof body === "object" && body !== null && body.name === "ocswarm") return url;
    } catch {
      // Not our server (refused, timeout, non-JSON) — keep scanning.
    }
  }
  return undefined;
}
