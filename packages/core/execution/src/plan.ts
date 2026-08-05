/**
 * The swap plan (RFC #5, first increment — #44).
 *
 * The planner decides one thing: does this payment need a swap? The decision
 * is a discriminated union, so downstream code must branch on the kind and
 * the compiler checks the branches.
 *
 * The engine plans and the contract executes. The plan holds no calldata yet.
 * The calldata builder (#49) turns a swap plan and a signed order (#40) into
 * the input for `PaymentRouter`, when #24 and #35 give the shapes.
 */

import type { PriceQuote } from "@mayarin/clearing";
import type { AssetCode, Money } from "@mayarin/shared";
import { ValidationError } from "@mayarin/shared";
import type { SwapVenue } from "./venue.ts";

/** No swap: the payer asset is the settlement asset. The contract settles directly. */
export interface NoSwapPlan {
  readonly kind: "no-swap";
  readonly asset: AssetCode;
}

/** A swap through one venue, priced with the venue quote at plan time. */
export interface SwapRequiredPlan {
  readonly kind: "swap";
  readonly payerAsset: AssetCode;
  readonly settlementAsset: AssetCode;
  readonly venue: string;
  readonly quote: PriceQuote;
}

export type SwapPlan = NoSwapPlan | SwapRequiredPlan;

/**
 * Plans the swap for `amount` of `payerAsset` into `settlementAsset`.
 *
 * If the assets are equal, the result is a no-swap plan and no venue call
 * occurs. If the assets differ, the venue gives the executable quote and the
 * plan records the quote together with the venue name. Venue errors pass
 * through unchanged: a missing pair is a `ConfigurationError`, and a venue
 * fault is a retryable `ProviderError`.
 */
export async function planSwap(
  venue: SwapVenue,
  payerAsset: AssetCode,
  settlementAsset: AssetCode,
  amount: Money,
): Promise<SwapPlan> {
  if (amount.asset !== payerAsset) {
    throw new ValidationError(
      `The amount asset ${amount.asset} must equal the payer asset ${payerAsset}`,
      { amountAsset: amount.asset, payerAsset },
    );
  }
  if (payerAsset === settlementAsset) {
    return { kind: "no-swap", asset: payerAsset };
  }

  const quote = await venue.quote(payerAsset, settlementAsset, amount);
  return {
    kind: "swap",
    payerAsset,
    settlementAsset,
    venue: venue.name,
    quote,
  };
}
