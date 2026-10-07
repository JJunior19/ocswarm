import { describe, expect, it } from "vitest";
import { pickPort, startServer } from "./listen";

const fetch = () => new Response("ok");

describe("pickPort", () => {
  it("returns the ordered candidates start..start+attempts-1", () => {
    expect(pickPort(7777)).toEqual([
      7777, 7778, 7779, 7780, 7781, 7782, 7783, 7784, 7785, 7786, 7787,
    ]);
    expect(pickPort(100, 3)).toEqual([100, 101, 102]);
  });
});

describe("startServer", () => {
  it("falls back upward until a port binds, reporting the actual port", async () => {
    const tried: number[] = [];
    const serve = (options: { port: number }) => {
      tried.push(options.port);
      if (options.port < 7779) throw new Error("EADDRINUSE");
      return { port: options.port, stop: () => {} };
    };
    const server = await startServer({ fetch, port: 7777, serve });
    expect(tried).toEqual([7777, 7778, 7779]);
    expect(server.port).toBe(7779);
    expect(server.url).toBe("http://127.0.0.1:7779");
    server.stop();
  });

  it("rejects with a clear message after 11 attempts when nothing binds", async () => {
    let attempts = 0;
    const serve = () => {
      attempts += 1;
      throw new Error("EADDRINUSE");
    };
    await expect(startServer({ fetch, port: 7000, serve })).rejects.toThrow(/11 attempts/);
    expect(attempts).toBe(11);
  });

  it("defaults hostname to 127.0.0.1 and base port to 7777", async () => {
    let seen: { port: number; hostname: string } | undefined;
    const serve = (options: { port: number; hostname: string }) => {
      seen = options;
      return { port: options.port, stop: () => {} };
    };
    await startServer({ fetch, serve });
    expect(seen?.port).toBe(7777);
    expect(seen?.hostname).toBe("127.0.0.1");
  });

  it("uses the port reported by serve as the actually bound port", async () => {
    const serve = (options: { port: number }) => ({ port: options.port + 500, stop: () => {} });
    const server = await startServer({ fetch, port: 8000, serve });
    expect(server.port).toBe(8500);
    expect(server.url).toBe("http://127.0.0.1:8500");
  });
});
