/**
 * Pure aggregator arithmetic and round validation.
 *
 * Chainlink's AggregatorV3 answers are `int256` significands scaled by the
 * feed's own `decimals()`. Everything here is pure — the viem read lives in
 * `adapter.ts`, which is what lets the scaling boundaries and the round
 * checks be tested without a network.
 */

import { type AssetCode, ProviderError } from "@mayarin/shared";

/** The fields of `latestRoundData()` the adapter consumes. */
export interface AggregatorRound {
  readonly answer: bigint;
  /** Unix seconds at which the aggregator last updated. Zero: never completed. */
  readonly updatedAt: bigint;
}

/**
 * Rejects a round the oracle cannot vouch for: a non-positive answer, or an
 * `updatedAt` of zero (a round that never completed — Chainlink's documented
 * signal for an unusable read). Both are provider conditions and retryable;
 * age-based staleness stays the deviation guard's judgement.
 */
export function assertUsableRound(round: AggregatorRound, from: AssetCode, to: AssetCode): void {
  if (round.updatedAt === 0n) {
    throw new ProviderError(`Chainlink round for ${from} -> ${to} never completed`, {
      from,
      to,
      updatedAt: round.updatedAt.toString(),
    });
  }
  if (round.answer <= 0n) {
    throw new ProviderError(`Chainlink answer for ${from} -> ${to} is not positive`, {
      from,
      to,
      answer: round.answer.toString(),
    });
  }
}

/**
 * Lifts a feed answer (`significand × 10^-feedDecimals` quote units per whole
 * base unit) into minor units of `to` per whole unit of `from`:
 * `answer × 10^(decimals(to) − feedDecimals)`, in BigInt throughout, dividing
 * half-up on a negative net exponent — the same representation choice as the
 * Pyth adapter, and for the same reason: the reference feeds a guard, so
 * nearest-value is the honest scaling.
 */
export function scaleAnswer(answer: bigint, feedDecimals: number, toDecimals: number): bigint {
  const shift = toDecimals - feedDecimals;
  if (shift >= 0) return answer * 10n ** BigInt(shift);
  const divisor = 10n ** BigInt(-shift);
  const half = divisor / 2n;
  return (answer + half) / divisor;
}
