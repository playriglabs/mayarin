/**
 * Wire shapes for escrow disputes (#313).
 */

import type { DisputeMessage, EscrowDispute } from "@mayarin/db";
import { z } from "zod";
import type { DisputeCase } from "../services/disputes.ts";

export const disputeMessageBodySchema = z.object({ body: z.string() });

export function toDisputeMessageDto(message: DisputeMessage) {
  return {
    id: message.id,
    author: message.author,
    body: message.body,
    createdAt: message.createdAt.toISOString(),
  };
}

export function toDisputeDto(dispute: EscrowDispute) {
  return {
    id: dispute.id,
    paymentIntentId: dispute.paymentIntentId,
    merchantId: dispute.merchantId,
    chain: dispute.chain,
    payer: dispute.payer,
    payee: dispute.payee,
    status: dispute.status,
    releaseAfter: dispute.releaseAfter.toISOString(),
    resolveBy: dispute.resolveBy.toISOString(),
    openedAt: dispute.createdAt.toISOString(),
    decidedAt: dispute.decidedAt?.toISOString() ?? null,
  };
}

export function toDisputeCaseDto(found: DisputeCase) {
  return {
    dispute: toDisputeDto(found.dispute),
    messages: found.messages.map(toDisputeMessageDto),
    escrow: found.escrow,
  };
}
