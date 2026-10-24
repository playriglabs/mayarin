/**
 * Which address a merchant is actually paid at (#11, #95).
 *
 * Two things can answer that, and they are not the same kind of answer:
 *
 * - **What the merchant set.** `merchants.settlement_address`, writable through
 *   the settings API since #95. An explicit choice wins on chains where its
 *   address format is valid.
 * - **What is verified.** The managed wallet Mayarin provisioned, or one
 *   merchant-held wallet verified on that exact chain.
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
 * The source stays attached to the answer because the two paths have different
 * trust rules. A configured address is an authenticated, audited payout choice;
 * any wallet fallback must still be verified and belong to the merchant.
 * `WalletGuard` enforces that distinction immediately before signing.
 */

import { type ChainId, isChainAddress, isEvmChainId } from "@mayarin/chain";
import { ConfigurationError } from "@mayarin/shared";
import { isMerchantHeld, isVerified, type MerchantWalletRepository } from "./types.ts";

export interface SettlementAddressResolverOptions {
  readonly wallets: MerchantWalletRepository;
}

export type SettlementDestination =
  | { readonly source: "configured"; readonly address: string }
  | { readonly source: "managed"; readonly address: string }
  | { readonly source: "verified-wallet"; readonly address: string };

export class SettlementAddressResolver {
  readonly #wallets: MerchantWalletRepository;

  constructor(options: SettlementAddressResolverOptions) {
    this.#wallets = options.wallets;
  }

  /**
   * The address to pay this merchant at on this chain.
   *
   * `configured` is what the merchant set, if anything. Absent falls back to
   * their managed wallet on that chain, then to one verified merchant-held
   * wallet. With no unambiguous fallback it refuses rather than guessing.
   */
  async resolve(
    merchantId: string,
    chain: ChainId,
    configured: string | undefined,
  ): Promise<SettlementDestination> {
    const destination = await this.#destination(merchantId, chain, configured);
    if (destination !== undefined) return destination;

    throw new ConfigurationError(
      `Merchant ${merchantId} has no unambiguous settlement wallet on ${chain}; connect one or choose an address explicitly`,
      { merchantId, chain },
    );
  }

  /**
   * The same answer as `resolve`, or `undefined` instead of a throw.
   *
   * For showing a merchant where their money will go before any is moving. The
   * settings screen has to answer "and if I leave this blank?", and it must
   * answer it with the rule the signer actually applies — so `resolve` is
   * defined in terms of this rather than the two computing a fallback each.
   */
  async effective(
    merchantId: string,
    chain: ChainId,
    configured: string | undefined,
  ): Promise<string | undefined> {
    return (await this.#destination(merchantId, chain, configured))?.address;
  }

  async #destination(
    merchantId: string,
    chain: ChainId,
    configured: string | undefined,
  ): Promise<SettlementDestination | undefined> {
    // The settings model predates multi-family chains and holds one global
    // address. It applies only where that address is valid: an EVM address must
    // not eclipse the merchant's verified Solana destination (or vice versa).
    if (configured !== undefined && isChainAddress(chain, configured)) {
      return {
        source: "configured",
        address: isEvmChainId(chain) ? configured.toLowerCase() : configured,
      };
    }

    const managed = await this.#wallets.findManaged(merchantId, chain);
    if (managed !== null && isVerified(managed)) {
      return { source: "managed", address: managed.address };
    }

    // A verified external wallet is a safe fallback too. More than one on this chain is
    // intentionally ambiguous: an explicit settings choice must decide.
    const all = await this.#wallets.listByMerchant(merchantId);
    const held = all.filter((wallet) => isMerchantHeld(wallet) && isVerified(wallet));
    const here = held.filter((wallet) => wallet.chain === chain);
    if (here.length > 1) return undefined;
    const [only] = here;
    if (only !== undefined) return { source: "verified-wallet", address: only.address };

    // A Solana address is not shared with the merchant's EVM Safe, so Solana stays per chain.
    // On EVM a wallet is proved by a recovered signature, which names a key, and that key holds
    // the address on every EVM chain: connecting once on Base covers Polygon too. One distinct
    // address across the EVM chains is the merchant's choice; two is theirs to settle in settings.
    // A merchant on the managed path is the exception: the Safe is set up network by network, and a
    // network without it must say so rather than quietly pay their own wallet while the rest pay the Safe.
    if (!isEvmChainId(chain) || all.some((wallet) => wallet.provenance === "provisioned")) {
      return undefined;
    }
    const evmAddresses = new Set(
      held.filter((wallet) => isEvmChainId(wallet.chain)).map((wallet) => wallet.address),
    );
    const [address] = evmAddresses;
    return evmAddresses.size === 1 && address !== undefined
      ? { source: "verified-wallet", address }
      : undefined;
  }
}
