/**
 * Pure quoter arithmetic.
 *
 * The QuoterV2 read answers `amountOut` minor units of the buy token for
 * `amountIn` minor units of the sell token. Everything here is pure — the
 * viem read lives in `adapter.ts`, which is what lets the scaling boundaries
 * be tested without a network.
 */

/**
 * Lifts a quoted swap (`amountIn` minor units of `from` into `amountOut`
 * minor units of `to`) into minor units of `to` per whole unit of `from`:
 * `amountOut × 10^decimals(from) / amountIn`, computed entirely in BigInt.
 * The division floors, so the rate never overstates the venue's output — the
 * conservative direction for a rate that feeds `minOut`, and the same choice
 * as the 0x adapter.
 */
export function scaleSwapRate(amountIn: bigint, amountOut: bigint, fromDecimals: number): bigint {
  return (amountOut * 10n ** BigInt(fromDecimals)) / amountIn;
}
