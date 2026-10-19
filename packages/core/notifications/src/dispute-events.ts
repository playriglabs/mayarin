/**
 * The webhook events of an escrow dispute (#313): it opens, someone writes in it,
 * the chain decides it.
 *
 * Typed against the facts they read, not the database row, so the payment API and
 * the dashboard API, which both write to a dispute, build the same event from the
 * same code. Ids are the receiver's idempotency key: the dispute's for the
 * opening, the message's for a message, `<dispute>:resolved` for the outcome.
 */

import { numericReference } from "@mayarin/shared";
import type { MerchantEvent } from "./merchant-event.ts";

export interface DisputeFacts {
  readonly id: string;
  readonly paymentIntentId: string;
  readonly chain: string;
  readonly payer: string;
  readonly resolveBy: Date;
  readonly status: string;
  readonly decidedAt: Date | undefined;
  readonly createdAt: Date;
}

export interface DisputeMessageFacts {
  readonly id: string;
  readonly author: string;
  readonly body: string;
  readonly createdAt: Date;
}

/** `escrow.disputed`: a buyer opened a dispute. */
export function disputeOpenedEvent(dispute: DisputeFacts): MerchantEvent {
  return {
    id: dispute.id,
    type: "escrow.disputed",
    occurredAt: dispute.createdAt,
    data: {
      disputeId: dispute.id,
      reference: numericReference(dispute.id),
      paymentIntentId: dispute.paymentIntentId,
      chain: dispute.chain,
      payer: dispute.payer,
      resolveBy: dispute.resolveBy.toISOString(),
    },
  };
}

/**
 * `escrow.dispute.message`: someone wrote in the thread. The text is the
 * merchant's own dispute thread, so it travels with the event: a receiver can
 * answer, or refund, without a second call.
 */
export function disputeMessageEvent(
  dispute: DisputeFacts,
  message: DisputeMessageFacts,
): MerchantEvent {
  return {
    id: message.id,
    type: "escrow.dispute.message",
    occurredAt: message.createdAt,
    data: {
      disputeId: dispute.id,
      reference: numericReference(dispute.id),
      paymentIntentId: dispute.paymentIntentId,
      messageId: message.id,
      author: message.author,
      body: message.body,
    },
  };
}

/** `escrow.dispute.resolved`: the chain decided it. One per dispute. */
export function disputeResolvedEvent(dispute: DisputeFacts): MerchantEvent {
  const decidedAt = dispute.decidedAt ?? dispute.createdAt;
  return {
    id: `${dispute.id}:resolved`,
    type: "escrow.dispute.resolved",
    occurredAt: decidedAt,
    data: {
      disputeId: dispute.id,
      reference: numericReference(dispute.id),
      paymentIntentId: dispute.paymentIntentId,
      outcome: dispute.status,
      decidedAt: decidedAt.toISOString(),
    },
  };
}
