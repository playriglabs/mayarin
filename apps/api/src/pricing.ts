/**
 * The one place that answers "what would this cost the payer".
 *
 * Extracted from the quotes route (#244) because a second caller appeared: the
 * rail catalog has to know whether a `(chain, asset)` pair can be priced at all
 * before it offers it, and asking a *different* source than the one that will
 * lock is precisely the bug the comment below was written about.
 */

import type { RateProvider } from "@mayarin/clearing";
import { payerEstimate } from "@mayarin/quote";
import {
  type AssetCode,
  assetDecimals,
  convert,
  getAsset,
  type Money,
  money,
} from "@mayarin/shared";
import type { Config } from "./config.ts";
import type { RuntimeMarket } from "./market.ts";

/**
 * What pricing needs, and nothing else.
 *
 * A structural slice rather than the whole `Container`, so this can be called
 * while the container is still being assembled — which is exactly when the rail
 * catalog needs it. `Container` satisfies it by construction.
 */
export interface PricingContext {
  readonly market: Pick<RuntimeMarket, "quote">;
  readonly rates: RateProvider;
  readonly config: Pick<Config, "settlementAsset">;
}

/**
 * The rate a payment would lock at, from the source that will lock it.
 *
 * Which source that is depends on the deployment, and getting it wrong is the
 * whole reason this function exists rather than one call to `rates`:
 *
 * - With the **quote layer** configured, a payment prices through the guarded
 *   engine — venue against oracle — because that is what both the contract path
 *   and an executed deposit use to sign an order.
 * - Without it, the `RateProvider` table is the only source there is.
 *
 * Reading `rates` in the first case is what made a preview say `12,50 USDC` for
 * a pair whose lock then failed with "No Pyth feed configured for USD -> USDC".
 * A preview that cannot fail where the lock fails is not a preview.
 *
 * The same reasoning covers the swap leg. A payer asset that is not the
 * merchant's settlement asset — ETH — is priced through the venue here, exactly
 * as `contract-layer` prices it at lock time: same probe size, same guard, same
 * `payerEstimate` arithmetic. Reading the static rate table for that leg is what
 * made a preview say `0,00033334 ETH` against a venue that would have charged
 * sixteen times as much.
 */
export async function priceFor(
  container: PricingContext,
  amount: Money,
  payerAsset: AssetCode,
): Promise<{ priced: Money; source: string; scaledRate: bigint | null }> {
  const quote = await container.market.quote();

  // Without the quote layer the static rate table is the only source there is,
  // so a preview falls back to it — the same development stand-in the deposit
  // path uses when no venue is wired. With the layer on, the guarded engine
  // prices the swap leg through the venue; a merchant already pricing in crypto
  // has no fiat leg for it to own, so the engine refuses the pair exactly as
  // the contract and executable-deposit locks do. Routing that through the
  // table instead would show a number the lock can never produce — a preview
  // that lies about a payment it cannot make.
  if (quote === undefined) {
    const rate = await container.rates.quote(amount.asset, payerAsset, amount);
    return {
      priced: convert(amount, payerAsset, rate.scaledRate),
      source: rate.source,
      scaledRate: rate.scaledRate,
    };
  }

  // A stablecoin payer settles in what they hold: one fiat leg, no swap. Any
  // other asset settles into the deployment's settlement asset — the same
  // default `PaymentIntentService` applies to a merchant that has not chosen
  // one, so the preview crosses the pair the lock will.
  const settlementAsset =
    getAsset(payerAsset).kind === "stablecoin" ? payerAsset : container.config.settlementAsset;

  // A stablecoin payer has only the fiat leg. Route it through the injected
  // RateProvider because that is exactly what a non-executed deposit locks
  // against. RuntimePriceSource delegates this pair to the quote engine when
  // one exists, so preview and confirmation share both source and rounding.
  if (getAsset(amount.asset).kind === "fiat" && payerAsset === settlementAsset) {
    const rate = await container.rates.quote(amount.asset, payerAsset, amount);
    return {
      priced: convert(amount, payerAsset, rate.scaledRate),
      source: rate.source,
      scaledRate: rate.scaledRate,
    };
  }

  const engineQuote = await quote.engine.quoteFiatPrice({
    price: amount,
    settlementAsset,
    payerAsset,
    // One whole unit, matching `contract-layer`: a probe of a different size
    // prices different depth and the preview drifts from the lock again.
    probe: money(10n ** BigInt(assetDecimals(payerAsset)), payerAsset),
  });

  if (!("composed" in engineQuote)) {
    return {
      priced: engineQuote.settlement.settlementAmount,
      source: engineQuote.settlement.source,
      scaledRate: null,
    };
  }

  const composed = engineQuote.composed;
  return {
    priced: payerEstimate(composed, engineQuote.settlement.settlementAmount, quote.slippageBps)
      .amount,
    source: composed.executable.source,
    scaledRate: composed.executable.scaledRate,
  };
}
