/**
 * Pure layout math for the edge flow particles (F5.3): N dots share one
 * animation cycle, staggered evenly so a pass leaves the parent every
 * `cycle / count` seconds. The component in `EdgeParticles.tsx` turns each
 * phase into framer-motion `delay` / `repeatDelay` values.
 */

export const PARTICLE_COUNT = 3;
export const PARTICLE_CYCLE = 2.4; // seconds between a particle's passes
export const PARTICLE_TRAVEL = 1.8; // seconds a particle spends in flight

export interface ParticlePhase {
  /** Seconds to wait before the particle's first pass. */
  delay: number;
  /** Seconds the particle rests at the child before repeating (cycle − travel). */
  repeatDelay: number;
}

/** Staggered phases for `count` particles sharing a `cycle`/`travel` rhythm. */
export function particlePhases(count: number, cycle: number, travel: number): ParticlePhase[] {
  const n = Math.max(1, Math.floor(count));
  const repeatDelay = Math.max(0, cycle - travel);
  return Array.from({ length: n }, (_, i) => ({ delay: (i * cycle) / n, repeatDelay }));
}
