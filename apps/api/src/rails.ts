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
import {
  type ChainReceipt,
  type LinkRail,
  type OfferedRail,
  type RailPricingSource,
  type RailReport,
  restrictRails,
} from "@mayarin/payment-intent";
import {
  type AssetCode,
  assetDecimals,
  isAssetCode,
  isMayarinError,
  mapLimit,
  money,
  StaleCache,
  ValidationError,
} from "@mayarin/shared";
import type { Config } from "./config.ts";
import type { Container } from "./container.ts";
import type { RailDto } from "./dto/rails.ts";
import { toRailDto } from "./dto/rails.ts";
import type { PricingContext } from "./pricing.ts";

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
 * **The swap leg, and only the swap leg.** A payment prices in two steps: the
 * merchant's currency into their settlement asset, then that into whatever the
 * payer holds. The first belongs to the payment, not to the rail — it is the
 * same fiat leg on every rail, and a link priced in a currency the oracle
 * cannot read fails identically everywhere. The second is what makes a rail
 * payable, so it is what is asked here.
 *
 * Asking the whole thing instead is not a harmless over-check: probing
 * `quoteFiatPrice` with the settlement asset as the price refuses every
 * non-stablecoin rail with "the fiat leg needs a fiat price, got USDC", which
 * silently deletes the ETH rail from a deployment that offers it.
 *
 * `compose` is the same guarded call the price lock and the contract path make,
 * with the same one-whole-unit probe, so a rail that is offered is a rail whose
 * quote the lock can reproduce. Without the quote layer the rate table is the
 * only source there is, and it is what a non-executed deposit locks against.
 *
 * Answers are cached briefly. A payer loading a link asks about every rail at
 * once, and a merchant's dashboard asks again on every refresh; without the
 * cache that is one oracle round trip per rail per page. The window is short
 * enough that a feed going stale is reflected within it, and nothing here locks
 * a price — the lock re-asks the same source.
 */
export class QuotePricingSource implements RailPricingSource {
  readonly #context: PricingContext;
  readonly #answers: StaleCache<boolean>;

