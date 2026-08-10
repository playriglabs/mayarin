/**
 * Quote lock (RFC #6, second increment — #39).
 *
 * The hard lock is the merchant's settlement amount: `minOut` equals it
 * exactly, because the contract pays the merchant `minOut − fee` and the
 * merchant's payout must not move with the market. The slippage bound
 * therefore applies to the *payer's* side: the display estimate is grossed up
 * so that even a swap filling `slippageBps` worse than the executable rate
 * still clears `minOut`. Reducing `minOut` by the slippage bound instead would
 * hand the price risk back to the merchant — the exact inversion the contract
 * path exists to prevent.
 *
 * The payer amount is a display estimate, never a custody lock — the contract
 * swaps whatever arrives. The type says so: `PayerEstimate` is tagged
 * `"display-estimate"`, so it cannot be passed where a locked amount is
 * expected without the compiler objecting.
 *
 * Every rounding decision here favours covering `minOut` (ceilings on the
 * payer side); no float, no `Math`, no `Date.now()` — time is the caller's.
 */

import {
  assetDecimals,
  ConfigurationError,
  type Money,
  money,
  RATE_SCALE,
  ValidationError,
} from "@mayarin/shared";
import type { ComposedQuote } from "./engine.ts";

/** The payer-side amount shown at checkout. An estimate — never a lock. */
export interface PayerEstimate {
  readonly kind: "display-estimate";
  readonly amount: Money;
}

/** An immutable, deadline-bounded lock: the input to order assembly (#40). */
export interface LockedQuote {
  readonly payerAsset: Money["asset"];
  readonly settlementAsset: Money["asset"];
  /** The merchant's hard lock, gross — the contract splits `fee` out of it. */
  readonly minOut: Money;
  readonly fee: Money;
  readonly payerEstimate: PayerEstimate;
  readonly executableRate: bigint;
  readonly executableSource: string;
  readonly referenceSource: string;
  readonly slippageBps: number;
  readonly lockedAt: Date;
  readonly deadline: Date;
}

export interface LockTerms {
  /** The merchant's settlement amount (gross), from their fiat price. */
  readonly settlementAmount: Money;
  /** Mayarin's fee, in the settlement asset; split out on-chain. */
  readonly fee: Money;
  /** Tolerated fill degradation for the payer estimate, 0 ≤ bps < 10_000. */
  readonly slippageBps: number;
  /** How long the lock is honoured, > 0. Bounds the order `deadline`. */
  readonly ttlSeconds: number;
}

/**
 * Locks a guarded quote. `now` comes from the caller's injected `Clock`; the
 * lock is valid while `now ≤ deadline` — the same inclusive comparison the
 * contract's `deadline` check makes on `block.timestamp`.
 */
export function lockQuote(composed: ComposedQuote, terms: LockTerms, now: Date): LockedQuote {
  if (terms.slippageBps < 0 || terms.slippageBps >= 10_000) {
    throw new ConfigurationError(`Slippage must be 0 ≤ bps < 10_000, got ${terms.slippageBps}`, {
      slippageBps: terms.slippageBps,
    });
  }
  if (terms.ttlSeconds <= 0) {
    throw new ConfigurationError(`Lock TTL must be positive, got ${terms.ttlSeconds}`, {
      ttlSeconds: terms.ttlSeconds,
    });
  }
  if (terms.settlementAmount.asset !== composed.to || terms.fee.asset !== composed.to) {
    throw new ConfigurationError(
      `Lock terms must be in the composed settlement asset ${composed.to}`,
      {
        settlementAsset: terms.settlementAmount.asset,
        feeAsset: terms.fee.asset,
        composedTo: composed.to,
      },
    );
  }
  if (terms.settlementAmount.amount <= 0n) {
    throw new ValidationError("Settlement amount must be positive", {
      settlementAmount: terms.settlementAmount.amount.toString(),
    });
  }
  if (terms.fee.amount < 0n || terms.fee.amount >= terms.settlementAmount.amount) {
    throw new ValidationError("Fee must leave the merchant a positive net amount", {
      fee: terms.fee.amount.toString(),
      settlementAmount: terms.settlementAmount.amount.toString(),
    });
  }

  return {
    payerAsset: composed.from,
    settlementAsset: composed.to,
    minOut: terms.settlementAmount,
    fee: terms.fee,
    payerEstimate: payerEstimate(composed, terms.settlementAmount, terms.slippageBps),
    executableRate: composed.executable.scaledRate,
    executableSource: composed.executable.source,
    referenceSource: composed.reference.source,
    slippageBps: terms.slippageBps,
    lockedAt: new Date(now),
    deadline: new Date(now.getTime() + terms.ttlSeconds * 1_000),
  };
}

/**
 * What the payer sends to cover `settlementAmount` at the composed rate.
 *
 * Exposed separately from `lockQuote` because an indicative quote needs this
 * number without a lock: no deadline, no fee, nothing signed. A preview that
 * derives it any other way is a preview that disagrees with the charge.
 */
export function payerEstimate(
  composed: ComposedQuote,
  settlementAmount: Money,
  slippageBps: number,
): PayerEstimate {
  return {
    kind: "display-estimate",
    amount: money(
      payerEstimateMinor(
        settlementAmount.amount,
        composed.executable.scaledRate,
        assetDecimals(composed.from),
        slippageBps,
      ),
      composed.from,
    ),
  };
}

/** Valid while `now ≤ deadline`; expired strictly after it. */
export function isExpired(lock: LockedQuote, now: Date): boolean {
  return now.getTime() > lock.deadline.getTime();
}

/**
 * Payer minor units whose worst-tolerated fill still covers `minOut`:
 * `ceil(minOut × 10^payerDecimals × RATE_SCALE / scaledRate)`, grossed up by
 * `ceil(x × 10_000 / (10_000 − slippageBps))`. Both roundings are ceilings —
 * shorting the estimate would quote a payment the contract then reverts.
 *
 * `RATE_SCALE` multiplies into the numerator here, where `convert` divides it
 * out. This is the inverse direction: `convert` multiplies by the rate, and
 * this divides by it, so the scale has to move the other way or the estimate
 * comes out 10^RATE_DECIMALS too small.
 */
function payerEstimateMinor(
  minOutMinor: bigint,
  scaledRate: bigint,
  payerDecimals: number,
  slippageBps: number,
): bigint {
  const exact = divideCeil(minOutMinor * 10n ** BigInt(payerDecimals) * RATE_SCALE, scaledRate);
  return divideCeil(exact * 10_000n, BigInt(10_000 - slippageBps));
}

function divideCeil(numerator: bigint, denominator: bigint): bigint {
  return (numerator + denominator - 1n) / denominator;
}
