import { useEffect, useState } from "react";

/**
 * 1Hz clock shared by every live view: graph elapsed timers, the gantt's
 * running bars and the detail panel's elapsed readout each call this hook,
 * so App does not have to lift the tick state through props.
 */
export function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return now;
}
