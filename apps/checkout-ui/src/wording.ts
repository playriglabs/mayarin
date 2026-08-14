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