  /**
   * An answer is used for `ttlMs`, then served stale for up to `staleMs` while a new one is
   * fetched behind it. Pricing a pair is a handful of RPC round trips, and a page that
   * waited for thirty-odd of them in turn took eighteen seconds from a far region.
   */
  constructor(context: PricingContext, ttlMs = 60_000, staleMs = 600_000) {
    this.#context = context;
    this.#answers = new StaleCache<boolean>({
      freshMs: ttlMs,
      staleMs,
      load: async (key) => {
        const [chain, asset, settlementAsset] = key.split(":") as [ChainId, AssetCode, AssetCode];
        const { priceable, settled } = await this.#quotes(settlementAsset, asset, chain);
        // A retryable failure is not an answer, it is the absence of one. Caching
        // it hid the rail for the whole TTL after a moment's rate limit or RPC
        // blip — the merchant saw an asset they accept quietly disappear from the
        // counter with nothing to act on. Settled answers still cache.
        return { value: priceable, keep: settled };
      },
    });
  }

  async canPrice(rail: {
    readonly chain: ChainId;
    readonly asset: AssetCode;
    readonly settlementAsset: AssetCode;
  }): Promise<boolean> {
    // A payer sending exactly what the merchant settles in needs no conversion,
    // so there is nothing a rate provider could refuse.
    if (rail.asset === rail.settlementAsset) return true;

    return this.#answers.get(`${rail.chain}:${rail.asset}:${rail.settlementAsset}`);
  }

  /**
   * Prices these pairs ahead of anyone asking, a few at a time, so the first visitor after a
   * restart finds an answer waiting. Never throws: a pair that cannot be priced is the
   * ordinary answer `canPrice` already gives.
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

  /**
   * Whether this pair prices, and whether that answer is worth remembering.
   *
   * `settled` separates "this venue cannot serve this pair" — configuration,
   * true until someone changes it — from "the oracle is rate limited right
   * now", which is true for seconds and must not be cached as though it were
   * the first.
   */
  async #quotes(
    settlementAsset: AssetCode,
    payerAsset: AssetCode,
    chain: ChainId,
  ): Promise<{ priceable: boolean; settled: boolean }> {
    try {
      // One whole unit of the payer's asset, matching `contract-layer`: a probe
      // of a different size prices different depth, and the offer would then
      // disagree with the lock about a pair neither of them refused.
      const probe = money(oneWholeUnit(payerAsset), payerAsset);
      const quote = await this.#context.market.quote();
      if (quote === undefined) {
        const rate = await this.#context.rates.quote(payerAsset, settlementAsset, probe, chain);
        return { priceable: rate.scaledRate > 0n, settled: true };
      }

      // With the chain, so a rail is offered only where a venue can price it
      // *here*. Without it the catalog offered an Arc rail on the strength of a
      // Base pool, and the lock then priced against that same absent pool.
      const composed = await quote.engine.compose(payerAsset, settlementAsset, probe, chain);
      return { priceable: composed.executable.scaledRate > 0n, settled: true };
    } catch (error) {
      // The rail is dropped either way — the payer is never offered a pair the
      // lock would refuse — but a retryable failure is re-asked next time
      // rather than remembered.
      //
      // Say so out loud. A merchant's rail disappearing from their own counter
      // with nothing written anywhere is indistinguishable from never having
      // configured it, and the difference is everything when a payment is
      // being debugged.
      console.warn(
        `[api] rail dropped: ${payerAsset} on ${chain} cannot price to ${settlementAsset}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return { priceable: false, settled: !(isMayarinError(error) && error.retryable) };
    }
  }
}

function oneWholeUnit(asset: AssetCode): bigint {
  return 10n ** BigInt(assetDecimals(asset));
}

/**
 * The payer's rails in merchant/catalog order.
 *
 * Every entry has already passed receipt, settlement-address and pricing
 * checks. Keeping that order makes the default deterministic and keeps every
 * payer-facing surface consistent without a second data source.
 */
export async function payerRails(catalog: readonly OfferedRail[]): Promise<RailDto[]> {
  return catalog.map((rail) => toRailDto(rail));
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

/**
 * The rails a link exposes: the catalog's offer intersected with the link's own
 * set (#259).
 *
 * The one place the narrowing happens, so a payer reading the page, an embed
 * reading `GET /:id/rails`, and a buyer minting an intent are all refused by
 * the same list. The intersection never widens: a rail the catalog does not
 * offer is dropped, not offered.
 */
export function linkRails(
  report: RailReport,
  link: { readonly rails?: readonly LinkRail[] },
): readonly OfferedRail[] {
  return restrictRails(report.rails, link.rails);
}

/**
 * `assertRailOffered`, narrowed to one link.
 *
 * The catalog's refusal comes first — a pair the merchant cannot be paid on is
 * refused whatever the link says. A pair the catalog offers but the link
 * restricts away is then refused with the link's own list, so the payer who
 * holds the wrong asset learns what this link does take.
 */
export async function assertLinkRailOffered(
  container: Container,
  link: { readonly merchant: { readonly id: string }; readonly rails?: readonly LinkRail[] },
  rail: { readonly asset: AssetCode; readonly chain: ChainId } | undefined,
): Promise<void> {
  if (rail === undefined) return;
  await assertRailOffered(container, link.merchant.id, rail);

  if (
    link.rails !== undefined &&
    !link.rails.some((entry) => entry.chain === rail.chain && entry.asset === rail.asset)
  ) {
    throw new ValidationError(
      `This payment link does not accept ${rail.asset} on ${rail.chain}; it only accepts ${link.rails.map((entry) => `${entry.asset} on ${entry.chain}`).join(", ")}`,
      {
        asset: rail.asset,
        chain: rail.chain,
        rails: link.rails.map((entry) => `${entry.chain}:${entry.asset}`),
      },
    );
  }
}

/**
 * The write-time warning for a link's rail restriction (#259).
 *
 * A restriction names rails the catalog may not currently offer, and that is
 * legitimate — a merchant may be about to provision on the chain — so the write
 * is allowed and the response carries one line per unoffered rail, with the
 * catalog's reason where it has one. Never a refusal: the restriction is a
 * preference, and the intersection at read time is what enforces it.
 */
export async function unofferedRailWarnings(
  container: Container,
  merchantId: string,
  rails: readonly LinkRail[],
): Promise<readonly string[]> {
  if (rails.length === 0) return [];

  const report = await container.rails.describe(merchantId);
  const warnings: string[] = [];
  for (const rail of rails) {
    const offered = report.rails.some(
      (entry) => entry.chain === rail.chain && entry.asset === rail.asset,
    );
    if (offered) continue;

    const exclusion =
      report.unavailable.find(
        (entry) => entry.chain === rail.chain && "asset" in entry && entry.asset === rail.asset,
      ) ?? report.unavailable.find((entry) => entry.chain === rail.chain);
    warnings.push(
      exclusion === undefined
        ? `${rail.asset} on ${rail.chain} is not offered to payers right now, so this link will not be payable on it until it is`
        : `${rail.asset} on ${rail.chain} is not offered to payers right now: ${exclusion.reason}`,
    );
  }
  return warnings;
}
