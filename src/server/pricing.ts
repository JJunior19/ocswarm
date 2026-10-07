/**
 * Pricing policy for live cost (F5.2): turns the runtime model catalog into
 * the hub's injected `pricing` lookup.
 *
 * Models.dev data quality varies by provider. Subscription resellers (e.g.
 * `zai-coding-plan`) publish all-zero cost entries for plan-included models,
 * while the same underlying model is priced for real under other providers
 * (e.g. `opencode-go/glm-5.3-flash`). The lookup therefore falls back from
 * the exact `providerID/modelID` to any non-zero rate published for the same
 * `modelID` — the LiteLLM/models.dev mapping applied to the model as it
 * appears in OpenCode. Pure module: no I/O, fully unit-tested.
 */

/** The rate values the hub needs, USD per million tokens. */
export interface PricingRate {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

/** Minimal runtime shape of a catalog model (typed superset tolerated). */
export interface PricingModel {
  id: string;
  modelID: string;
  providerID: string;
  cost: Array<{
    tier?: { type: string; size?: number };
    input: number;
    output: number;
    cache: { read: number; write: number };
  }>;
}

const isNonZero = (rate: PricingRate): boolean =>
  rate.input > 0 || rate.output > 0 || rate.cacheRead > 0 || rate.cacheWrite > 0;

/** Base tier = the untiered cost entry, falling back to the first tier. */
const baseCost = (model: PricingModel): PricingRate | undefined => {
  const cost = model.cost.find((entry) => entry.tier === undefined) ?? model.cost[0];
  if (!cost) return undefined;
  return {
    input: cost.input,
    output: cost.output,
    cacheRead: cost.cache.read,
    cacheWrite: cost.cache.write,
  };
};

export type PricingFn = (model: { providerID: string; modelID: string }) => PricingRate | undefined;

export function buildPricing(models: PricingModel[]): PricingFn {
  const exact = new Map<string, PricingRate>();
  /** First non-zero rate seen for a modelID across all providers. */
  const byModelID = new Map<string, PricingRate>();
  for (const model of models) {
    const rate = baseCost(model);
    if (!rate) continue;
    exact.set(`${model.providerID}/${model.modelID}`, rate);
    if (!byModelID.has(model.modelID) && isNonZero(rate)) byModelID.set(model.modelID, rate);
  }
  return ({ providerID, modelID }) => {
    const direct = exact.get(`${providerID}/${modelID}`);
    if (direct && isNonZero(direct)) return direct;
    // All-zero published pricing (plan providers) → map the underlying
    // model's real price onto it; no mapping available → undefined (never
    // fabricate).
    return byModelID.get(modelID);
  };
}
