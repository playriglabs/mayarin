/**
 * 0x Swap API v2 wire format and pure rate scaling.
 *
 * Everything in this file is pure — the response schemas and the integer
 * arithmetic that lifts a `sellAmount`/`buyAmount` pair into the codebase's
 * minor-units-per-whole-unit rate shape. The network calls live in
 * `adapter.ts`.
 *
 * When 0x has no route for the pair, the API answers
 * `liquidityAvailable: false` and omits the amounts. Both schemas model both
 * arms, so the adapter branches on the tag instead of on missing fields.
 */

import { z } from "zod";

const decimalString = z.string().regex(/^\d+$/);
const addressString = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const hexData = z.custom<`0x${string}`>(
  (value) => typeof value === "string" && /^0x[0-9a-fA-F]*$/.test(value),
);

/** The `/price` read the planner and the selector consume (#45). */
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

/** The `/quote` (AllowanceHolder) read the route path consumes (#57). */
export const zeroExRouteResponseSchema = z.discriminatedUnion("liquidityAvailable", [
  z.object({ liquidityAvailable: z.literal(false) }),
  z.object({
    liquidityAvailable: z.literal(true),
    transaction: z.object({
      /** The AllowanceHolder entry point the taker calls and approves. */
      to: addressString,
      data: hexData,
      /** Native value as a decimal string; absent for ERC-20 sells. */
      value: decimalString.optional(),
    }),
  }),
]);

export type ZeroExRouteResponse = z.infer<typeof zeroExRouteResponseSchema>;

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
