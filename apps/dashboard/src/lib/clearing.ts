/**
 * Presentation metadata for the clearing state machine.
 *
 * The nine happy-path states plus `FAILED`, mirrored from
 * `@mayarin/clearing`'s `CLEARING_STATES`. Kept as a local literal rather than
 * imported: the dashboard reads states off the wire as plain strings, and a
 * dependency on the clearing package would pull domain code into the browser
 * bundle for what is only a lookup table of labels.
 *
 * `FAILED` is deliberately outside `HAPPY_PATH` — it is reachable from any
 * non-terminal state, so it is not a step on the line and must never be drawn
 * as one.
 */

export const HAPPY_PATH = [
  "CREATED",
  "QR_PARSED",
  "PRICE_LOCKED",
  "PAYMENT_PENDING",
  "ASSET_RECEIVED",
  "CLEARING",
  "SETTLING",
  "SETTLED",
  "SUCCESS",
] as const;

export type HappyState = (typeof HAPPY_PATH)[number];
export type ClearingState = HappyState | "FAILED";

/** What each state means to a merchant, who does not read the state machine. */
export const STATE_COPY: Readonly<Record<ClearingState, { label: string; detail: string }>> = {
  CREATED: { label: "Created", detail: "The intent exists and is waiting to be priced." },
  QR_PARSED: { label: "QR parsed", detail: "The payment code resolved to this merchant." },
  PRICE_LOCKED: { label: "Price locked", detail: "A rate is frozen. It cannot drift from here." },
  PAYMENT_PENDING: { label: "Awaiting payment", detail: "Waiting for the payer to send funds." },
  ASSET_RECEIVED: { label: "Asset received", detail: "The payer's asset arrived on chain." },
  CLEARING: { label: "Clearing", detail: "Converting the payer's asset to your settlement asset." },
  SETTLING: { label: "Settling", detail: "The settlement is on its way to your address." },
  SETTLED: { label: "Settled", detail: "Funds reached your settlement address." },
  SUCCESS: { label: "Complete", detail: "The payment is finished and posted to the ledger." },
  FAILED: { label: "Failed", detail: "The payment stopped and no value moved." },
} as const;

/** Index of a state on the happy path, or `-1` for `FAILED`. */
export function stepIndex(state: string): number {
  return HAPPY_PATH.indexOf(state as HappyState);
}

export function isFailed(state: string): boolean {
  return state === "FAILED";
}

export function labelOf(state: string): string {
  return STATE_COPY[state as ClearingState]?.label ?? state;
}

/**
 * A payment intent has its own, shorter status vocabulary than the clearing
 * transaction it drives. The two overlap on `FAILED` only, so they get separate
 * maps rather than one lookup that silently returns a raw enum name.
 */
const INTENT_STATUS_LABELS: Readonly<Record<string, string>> = {
  CREATED: "Created",
  CONFIRMED: "Confirmed",
  PROCESSING: "Processing",
  COMPLETED: "Completed",
  FAILED: "Failed",
  EXPIRED: "Expired",
} as const;

export function intentStatusLabel(status: string): string {
  return INTENT_STATUS_LABELS[status] ?? status;
}

/** Badge variant for a clearing state or a payment-intent status. */
export type StateVariant = "default" | "success" | "destructive" | "warning";

export function toneOf(state: string): StateVariant {
  if (state === "FAILED") return "destructive";
  if (state === "SUCCESS" || state === "SETTLED" || state === "COMPLETED") return "success";
  if (state === "CREATED" || state === "QR_PARSED" || state === "EXPIRED") return "default";
  return "warning";
}
