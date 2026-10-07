/**
 * Open a URL in the system browser — detached, fire-and-forget.
 *
 * Why lazy `globalThis.Bun`: the TUI plugin runtime is a Bun binary where
 * `Bun.spawn` exists, but vitest executes under node where it does not. When
 * no spawner is available we no-op with a hint instead of failing the UI.
 */

export function openInBrowser(url: string): void {
  const spawn = (globalThis as { Bun?: { spawn?: (cmd: string[], options?: object) => unknown } })
    .Bun?.spawn;
  if (typeof spawn !== "function") {
    console.log(`ocswarm: open ${url} in your browser`);
    return;
  }
  const launcher =
    (globalThis as { process?: { platform?: string } }).process?.platform === "darwin"
      ? "open"
      : "xdg-open";
  try {
    spawn([launcher, url], { stdout: "ignore", stderr: "ignore", stdin: "ignore" });
  } catch {
    console.log(`ocswarm: failed to open ${url}`);
  }
}

/**
 * Deep link to one session's diagram (F5.1): `<url>/?session=<sessionID>`.
 * Strips a trailing slash first so the path never doubles up.
 */
export function withSession(url: string, sessionID: string): string {
  return `${url.replace(/\/+$/, "")}/?session=${sessionID}`;
}
