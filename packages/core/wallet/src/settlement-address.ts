/**
 * Which address a merchant is actually paid at (#11, #95).
 *
 * Two things can answer that, and they are not the same kind of answer:
 *
 * - **What the merchant set.** `merchants.settlement_address`, writable through
 *   the settings API since #95. An explicit choice, and it wins.
 * - **What they were given.** The managed wallet Mayarin provisioned for them.
 *
 * Resolving to the second when the first is unset is the difference between a
 * merchant who is onboarded and a merchant holding a Safe they have to go and
 * name in a settings form before any money can reach it. Nothing about the
 * un-named state looks broken until a payment refuses to lock.
 *
 * ## Why this resolves on read rather than writing a default
 *
 * Provisioning could copy the address into `merchants.settlement_address` and
 * leave this file unnecessary. It would also be wrong in two ways:
 *
 * - That column is one address for the whole merchant, and a managed wallet is
 *   per chain. Writing chain A's wallet into it makes it the answer for chain B
 *   too, and the guard would then refuse chain B's payment with a message about
 *   an address the merchant never chose.
 * - A default that has been written down is indistinguishable from a choice. A
 *   merchant who later provisions on another chain, or whose managed wallet is
 *   re-derived, keeps a stale address that looks deliberate.
 *
 * Resolving on read keeps "unset" meaning unset, and keeps the fallback correct
 * for the chain being asked about.
 *
 * ## What this does not do
 *
 * It does not decide whether the address may be paid. `WalletGuard` does, on
 * every path, after this. The two are separate because the fallback is trusted
 * by construction — it *is* a verified wallet of that merchant — while the
 * configured value is a string somebody with `settings:manage` typed, and a
 * resolver that also validated would make it easy to write a caller that
 * resolves without checking.
 */

import type { ChainId } from "@mayarin/chain";
import { ConfigurationError } from "@mayarin/shared";
import { isVerified, type MerchantWalletRepository } from "./types.ts";

export interface SettlementAddressResolverOptions {
  readonly wallets: MerchantWalletRepository;
}

export class SettlementAddressResolver {
  readonly #wallets: MerchantWalletRepository;

  constructor(options: SettlementAddressResolverOptions) {
    this.#wallets = options.wallets;
  }

  /**
   * The address to pay this merchant at on this chain.
   *
   * `configured` is what the merchant set, if anything. Absent falls back to
   * their managed wallet on that chain; absent with no managed wallet is a
   * refusal, because the alternative — a deployment-wide address — pays every
   * merchant into the same wallet.
   */
  async resolve(
    merchantId: string,
    chain: ChainId,
    configured: string | undefined,
  ): Promise<string> {
    if (configured !== undefined) return configured.toLowerCase();

    const managed = await this.#wallets.findManaged(merchantId, chain);
    if (managed !== null && isVerified(managed)) return managed.address;

    throw new ConfigurationError(
      `Merchant ${merchantId} has no settlement address on ${chain} and no managed wallet to fall back to; set one or provision a wallet`,
      { merchantId, chain },
    );
  }
}
