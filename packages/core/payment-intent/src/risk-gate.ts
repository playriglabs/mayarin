/**
 * Fraud gate (FDS): asked once, when a payment is confirmed.
 *
 * A port, because the rules and the history behind them live outside this
 * package. `blocked` refuses the payment. A merely suspicious one is flagged by
 * the adapter and goes ahead: a rule that is still being calibrated must not
 * turn away a real buyer.
 */

import type { PaymentIntent } from "./types.ts";

export interface RiskGate {
  /** Assesses the intent and records what was found. `blocked` is the only verdict that stops it. */
  check(intent: PaymentIntent): Promise<{ readonly blocked: boolean }>;
}
