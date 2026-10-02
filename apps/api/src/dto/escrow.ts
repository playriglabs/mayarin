/**
 * Wire shape of a payment's escrow (#304). Bigints travel as decimal strings.
 */

import { EVM_CHAIN_IDS } from "@mayarin/chain";
import type { DisputeMessage } from "@mayarin/db";
import { z } from "zod";
import type { EscrowView } from "../services/escrow.ts";

/** A payer's message in their dispute, signed by the wallet they paid with (#313). */
export const disputeMessageBodySchema = z.object({
  body: z.string(),
  signedAt: z.string(),
  signature: z.string().regex(/^0x[0-9a-fA-F]+$/, "signature must be hex"),
});

export function toDisputeMessageDto(message: DisputeMessage) {
  return {
    id: message.id,
    author: message.author,
    body: message.body,
    createdAt: message.createdAt.toISOString(),
  };
}

export function toEscrowDto(view: EscrowView) {
  return {
    chain: view.chain,
    /** For `wallet_switchEthereumChain` before sending a call. */
    chainId: EVM_CHAIN_IDS[view.chain].toString(),
    factory: view.factory,
    address: view.address,
    token: view.token,
    terms: {
      intentId: view.terms.intentId,
      payer: view.terms.payer,
      payee: view.terms.payee,
      arbiter: view.terms.arbiter,
      releaseAfter: new Date(Number(view.terms.releaseAfter) * 1_000).toISOString(),
      /** A dispute still open at this time refunds the payer. */
      resolveBy: new Date(Number(view.terms.resolveBy) * 1_000).toISOString(),
    },
    outcome: view.state.outcome,
    disputed: view.state.disputed,
    balance: view.state.balance.toString(),
    calls: view.calls,
    dispute:
      view.dispute === undefined
        ? null
        : {
            id: view.dispute.record.id,
            status: view.dispute.record.status,
            openedAt: view.dispute.record.createdAt.toISOString(),
            decidedAt: view.dispute.record.decidedAt?.toISOString() ?? null,
            messages: view.dispute.messages.map(toDisputeMessageDto),
          },
  };
}

export type EscrowDto = ReturnType<typeof toEscrowDto>;
