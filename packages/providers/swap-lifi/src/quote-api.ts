/**
 * LiFi quote API wire format and pure rate scaling.
 *
 * Everything in this file is pure — the response schema and the integer
 * arithmetic that lifts an estimate's `fromAmount`/`toAmount` pair into the
 * codebase's minor-units-per-whole-unit rate shape. The network call lives
 * in `adapter.ts`.
 *
 * The schema keeps only the fields the adapter consumes. LiFi's quote
 * response carries much more (a route, a transaction request, fee and gas
 * costs); the transaction request is the calldata builder's concern (#49)
 * and cross-chain routing is out of scope here (#19 owns that design).
 */

import { z } from "zod";

const decimalString = z.string().regex(/^\d+$/);

export const lifiQuoteResponseSchema = z.object({
  estimate: z.object({
    /** Minor units of the sell token that LiFi priced. */
    fromAmount: decimalString,
    /** Minor units of the buy token LiFi estimates the route delivers. */
    toAmount: decimalString,
  }),
});

export type LifiQuoteResponse = z.infer<typeof lifiQuoteResponseSchema>;

/**
 * Lifts a priced swap (`fromAmount` minor units of `from` into `toAmount`
 * minor units of `to`) into minor units of `to` per whole unit of `from`:
 * `toAmount × 10^decimals(from) / fromAmount`, computed entirely in BigInt.
 * The division floors, so the rate never overstates the venue's output — the
 * conservative direction for a rate that feeds `minOut`, and the same choice
 * as the 0x and Uniswap adapters.
 */
export function scaleSwapRate(fromAmount: bigint, toAmount: bigint, fromDecimals: number): bigint {
  return (toAmount * 10n ** BigInt(fromDecimals)) / fromAmount;
}
