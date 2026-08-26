import { useEffect, useState } from "react";
import { type Remaining, remainingAt } from "./countdown.ts";

/**
 * The ticking clock.
 *
 * Stops once the payment is decided: the deadline is the payer's, and once
 * there is nothing left to be in time for, a running clock misleads.
 */
export function useCountdown(expiresAt: string, running: boolean): Remaining {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!running) return;
    const clock = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(clock);
  }, [running]);

  return remainingAt(expiresAt, now);
}
