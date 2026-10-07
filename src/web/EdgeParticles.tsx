import { motion, useReducedMotion } from "framer-motion";
import { PARTICLE_COUNT, PARTICLE_CYCLE, PARTICLE_TRAVEL, particlePhases } from "./particles";

/** Logical graph coordinates (shared with GraphView). */
export interface Pos {
  x: number;
  y: number;
}

const PARTICLE_RADIUS = 2.5;
const PARTICLE_OPACITY = 0.6;

/**
 * 2-3 small dots flowing parent→child along a straight edge (F5.3, plan.md
 * §6). Rendered only while the child agent is running and not archived.
 *
 * Each dot is a self-animating motion.g (keyframed translate + opacity):
 * framer-motion drives it from its own rAF loop, so the graph re-renders
 * only when an edge starts/stops flowing, never per frame. Dots alternate
 * the palette green/blue and are staggered by `particlePhases`.
 */
export function EdgeParticles({ from, to }: { from: Pos; to: Pos }) {
  const reducedMotion = useReducedMotion() ?? false;
  if (reducedMotion) return null;

  const phases = particlePhases(PARTICLE_COUNT, PARTICLE_CYCLE, PARTICLE_TRAVEL);
  return (
    <g>
      {phases.map((phase, i) => (
        <motion.g
          key={phase.delay}
          initial={{ x: from.x, y: from.y, opacity: 0 }}
          animate={{
            x: [from.x, to.x],
            y: [from.y, to.y],
            opacity: [0, PARTICLE_OPACITY, PARTICLE_OPACITY, 0],
          }}
          transition={{
            // Position: linear flight parent→child, then rest until the cycle ends.
            duration: PARTICLE_TRAVEL,
            ease: "linear",
            repeat: Infinity,
            delay: phase.delay,
            repeatDelay: phase.repeatDelay,
            // Opacity rides the same flight window, fading in/out at the ends.
            opacity: {
              duration: PARTICLE_TRAVEL,
              ease: "linear",
              repeat: Infinity,
              delay: phase.delay,
              repeatDelay: phase.repeatDelay,
              times: [0, 0.12, 0.8, 1],
            },
          }}
        >
          <circle r={PARTICLE_RADIUS} fill={i % 2 === 0 ? "var(--green)" : "var(--blue)"} />
        </motion.g>
      ))}
    </g>
  );
}
