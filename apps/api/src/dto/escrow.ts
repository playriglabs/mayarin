/**
 * Wire shape of a payment's escrow (#304). Bigints travel as decimal strings.
 */

import { EVM_CHAIN_IDS } from "@mayarin/chain";
import type { EscrowView } from "../services/escrow.ts";

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
    },
    outcome: view.state.outcome,
    disputed: view.state.disputed,
    balance: view.state.balance.toString(),
    calls: view.calls,
  };
}

export type EscrowDto = ReturnType<typeof toEscrowDto>;
