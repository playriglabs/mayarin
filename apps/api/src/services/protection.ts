/**
 * Buyer protection as a checkout page states it (#304).
 *
 * Everything a buyer agrees to by connecting a wallet — the hold, who decides a
 * dispute, how long they have, and that an undecided one refunds them — is
 * stated before they pay, from the same values the planner signs with.
 */

import type { EscrowRequest } from "@mayarin/payment-intent";
import { ESCROW_ARBITRATION_SECONDS, ESCROW_CHAINS, ESCROW_V2_CHAINS } from "@mayarin/provider-evm";
import type { Container } from "../container.ts";

export interface ProtectionOffer {
  readonly holdSeconds: number;
  readonly arbitrationSeconds: number;
  readonly arbiterLabel: string;
  readonly chains: readonly string[];
  /** The merchant asked for escrow on this payment: the wallet is not optional. */
  readonly required: boolean;
  /** The dispute bond in basis points of the payment (#315); 0 is free. */
  readonly bondBps: number;
  /** Where the bond applies — chains with `EscrowFactoryV2`. Elsewhere disputing is free. */
  readonly bondChains: readonly string[];
}

/**
 * The escrow this payment carries, or else the merchant's buyer protection.
 * `null` when neither exists.
 */
export async function protectionOffer(
  container: Container,
  merchantId: string,
  escrow: EscrowRequest | undefined,
): Promise<ProtectionOffer | null> {
  const terms = escrow ?? (await container.merchantPolicies.policyFor(merchantId))?.buyerProtection;
  if (terms === undefined) return null;
  return {
    holdSeconds: terms.holdSeconds,
    arbitrationSeconds: ESCROW_ARBITRATION_SECONDS,
    arbiterLabel: arbiterLabel(terms.arbiter, container.config.escrowArbiter),
    chains: ESCROW_CHAINS,
    required: escrow !== undefined,
    bondBps: terms.bondBps ?? 0,
    bondChains: ESCROW_V2_CHAINS,
  };
}

function arbiterLabel(merchantArbiter: string | undefined, resolution: string | undefined): string {
  if (merchantArbiter !== undefined) {
    return `the merchant's arbiter ${merchantArbiter.slice(0, 6)}…${merchantArbiter.slice(-4)}`;
  }
  return resolution === undefined ? "no one" : "Mayarin Resolution";
}
