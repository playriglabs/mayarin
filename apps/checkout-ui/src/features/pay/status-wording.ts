/**
 * Status in the payer's own terms.
 *
 * A payer does not know what PROCESSING means, and the machine's own names are
 * the wrong vocabulary for the one screen where somebody is deciding whether
 * their money arrived.
 */

export type Tone = "live" | "done" | "bad" | "";

export const TERMINAL_STATUSES: readonly string[] = ["COMPLETED", "FAILED", "EXPIRED"];

const WORDING: Readonly<Record<string, readonly [string, Tone]>> = {
  PENDING: ["waiting for payment", "live"],
  CONFIRMED: ["asset received", "live"],
  PROCESSING: ["processing", "live"],
  COMPLETED: ["payment completed", "done"],
  FAILED: ["payment failed", "bad"],
  EXPIRED: ["payment expired", "bad"],
};

export function statusWording(status: string): readonly [string, Tone] {
  return WORDING[status] ?? [status.toLowerCase(), ""];
}

export function isTerminal(status: string): boolean {
  return TERMINAL_STATUSES.includes(status);
}

/**
 * Clearing states in which the payer's asset has arrived and the engine is
 * working. The intent's own `CONFIRMED` status is not on this list on
 * purpose: an intent is confirmed the moment the payer presses Continue,
 * before any money moves. Only the clearing state knows about the money.
 */
const CONFIRMING_STATES: readonly string[] = ["ASSET_RECEIVED", "CLEARING", "SETTLING", "SETTLED"];

export type PaymentStage = "waiting" | "confirming";

export function paymentStage(clearingState: string): PaymentStage {
  return CONFIRMING_STATES.includes(clearingState) ? "confirming" : "waiting";
}
