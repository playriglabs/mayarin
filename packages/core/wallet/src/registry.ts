/**
 * Whether an address may be paid (#11, RFC #6).
 *
 * The order signer asks this before it signs. Today it asks nothing: it reads
 * `merchants.settlement_address` and signs a payment to whatever is there.
 * Since #95 that field is writable through an authenticated API, so an account
 * with `settings:manage` can name any address on the internet and have Mayarin
 * sign an order paying a customer's money into it.
 *
 * Two rules close that, and both are refusals rather than checks that log:
 *
 * 1. A `merchantSafe` must be a wallet this system holds, belonging to the
 *    merchant being paid, and verified.
 * 2. `feeRecipient` must never be a merchant wallet. Fees go to a treasury the
 *    deployment owns; a fee recipient that is also a payout destination is a
 *    misconfiguration that pays a merchant twice and is invisible in the ledger.
 */

import type { ChainId } from "@mayarin/chain";
import { ValidationError } from "@mayarin/shared";
import { isVerified, type MerchantWalletRepository } from "./types.ts";

export interface WalletGuardOptions {
  readonly wallets: MerchantWalletRepository;
  /**
   * Addresses fees are paid to. Lowercased on the way in, because an address
   * that differs only in case is the same address and must not slip past.
   */
  readonly treasuryAddresses: readonly string[];
}

export class WalletGuard {
  readonly #wallets: MerchantWalletRepository;
  readonly #treasury: ReadonlySet<string>;

  constructor(options: WalletGuardOptions) {
    this.#wallets = options.wallets;
    this.#treasury = new Set(options.treasuryAddresses.map((address) => address.toLowerCase()));
  }

  /**
   * Refuses to let an order be signed unless the payout destination is a
   * verified wallet belonging to this merchant.
   *
   * Throws rather than returning false: every caller of this would have to turn
   * a false into a throw anyway, and one that forgot would sign the order.
   */
  async assertPayable(merchantId: string, chain: ChainId, address: string): Promise<void> {
    const normalised = address.toLowerCase();

    if (this.#treasury.has(normalised)) {
      throw new ValidationError("A merchant cannot be paid into a treasury address", {
        merchantId,
        address: normalised,
      });
    }

    const wallet = await this.#wallets.findByAddress(chain, normalised);
    if (wallet === null) {
      throw new ValidationError(
        "The settlement address is not a wallet this deployment knows; link and verify it before taking a contract-path payment",
        { merchantId, chain, address: normalised },
      );
    }
    if (wallet.merchantId !== merchantId) {
      // Deliberately the same message as the unknown case: telling a caller
      // "that address belongs to someone else" confirms another merchant's
      // payout address to whoever guessed it.
      throw new ValidationError(
        "The settlement address is not a wallet this deployment knows; link and verify it before taking a contract-path payment",
        { merchantId, chain, address: normalised },
      );
    }
    if (!isVerified(wallet)) {
      throw new ValidationError(
        "The settlement address has not been verified; a claimed address is not a basis for signing a payment to it",
        { merchantId, chain, address: normalised },
      );
    }
  }

  /** True when the address is one of the deployment's fee destinations. */
  isTreasury(address: string): boolean {
    return this.#treasury.has(address.toLowerCase());
  }
}
