/**
 * Capture SSE events from a running OpenCode service into an NDJSON fixture file.
 *
 * Usage:
 *   bun scripts/capture-events.ts [output-file]
 *
 * Output defaults to .captures/events.ndjson. Stop with Ctrl-C: the file is
 * flushed, a summary is printed to stderr, and the process exits 0.
 * Set OCSWARM_CAPTURE_VERBOSE=1 to log each event's type to stderr as it arrives.
 */

import type { FileHandle } from "node:fs/promises";
import { mkdir, open } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { discover, headers } from "@opencode/client/service";

const outPath = resolve(process.argv[2] ?? ".captures/events.ndjson");
const verbose = process.env.OCSWARM_CAPTURE_VERBOSE === "1";

const endpoint = await discover();
if (!endpoint) {
  console.error("No running OpenCode service found");
  process.exit(1);
}

const requestHeaders: Record<string, string> = {
  accept: "text/event-stream",
  ...(endpoint.auth ? headers(endpoint) : {}),
};

const stop = new AbortController();
let captured = 0;

process.on("SIGINT", () => {
  stop.abort();
});

/** Close the capture file and report how many events landed in it. */
async function finalize(file: FileHandle | undefined) {
  if (file) {
    await file.close();
  }
  console.error(`captured ${captured} events -> ${outPath}`);
  process.exit(0);
}

let response: Response;
try {
  response = await fetch(`${endpoint.url}/api/event`, {
    headers: requestHeaders,
    signal: stop.signal,
  });
} catch (error) {
  if (stop.signal.aborted) await finalize(undefined);
  console.error(`Failed to connect to ${endpoint.url}/api/event: ${String(error)}`);
  process.exit(1);
}
if (!response.ok || !response.body) {
  console.error(`Failed to open event stream: HTTP ${response.status}`);
  process.exit(1);
}

await mkdir(dirname(outPath), { recursive: true });
const file = await open(outPath, "a");

/** Return the joined `data:` payload of one SSE frame, or null when it has none. */
function dataPayload(frame: string): string | null {
  const dataLines = frame.split("\n").filter((line) => line.startsWith("data:"));
  if (dataLines.length === 0) return null;
  // SSE strips one leading space after the field name.
  return dataLines.map((line) => line.slice("data:".length).replace(/^ /, "")).join("\n");
}

/** Parse one SSE frame and append the event to the output file as a single JSON line. */
async function consumeFrame(frame: string, file: FileHandle) {
  const payload = dataPayload(frame);
  if (payload === null) return;
  let event: { type?: string };
  try {
    event = JSON.parse(payload);
  } catch {
    console.error(`skipping malformed SSE frame: ${payload.slice(0, 120)}`);
    return;
  }
  await file.write(`${JSON.stringify(event)}\n`);
  captured += 1;
  if (verbose) console.error(event.type);
}

const reader = response.body.getReader();
const decoder = new TextDecoder();
let buffer = "";

try {
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    while (true) {
      const boundary = buffer.indexOf("\n\n");
      if (boundary === -1) break;
      const frame = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      await consumeFrame(frame, file);
    }
  }
  // Stream ended cleanly; decode any tail and treat it as a best-effort final frame.
  buffer += decoder.decode();
  if (buffer.trim().length > 0) await consumeFrame(buffer, file);
} catch (error) {
  await file.close();
  if (!stop.signal.aborted) throw error;
}

await finalize(file);
