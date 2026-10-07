import { describe, expect, it } from "vitest";
import { discoverDashboard } from "./discover";

/** Fetch stub keyed by URL: known routes answer with JSON, unknown ones throw. */
function fakeFetch(routes: Record<string, unknown>, queried: string[] = []): typeof fetch {
  const fn = async (input: string): Promise<Response> => {
    queried.push(input);
    const body = routes[input];
    if (body === undefined) throw new Error(`no route for ${input}`);
    return new Response(JSON.stringify(body), {
      headers: { "content-type": "application/json" },
    });
  };
  return fn as unknown as typeof fetch;
}

describe("discoverDashboard", () => {
  it("finds the first port answering as ocswarm", async () => {
    const url = await discoverDashboard({
      fetch: fakeFetch({ "http://127.0.0.1:7778/api/info": { name: "ocswarm" } }),
      ports: [7777, 7786],
    });
    expect(url).toBe("http://127.0.0.1:7778");
  });

  it("skips servers whose JSON is not ocswarm", async () => {
    const url = await discoverDashboard({
      fetch: fakeFetch({
        "http://127.0.0.1:7777/api/info": { name: "something-else" },
        "http://127.0.0.1:7778/api/info": { name: "ocswarm" },
      }),
      ports: [7777, 7786],
    });
    expect(url).toBe("http://127.0.0.1:7778");
  });

  it("skips ports where fetch throws", async () => {
    const url = await discoverDashboard({
      fetch: fakeFetch({ "http://127.0.0.1:7779/api/info": { name: "ocswarm" } }),
      ports: [7777, 7786],
    });
    expect(url).toBe("http://127.0.0.1:7779");
  });

  it("returns undefined when every port fails", async () => {
    const url = await discoverDashboard({ fetch: fakeFetch({}), ports: [7777, 7779] });
    expect(url).toBeUndefined();
  });

  it("only queries /api/info on ports inside the range", async () => {
    const queried: string[] = [];
    await discoverDashboard({
      fetch: fakeFetch({}, queried),
      ports: [7780, 7782],
    });
    expect(queried).toEqual([
      "http://127.0.0.1:7780/api/info",
      "http://127.0.0.1:7781/api/info",
      "http://127.0.0.1:7782/api/info",
    ]);
  });
});
