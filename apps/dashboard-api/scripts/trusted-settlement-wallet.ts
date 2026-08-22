/**
 * The explicit seed-only proof bypass for disposable development fixtures.
 *
 * Production wallet verification recovers a merchant signature. The seed CLI
 * cannot produce that signature without holding the merchant's key, so its
 * opt-in trust flag records the operator's assertion instead. Keeping the
 * constructor here makes the exceptional record shape small and testable; the
 * normal dashboard flow continues through WalletService and WalletGuard.
 */

import type { ChainId } from "@mayarin/chain";
import { generateId } from "@mayarin/shared";
import type { MerchantWallet } from "@mayarin/wallet";

export interface TrustedSettlementWalletInput {
  readonly merchantId: string;
  readonly chain: ChainId;
  readonly address: string;
  readonly trustedAt: Date;
}

export function trustedSettlementWallet(input: TrustedSettlementWalletInput): MerchantWallet {
  return {
    id: generateId("wlt", input.trustedAt.getTime()),
    merchantId: input.merchantId,
    chain: input.chain,
    address: input.address.toLowerCase(),
    provenance: "linked",
    verifiedAt: input.trustedAt,
    createdAt: input.trustedAt,
    updatedAt: input.trustedAt,
  };
}
