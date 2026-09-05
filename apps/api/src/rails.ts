/**
 * Rail-catalog assembly for the composition root (#244).
 *
 * The catalog itself is pure and lives in `@mayarin/payment-intent`. This file
 * is the part that knows what *this* deployment can receive: which chains it
 * watches, which tokens it holds an address for, and whether the rate provider
 * can price a given pair. Composition, like `quote-layer.ts` beside it.
 *
 * It exists as its own file for one reason: the answer to "which chain does a
 * payer pay on" used to be `Object.keys(CHAIN_ASSETS)[0]`, and re-ordering an
 * environment variable silently re-pointed every payment link in production.
 * Assembling the receipts explicitly is what makes that impossible to write
 * again.
 */

import { type ChainId, isChainId } from "@mayarin/chain";
import type { ChainReceipt, RailPricingSource, RailReport } from "@mayarin/payment-intent";
import {
  type AssetCode,
  assetDecimals,
  isAssetCode,
  isPositive,
  money,
  ValidationError,
} from "@mayarin/shared";
import type { Config } from "./config.ts";
import type { Container } from "./container.ts";
import { type PricingContext, priceFor } from "./pricing.ts";

/**
 * What this deployment can receive, per chain.
 *
 * `watched` is the set of chains something is actually scanning. A chain that
 * nothing watches must not appear: a payer sent to it deposits into an address
 * no watcher reads, and the payment never funds.
 *
 * With the chain layer off there are no watchers and receipt is manual or
 * auto-confirmed, so every configured chain qualifies — the failure mode the
 * watched-set guards against does not exist there.
 */
export function chainReceipts(
  config: Config,
  watched: ReadonlySet<ChainId>,
): readonly ChainReceipt[] {
  const chains = new Set<ChainId>();
  for (const chain of Object.keys(config.chainAssets)) {
    if (isChainId(chain)) chains.add(chain);
  }
  for (const chain of Object.keys(config.chainNativeAssets)) {
    if (isChainId(chain)) chains.add(chain);
  }

  const receipts: ChainReceipt[] = [];
  for (const chain of chains) {
    if (config.chain !== undefined && !watched.has(chain)) continue;

    const tokens: Partial<Record<AssetCode, string>> = {};
    for (const [asset, address] of Object.entries(config.chainAssets[chain] ?? {})) {
      if (isAssetCode(asset) && address !== undefined) tokens[asset] = address;
    }

    const nativeAsset = config.chainNativeAssets[chain];
    receipts.push({
      chain,
      ...(nativeAsset === undefined ? {} : { nativeAsset }),
      tokens,
    });
  }

  return receipts;
}

/**
 * Whether a rail can be priced into what the merchant settles in.
 *
 * Asked through `priceFor` — the same function the indicative quote and,
 * through it, the price lock use. Asking a different source would reproduce the
 * bug that function's own comment records: a preview that cannot fail where the
 * lock fails is not a preview, and a rail offered on a pair the lock refuses is
 * worse, because the payer has already chosen by then.
 *
 * One whole unit of the settlement asset is the probe, matching what the
 * contract path prices with. Every reason a pair might not price — no venue, no
 * oracle feed, a stale reference, a closed FX market — lives inside that call
 * rather than in a table this could read.
 *
 * Answers are cached briefly. A payer loading a link asks about every rail at
 * once, and a merchant's dashboard asks again on every refresh; without the
 * cache that is one oracle round trip per rail per page. The window is short
 * enough that a feed going stale is reflected within it, and nothing here locks
 * a price — the lock re-asks the same source.
 */
export class QuotePricingSource implements RailPricingSource {
  readonly #context: PricingContext;
  readonly #ttlMs: number;
  readonly #answers = new Map<string, { readonly at: number; readonly priceable: boolean }>();

  constructor(context: PricingContext, ttlMs = 30_000) {
    this.#context = context;
    this.#ttlMs = ttlMs;
  }

  async canPrice(rail: {
    readonly chain: ChainId;
    readonly asset: AssetCode;
    readonly settlementAsset: AssetCode;
  }): Promise<boolean> {
    // A payer sending exactly what the merchant settles in needs no conversion,
    // so there is nothing a rate provider could refuse.
    if (rail.asset === rail.settlementAsset) return true;

    const key = `${rail.chain}:${rail.asset}:${rail.settlementAsset}`;
    const cached = this.#answers.get(key);
    const now = Date.now();
    if (cached !== undefined && now - cached.at < this.#ttlMs) return cached.priceable;

    const priceable = await this.#quotes(rail.settlementAsset, rail.asset);
    this.#answers.set(key, { at: now, priceable });
    return priceable;
  }

  async #quotes(settlementAsset: AssetCode, payerAsset: AssetCode): Promise<boolean> {
    try {
      const probe = money(oneWholeUnit(settlementAsset), settlementAsset);
      const quote = await priceFor(this.#context, probe, payerAsset);
      return isPositive(quote.priced);
    } catch {
      // Every failure means the same thing here — this pair cannot be priced
      // right now — and the rail is dropped with that as the stated reason. The
      // payer never sees the exception, because they are never offered the rail.
      return false;
    }
  }
}

function oneWholeUnit(asset: AssetCode): bigint {
  return 10n ** BigInt(assetDecimals(asset));
}

/**
 * Refuses a pair the catalog does not offer, with the reason it was dropped.
 *
 * Never a generic validation error: the catalog knows whether the chain has no
 * settlement destination, whether the asset cannot be priced, or whether the
 * merchant does not accept it there, and a payer or an integrator can act on
 * exactly one of those.
 */
export async function assertRailOffered(
  container: Container,
  merchantId: string,
  rail: { readonly asset: AssetCode; readonly chain: ChainId } | undefined,
): Promise<void> {
  if (rail === undefined) return;

  const report = await container.rails.describe(merchantId);
  if (
    report.rails.some((offered) => offered.chain === rail.chain && offered.asset === rail.asset)
  ) {
    return;
  }

  throw new ValidationError(refusalFor(report, rail), {
    asset: rail.asset,
    chain: rail.chain,
    rails: report.rails.map((offered) => `${offered.chain}:${offered.asset}`),
  });
}

function refusalFor(
  report: RailReport,
  rail: { readonly asset: AssetCode; readonly chain: ChainId },
): string {
  // The most specific reason first: a pair-level exclusion says something about
  // this exact rail, while a chain-level one says the chain was never on offer.
  const exclusion =
    report.unavailable.find(
      (entry) => entry.chain === rail.chain && "asset" in entry && entry.asset === rail.asset,
    ) ?? report.unavailable.find((entry) => entry.chain === rail.chain);

  if (exclusion !== undefined) {
    return `${rail.asset} on ${rail.chain} cannot be paid: ${exclusion.reason}`;
  }

  const offered = report.rails.map((entry) => `${entry.asset} on ${entry.chain}`).join(", ");
  return offered.length === 0
    ? `${rail.asset} on ${rail.chain} cannot be paid, and this merchant has no payment rail available`
    : `${rail.asset} on ${rail.chain} cannot be paid; available rails are ${offered}`;
}
