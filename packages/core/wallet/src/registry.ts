/**
 * Whether an address may be paid (#11, RFC #6).
 *
 * The order signer asks this before it signs. A destination can come from two
 * authorities: the merchant's scoped, audited settings choice, or Mayarin's
 * managed-wallet fallback when the merchant made no choice. Treating both as
 * registry claims blocks legitimate external settlement; trusting both as
 * configuration lets a stale or foreign managed wallet through.
 *
 * Two rules protect the signed destination, and both are refusals rather than
 * checks that merely log:
 *
 * 1. A managed fallback must be a wallet this system holds, belonging to the
 *    merchant being paid, and verified. An explicitly configured external
 *    address is instead authorised by the scoped settings write and its audit
 *    trail.
 * 2. `feeRecipient` must never be a merchant wallet. Fees go to a treasury the
 *    deployment owns; a fee recipient that is also a payout destination is a
 *    misconfiguration that pays a merchant twice and is invisible in the ledger.
 */

import type { ChainId } from "@mayarin/chain";
import { ConfigurationError, ValidationError } from "@mayarin/shared";
import type { SettlementDestination } from "./settlement-address.ts";
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
   * Refuses an unsafe payout destination immediately before signing.
   *
   * A configured destination is the merchant's authenticated payout choice, so
   * it need not be registered as a wallet. A managed fallback is Mayarin's
   * choice on the merchant's behalf and must remain verified in the registry.
   *
   * Throws rather than returning false: every caller of this would have to turn
   * a false into a throw anyway, and one that forgot would sign the order.
   */
  async assertPayable(
    merchantId: string,
    chain: ChainId,
    destination: SettlementDestination,
  ): Promise<void> {
    const normalised = destination.address.toLowerCase();

    if (this.#treasury.has(normalised)) {
      throw new ValidationError("A merchant cannot be paid into a treasury address", {
        merchantId,
        address: normalised,
      });
    }

    if (destination.source === "configured") return;

    const wallet = await this.#wallets.findByAddress(chain, normalised);
    if (wallet === null) {
      throw new ValidationError(
        "The managed settlement wallet is missing; provision and verify it before taking a contract-path payment",
        { merchantId, chain, address: normalised },
      );
    }
    if (wallet.merchantId !== merchantId) {
      // Deliberately the same message as the unknown case: telling a caller
      // "that address belongs to someone else" confirms another merchant's
      // payout address to whoever guessed it.
      throw new ValidationError(
        "The managed settlement wallet is missing; provision and verify it before taking a contract-path payment",
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

  /**
   * Fails when a fee destination is also somebody's payout wallet.
   *
   * `assertPayable` closes one direction — a merchant cannot be paid into a
   * treasury address. This closes the other: a treasury address configured
   * *after* a merchant already holds it. The two directions are the same
   * mistake, and only one of them is caught by refusing a payment; the other is
   * a deployment that pays fees into a merchant's wallet and looks fine.
   *
   * Called at boot, so a deployment with the overlap does not start. A
   * misconfiguration found at the first payment is one that has already moved
   * somebody's money.
   */
  async assertTreasuryUnclaimed(chains: readonly ChainId[]): Promise<void> {
    for (const address of this.#treasury) {
      for (const chain of chains) {
        const wallet = await this.#wallets.findByAddress(chain, address);
        if (wallet === null) continue;
        throw new ConfigurationError(
          "A fee destination is registered as a merchant wallet; fees would be paid into a merchant's own wallet",
          { chain, address, merchantId: wallet.merchantId },
        );
      }
    }
  }
}
