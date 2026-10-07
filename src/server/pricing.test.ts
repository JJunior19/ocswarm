import { describe, expect, it } from "vitest";
import { buildPricing, type PricingModel } from "./pricing";

const cost = (input: number, output: number, read = 0, write = 0): PricingModel["cost"] => [
  { input, output, cache: { read, write } },
];

const model = (providerID: string, modelID: string, c: PricingModel["cost"]): PricingModel => ({
  id: modelID,
  modelID,
  providerID,
  cost: c,
});

describe("buildPricing", () => {
  it("uses the exact provider/model rate when it is non-zero", () => {
    const pricing = buildPricing([
      model("opencode-go", "glm-5.3-flash", cost(0.15, 0.5, 0.03)),
      model("zai-coding-plan", "other", cost(1, 2)),
    ]);
    expect(pricing({ providerID: "opencode-go", modelID: "glm-5.3-flash" })).toEqual({
      input: 0.15,
      output: 0.5,
      cacheRead: 0.03,
      cacheWrite: 0,
    });
  });

  it("maps a real price onto all-zero plan providers via the same modelID", () => {
    const pricing = buildPricing([
      // The plan publishes zeros for plan-included models.
      model("zai-coding-plan", "glm-5.3-flash", cost(0, 0, 0)),
      // The underlying model is priced for real under another provider.
      model("opencode-go", "glm-5.3-flash", cost(0.15, 0.5, 0.03, 0)),
    ]);
    expect(pricing({ providerID: "zai-coding-plan", modelID: "glm-5.3-flash" })).toEqual({
      input: 0.15,
      output: 0.5,
      cacheRead: 0.03,
      cacheWrite: 0,
    });
  });

  it("keeps the first non-zero rate for a modelID and skips later duplicates", () => {
    const pricing = buildPricing([
      model("a", "m", cost(1, 2)),
      model("b", "m", cost(9, 9)),
      model("plan", "m", cost(0, 0)),
    ]);
    expect(pricing({ providerID: "plan", modelID: "m" })).toEqual({
      input: 1,
      output: 2,
      cacheRead: 0,
      cacheWrite: 0,
    });
  });

  it("returns undefined when no provider publishes a non-zero rate", () => {
    const pricing = buildPricing([model("plan", "m", cost(0, 0))]);
    expect(pricing({ providerID: "plan", modelID: "m" })).toBeUndefined();
    expect(pricing({ providerID: "unknown", modelID: "m" })).toBeUndefined();
  });

  it("prefers the untiered cost entry over context tiers", () => {
    const pricing = buildPricing([
      {
        ...model("p", "m", []),
        cost: [
          { input: 1, output: 1, cache: { read: 0, write: 0 } },
          {
            tier: { type: "context", size: 200000 },
            input: 5,
            output: 5,
            cache: { read: 0, write: 0 },
          },
        ],
      },
    ]);
    expect(pricing({ providerID: "p", modelID: "m" })).toEqual({
      input: 1,
      output: 1,
      cacheRead: 0,
      cacheWrite: 0,
    });
  });
});
