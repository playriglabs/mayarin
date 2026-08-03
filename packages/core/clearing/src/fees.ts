/**
 * Fee policy port.
 *
 * Pricing is a business decision that changes far more often than clearing
 * logic, so it is injected. Phase 1 ships a flat basis-point policy.
 */

import { type Money, multiplyByBasisPoints, ValidationError } from "@mayarin/shared";

export interface FeeContext {
  readonly merchantId: string;
  readonly provider: string;
}

export interface FeePolicy {
  /** Fee to retain, denominated in the same asset as `amount`. */
  feeFor(amount: Money, context: FeeContext): Money;
}

export class BasisPointsFeePolicy implements FeePolicy {
  readonly #basisPoints: number;

  constructor(basisPoints: number) {
    if (!Number.isInteger(basisPoints) || basisPoints < 0 || basisPoints > 10_000) {
      throw new ValidationError("Fee basis points must be an integer between 0 and 10000", {
        basisPoints,
      });
    }
    this.#basisPoints = basisPoints;
  }

  feeFor(amount: Money): Money {
    return multiplyByBasisPoints(amount, this.#basisPoints);
  }
}

/** Charges nothing. Useful for tests and for merchants on a zero-fee plan. */
export const zeroFeePolicy: FeePolicy = {
  feeFor: (amount) => ({ amount: 0n, asset: amount.asset }),
};
