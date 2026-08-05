/**
 * 0x Swap API v2 wire format and pure rate scaling.
 *
 * Everything in this file is pure — the response schema and the integer
 * arithmetic that lifts a `sellAmount`/`buyAmount` pair into the codebase's
 * minor-units-per-whole-unit rate shape. The network call lives in
 * `adapter.ts`.
 *
 * When 0x has no route for the pair, the API answers
 * `liquidityAvailable: false` and omits the amounts. The schema models both
 * arms, so the adapter branches on the tag instead of on missing fields.
 */

import { z } from "zod";

const decimalString = z.string().regex(/^\d+$/);

export const zeroExPriceResponseSchema = z.discriminatedUnion("liquidityAvailable", [
  z.object({ liquidityAvailable: z.literal(false) }),
  z.object({
    liquidityAvailable: z.literal(true),
    /** Minor units of the sell token that the venue priced. */
    sellAmount: decimalString,
    /** Minor units of the buy token the venue expects to deliver. */
    buyAmount: decimalString,
  }),
]);

export type ZeroExPriceResponse = z.infer<typeof zeroExPriceResponseSchema>;

/**
 * Lifts a priced swap (`sellAmount` minor units of `from` into `buyAmount`
 * minor units of `to`) into minor units of `to` per whole unit of `from`:
 * `buyAmount × 10^decimals(from) / sellAmount`, computed entirely in BigInt.
 * The division floors, so the rate never overstates the venue's output — the
 * conservative direction for a rate that feeds `minOut`.
 */
export function scaleSwapRate(sellAmount: bigint, buyAmount: bigint, fromDecimals: number): bigint {
  return (buyAmount * 10n ** BigInt(fromDecimals)) / sellAmount;
}
