import { describe, expect, it } from "vitest";
import { PARTICLE_COUNT, PARTICLE_CYCLE, PARTICLE_TRAVEL, particlePhases } from "./particles";

describe("particlePhases", () => {
  it("staggers starts evenly across the cycle", () => {
    const phases = particlePhases(PARTICLE_COUNT, PARTICLE_CYCLE, PARTICLE_TRAVEL);
    expect(phases).toHaveLength(3);
    expect(phases[0].delay).toBe(0);
    expect(phases[1].delay).toBeCloseTo(PARTICLE_CYCLE / 3);
    expect(phases[2].delay).toBeCloseTo((2 * PARTICLE_CYCLE) / 3);
  });

  it("keeps every particle's pass period equal to the cycle", () => {
    const travel = 2;
    for (const phase of particlePhases(4, 3, travel)) {
      expect(phase.delay + travel + phase.repeatDelay).toBeCloseTo(3 + phase.delay);
    }
  });

  it("clamps degenerate inputs", () => {
    expect(particlePhases(0, 2.4, 1.8)).toHaveLength(1);
    expect(particlePhases(-5, 2.4, 1.8)).toHaveLength(1);
    // Travel longer than the cycle: particles simply fly back-to-back.
    const overrun = particlePhases(2, 1, 3);
    expect(overrun.every((phase) => phase.repeatDelay === 0)).toBe(true);
  });
});
