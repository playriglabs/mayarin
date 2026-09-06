import { scaledRateFrom } from "@mayarin/shared";

/**
 * Pure quoter arithmetic — identical to the V3 adapter's. `getAmountsOut`
 * answers `amountOut` minor units of the buy token for `amountIn` minor units
 * of the sell token; this lifts it to minor units of `to` per whole unit of
 * `from`, floored so the rate never overstates the venue's output.
 */
export function scaleSwapRate(amountIn: bigint, amountOut: bigint, fromDecimals: number): bigint {
  return scaledRateFrom(amountOut * 10n ** BigInt(fromDecimals), amountIn, "down");
}
