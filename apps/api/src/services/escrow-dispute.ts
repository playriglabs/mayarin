/**
 * Escrow disputes (#313), the backend half: the port the keeper and the escrow
 * view write through, and the `resolveBy` warning.
 *
 * The chain is the only authority on an escrow. These records follow it — a
 * dispute opens when the chain shows `disputed`, and closes when the chain
 * shows the funds moved — so nothing here can move money or contradict it.
 */

import type { ContractOrder } from "@mayarin/clearing";
import type {
  DisputeAlert,
  DisputeAuthor,
  DisputeMessage,
  EscrowDispute,
  OpenDispute,
} from "@mayarin/db";

export interface EscrowDisputeLog {
  /** `opened` is true only for the call that created the case file. */
  open(input: OpenDispute, now: Date): Promise<{ dispute: EscrowDispute; opened: boolean }>;
  findByPaymentIntentId(paymentIntentId: string): Promise<EscrowDispute | undefined>;
  findById(id: string): Promise<EscrowDispute | undefined>;
  /** One merchant's disputes, newest first. */
  listByMerchant(merchantId: string, limit?: number): Promise<readonly EscrowDispute[]>;
  /** The dispute this call closed; `undefined` when there was none open to close. */
  close(
    paymentIntentId: string,
    status: "released" | "refunded" | "split",
    now: Date,
  ): Promise<EscrowDispute | undefined>;
  listOpen(): Promise<readonly EscrowDispute[]>;
  markAlerted(id: string, alert: DisputeAlert): Promise<void>;
  listMessages(disputeId: string): Promise<readonly DisputeMessage[]>;
  addMessage(
    disputeId: string,
    author: DisputeAuthor,
    body: string,
    now: Date,
  ): Promise<DisputeMessage>;
}

/** The case file's parties and deadlines, read off the signed order's escrow terms. */
export function disputeOf(
  order: ContractOrder,
  ids: { readonly paymentIntentId: string; readonly merchantId: string; readonly chain: string },
): OpenDispute {
  const escrow = order.escrow;
  if (escrow === undefined) throw new Error("Order carries no escrow");
  return {
    ...ids,
    factory: escrow.factory,
    payer: escrow.payer,
    payee: escrow.payee,
    arbiter: escrow.arbiter,
    releaseAfter: new Date(Number(escrow.releaseAfter) * 1_000),
    resolveBy: new Date(Number(escrow.resolveBy) * 1_000),
  };
}

const HOUR_MS = 3_600_000;

/**
 * The warning a dispute is due, if any: `48h` once two days remain, `24h` once
 * one does. Each is sent once; a dispute found late gets only the latest.
 */
export function alertDue(dispute: EscrowDispute, now: Date): DisputeAlert | undefined {
  const left = dispute.resolveBy.getTime() - now.getTime();
  if (left <= 24 * HOUR_MS) return dispute.alerted === "24h" ? undefined : "24h";
  if (left <= 48 * HOUR_MS) return dispute.alerted === undefined ? "48h" : undefined;
  return undefined;
}

export type DisputeAlertSink = (text: string) => Promise<void>;

/**
 * Tells the merchant what happens in a dispute over one of their payments (#313):
 * it opens, someone writes in it, the chain decides it. None throws; a failed
 * notice is logged and the dispute stands either way.
 */
export interface DisputeNotifier {
  opened(dispute: EscrowDispute): Promise<void>;
  message(dispute: EscrowDispute, message: DisputeMessage): Promise<void>;
  resolved(dispute: EscrowDispute): Promise<void>;
}

/**
 * Logs the warning, and posts it as `{ text }` when a webhook is configured.
 * A failed post throws, so the keeper leaves the warning unmarked and sends it
 * again on its next pass.
 */
export function disputeAlertSink(webhookUrl: string | undefined): DisputeAlertSink {
  return async (text) => {
    console.warn(`[escrow-disputes] ${text}`);
    if (webhookUrl === undefined) return;
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (!response.ok) throw new Error(`Alert webhook answered ${response.status}`);
  };
}
