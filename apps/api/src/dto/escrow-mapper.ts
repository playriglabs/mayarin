/**
 * Escrow DTO mappers. Kept out of the DTO barrel on purpose: they read the
 * database's dispute rows and the EVM provider's calldata, and the barrel is
 * what `@mayarin/sdk` bundles into its published declarations — it must reach
 * pure packages only.
 */

import { evmChainIdOf } from "@mayarin/chain";
import type { DisputeMessage } from "@mayarin/db";
import { escrowBondApproveCalldata } from "@mayarin/provider-evm";
import { numericReference } from "@mayarin/shared";
import type { EscrowView } from "../services/escrow.ts";
import type { Standing } from "../services/payer-standing.ts";
import type { DisputeMessageDto, EscrowDto } from "./escrow.ts";

export function toDisputeMessageDto(message: DisputeMessage): DisputeMessageDto {
  return {
    id: message.id,
    author: message.author,
    body: message.body,
    createdAt: message.createdAt.toISOString(),
  };
}

export function toEscrowDto(view: EscrowView, payerStanding: Standing): EscrowDto {
  return {
    chain: view.chain,
    /** For `wallet_switchEthereumChain` before sending a call. */
    chainId: evmChainIdOf(view.chain).toString(),
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
    /** The dispute bond (#315) in settlement-token minor units; `null` on a v1 escrow. */
    bond: view.terms.bond === undefined ? null : view.terms.bond.toString(),
    calls: {
      ...view.calls,
      /** Sent to `token` before `dispute` when the bond is not zero. */
      approveBond:
        view.terms.bond === undefined || view.terms.bond === 0n
          ? null
          : escrowBondApproveCalldata(view.terms),
    },
    /** Whether the payer's wallet may still take buyer protection (#314). Never the history. */
    payerStanding,
    dispute:
      view.dispute === undefined
        ? null
        : {
            id: view.dispute.record.id,
            /** The number a person quotes, e.g. 93129301239 (#313). */
            reference: numericReference(view.dispute.record.id),
            status: view.dispute.record.status,
            openedAt: view.dispute.record.createdAt.toISOString(),
            decidedAt: view.dispute.record.decidedAt?.toISOString() ?? null,
            messages: view.dispute.messages.map(toDisputeMessageDto),
          },
  };
}
