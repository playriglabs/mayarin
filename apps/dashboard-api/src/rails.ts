/**
 * Where this merchant can be paid, and why not where they cannot (#244).
 *
 * The payment API derives the same catalog for a payer at checkout. The
 * dashboard needs it for the other reader: a merchant who wants to know which
 * networks their link works on, and — the part that only exists here — the
 * reason a network is missing. "You have no settlement address on Arc" is a
 * sentence a merchant can act on; a payment that refuses to lock three days
 * later is not.
 *
 * Pricing is asked of the payment API rather than recomputed. That service owns
 * the rate sources and the guard the price lock runs through, and a second
 * opinion here would be a second thing to keep in step — the same reasoning
 * `PaymentApiClient` was built on.
 */

import { type ChainId, isChainId } from "@mayarin/chain";
import type { ChainReceipt, RailPricingSource } from "@mayarin/payment-intent";
import { type AssetCode, isAssetCode, mapLimit, StaleCache } from "@mayarin/shared";
import type { Config } from "./config.ts";
import type { PaymentApiClient } from "./services/payment-api-client.ts";

/**
 * Every chain this deployment settles on.
 *
 * Read from the tokens and native assets it is configured to receive, unioned
 * with the chains it can provision a wallet on — a chain it provisions on but
 * cannot yet receive is still a chain the merchant has an address on, and
 * hiding that address is how a merchant ends up with a Safe they never learn
 * about.
 */
export function settlementChains(config: Config): readonly ChainId[] {
  const chains = new Set<ChainId>();
  for (const chain of Object.keys(config.chainAssets)) {
    if (isChainId(chain)) chains.add(chain);
  }
  for (const chain of Object.keys(config.chainNativeAssets)) {
    if (isChainId(chain)) chains.add(chain);
  }
  for (const chain of config.walletProvisionChains) chains.add(chain);
  return [...chains];
}

/** What this deployment can receive per chain, in the catalog's own shape. */
export function chainReceipts(config: Config): readonly ChainReceipt[] {
  return settlementChains(config).map((chain) => {
    const tokens: Partial<Record<AssetCode, string>> = {};
    for (const [asset, address] of Object.entries(config.chainAssets[chain] ?? {})) {
      if (isAssetCode(asset) && address !== undefined) tokens[asset] = address;
    }
    const nativeAsset = config.chainNativeAssets[chain];
    return { chain, ...(nativeAsset === undefined ? {} : { nativeAsset }), tokens };
  });
}

/**
 * Whether a pair can be priced, asked of the service that will price it.
 *
 * `POST /v1/quotes` is the payment API's own preview, and it answers with the
 * same source the price lock reads. Its `available` flag is exactly this
 * question, so the dashboard reports what a payer would actually be offered
 * rather than an optimistic guess computed from configuration.
 *
 * Cached per pair for the life of a request-ish window, because a merchant's
 * settlement screen asks about every rail at once and the payment API would
 * otherwise take one round trip per row on every refresh.
 */
export class PaymentApiPricingSource implements RailPricingSource {
  readonly #payments: PaymentApiClient;
  readonly #answers: StaleCache<boolean>;

  /**
   * Fresh for `ttlMs`, then served stale for up to `staleMs` while a new answer is fetched
   * behind the caller. Each probe is an HTTP round trip to the payment API, which prices the
   * pair over RPC, so a settings screen that waited for every row in turn took ten to twenty
   * seconds from a far region.
   */
  constructor(payments: PaymentApiClient, ttlMs = 60_000, staleMs = 600_000) {
    this.#payments = payments;
    this.#answers = new StaleCache<boolean>({
      freshMs: ttlMs,
      staleMs,
      load: async (key) => {
        const [chain, asset, settlementAsset] = key.split(":") as [ChainId, AssetCode, AssetCode];
        return this.#ask(chain, asset, settlementAsset);
      },
    });
  }

  async canPrice(rail: {
    readonly chain: ChainId;
    readonly asset: AssetCode;
    readonly settlementAsset: AssetCode;
  }): Promise<boolean> {
    // A payer sending exactly what the merchant settles in needs no conversion.
    if (rail.asset === rail.settlementAsset) return true;

    return this.#answers.get(`${rail.chain}:${rail.asset}:${rail.settlementAsset}`);
  }

  /**
   * Asks about these pairs ahead of anyone, a few at a time, so the first settings screen
   * after a restart finds the answers waiting. Never throws: a pair the payment API cannot
   * price is the ordinary answer `canPrice` already gives.
   */
  async warm(
    rails: readonly {
      readonly chain: ChainId;
      readonly asset: AssetCode;
      readonly settlementAsset: AssetCode;
    }[],
    concurrency = 4,
  ): Promise<void> {
    await mapLimit(rails, concurrency, (rail) => this.canPrice(rail).catch(() => false));
  }

  async #ask(
    chain: ChainId,
    payerAsset: AssetCode,
    settlementAsset: AssetCode,
  ): Promise<{ readonly value: boolean; readonly keep: boolean }> {
    try {
      // Asks the payment API's own checkout source, not a quote. A quote prices one
      // dollar; checkout prices one whole unit of the payer's asset through the pools
      // and drops the rail when the price strays from the reference. Probing
      // differently showed "accepting" here for a rail the payer never saw.
      const value = await this.#payments.railPriceable({
        chain,
        asset: payerAsset,
        settlementAsset,
      });
      return { value, keep: true };
    } catch {
      // The payment API being unreachable is not evidence that a pair cannot be
      // priced, but it is evidence that nothing can be paid right now — and the
      // honest thing to show a merchant is the rail missing rather than a rail
      // that would fail if they used it. Shown now, but not remembered: the payment API
      // being down for a moment must not hide a rail for the window after it recovers.
      return { value: false, keep: false };
    }
  }
}
