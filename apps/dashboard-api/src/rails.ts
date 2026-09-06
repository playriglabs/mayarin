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
import { type AssetCode, isAssetCode } from "@mayarin/shared";
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
  readonly #ttlMs: number;
  readonly #answers = new Map<string, { readonly at: number; readonly priceable: boolean }>();

  constructor(payments: PaymentApiClient, ttlMs = 30_000) {
    this.#payments = payments;
    this.#ttlMs = ttlMs;
  }

  async canPrice(rail: {
    readonly chain: ChainId;
    readonly asset: AssetCode;
    readonly settlementAsset: AssetCode;
  }): Promise<boolean> {
    // A payer sending exactly what the merchant settles in needs no conversion.
    if (rail.asset === rail.settlementAsset) return true;

    const key = `${rail.asset}:${rail.settlementAsset}`;
    const cached = this.#answers.get(key);
    const now = Date.now();
    if (cached !== undefined && now - cached.at < this.#ttlMs) return cached.priceable;

    const priceable = await this.#ask(rail.settlementAsset, rail.asset);
    this.#answers.set(key, { at: now, priceable });
    return priceable;
  }

  async #ask(_settlementAsset: AssetCode, payerAsset: AssetCode): Promise<boolean> {
    try {
      // Probed in **fiat**, not in the settlement asset. `POST /v1/quotes`
      // prices a merchant's own currency into what the payer sends, so a
      // stablecoin price makes it refuse every non-stablecoin rail with "the
      // fiat leg needs a fiat price" — which would silently delete the ETH rail
      // from a deployment that offers it. One dollar is a fiat unit every
      // deployment can read, and the leg it exercises is the rail's.
      const view = await this.#payments.quote({ amount: "1", asset: "USD" }, [payerAsset]);
      return view.quotes.some((line) => line.asset === payerAsset && line.available);
    } catch {
      // The payment API being unreachable is not evidence that a pair cannot be
      // priced, but it is evidence that nothing can be paid right now — and the
      // honest thing to show a merchant is the rail missing rather than a rail
      // that would fail if they used it.
      return false;
    }
  }
}
