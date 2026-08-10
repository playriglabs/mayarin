/**
 * Indicative quotes (#15).
 *
 * "What would this cost in ETH? In USDC?" — asked before a payment exists, so a
 * counter can show the payer what each accepted asset would take and let them
 * choose. One source amount in, one line per asset out.
 *
 * **Indicative, not locked.** A price lock happens inside the clearing engine,
 * against the same rate provider, at the moment a payment is confirmed; nothing
 * here reserves anything or creates a record. The number a payer is actually
 * asked for is the one on their payment, and it can differ from this by
 * whatever the rate moved in between. Saying so is the whole reason this is a
 * separate route rather than a field on an intent that has not been created.
 *
 * An asset the rate provider cannot price is reported as an unavailable line
 * rather than failing the request: one unpriceable asset should not blank the
 * counter for the two that are fine.
 */

import { payerEstimate } from "@mayarin/quote";
import {
  type AssetCode,
  assetCodeSchema,
  assetDecimals,
  convert,
  decimalMoneySchema,
  getAsset,
  isPositive,
  type Money,
  money,
  roundUpToPayerPrecision,
} from "@mayarin/shared";
import { Hono } from "hono";
import { z } from "zod";
import type { Container } from "../container.ts";
import { toMoneyDto } from "../dto/money.ts";

const quoteBodySchema = z
  .object({
    /** What the merchant is charging, in their own currency. */
    amount: decimalMoneySchema,
    /** The payer assets to price it in. */
    assets: z.array(assetCodeSchema).min(1).max(16),
  })
  .strict();

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
async function priceFor(
  container: Container,
  amount: Money,
  payerAsset: AssetCode,
): Promise<{ priced: Money; source: string; scaledRate: bigint | null }> {
  const quote = await container.market.quote();

  // The guarded engine only crosses fiat. A merchant already pricing in crypto
  // has no fiat leg for it to own, so the table is the only source there is.
  if (quote === undefined || getAsset(amount.asset).kind !== "fiat") {
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

export function quoteRoutes(container: Container): Hono {
  const app = new Hono();

  app.post("/", async (c) => {
    const body = quoteBodySchema.parse(await c.req.json());

    const quotes = await Promise.all(
      body.assets.map(async (asset) => {
        // Same asset, no conversion: quoting a rate for it would invent a
        // rounding step where the payer simply sends what is owed.
        if (asset === body.amount.asset) {
          return { asset, amount: toMoneyDto(body.amount), rate: null, available: true };
        }

        try {
          const quote = await priceFor(container, body.amount, asset);
          // Rounded exactly as the price lock will round it, so the figure a
          // customer is shown while choosing is the figure they are then asked
          // for. A preview that differs in the eleventh decimal is a preview
          // that gets read as a discrepancy.
          const amount = roundUpToPayerPrecision(quote.priced);
          if (!isPositive(amount)) {
            // A positive charge that prices to zero is a rate problem, not a
            // free sale — reported as unavailable rather than as "0".
            return { asset, amount: null, rate: null, available: false };
          }
          return {
            asset,
            amount: toMoneyDto(amount),
            rate:
              quote.scaledRate === null
                ? { source: quote.source }
                : { scaledRate: quote.scaledRate.toString(), source: quote.source },
            available: true,
          };
        } catch (error) {
          // No rate for the pair, a source that is down, a market that is
          // closed. The other assets still answer — but the reason travels, so
          // a counter is told *why* rather than shown a blank row it cannot act
          // on. This is the message an operator needs: a missing oracle feed is
          // a configuration fix, not something the payer can retry around.
          return {
            asset,
            amount: null,
            rate: null,
            available: false,
            reason: error instanceof Error ? error.message : "This asset cannot be priced",
          };
        }
      }),
    );

    return c.json({
      /** What was priced, echoed so a client can render the row it asked about. */
      source: toMoneyDto(body.amount),
      quotes,
      /**
       * Stated on the wire, not just in the docs: a client rendering these
       * numbers is showing a payer what they will send, and the honest caption
       * is "about this much".
       */
      indicative: true,
    });
  });

  return app;
}
