/**
 * Fee policy port.
 *
 * Pricing is a business decision that changes far more often than clearing
 * logic, so it is injected. The shipped policy is a basis-point rate with an
 * optional floor.
 */

import {
  fromDecimalString,
  type Money,
  multiplyByBasisPoints,
  ValidationError,
} from "@mayarin/shared";

export interface FeeContext {
  readonly merchantId: string;
  readonly provider: string;
}

export interface FeePolicy {
  /** Fee to retain, denominated in the same asset as `amount`. */
  feeFor(amount: Money, context: FeeContext): Money;
}

/** Whole units with at most two decimals — `"0.10"` — which every asset holds. */
const MINIMUM_PATTERN = /^\d+(\.\d{1,2})?$/;

export class BasisPointsFeePolicy implements FeePolicy {
  readonly #basisPoints: number;
  readonly #minimum: string;

  /**
   * `minimum` is in whole units of whatever asset the fee is taken in, so one
   * value serves USDC and EURC alike. It exists because the rate is a
   * percentage and gas is not: without a floor, a small payment costs more to
   * execute than it earns. `"0"` is no floor.
   */
  constructor(basisPoints: number, minimum = "0") {
    if (!Number.isInteger(basisPoints) || basisPoints < 0 || basisPoints > 10_000) {
      throw new ValidationError("Fee basis points must be an integer between 0 and 10000", {
        basisPoints,
      });
    }
    if (!MINIMUM_PATTERN.test(minimum)) {
      throw new ValidationError("Fee minimum must be a decimal amount with at most two decimals", {
        minimum,
      });
    }
    this.#basisPoints = basisPoints;
    this.#minimum = minimum;
  }

  feeFor(amount: Money): Money {
    const fee = multiplyByBasisPoints(amount, this.#basisPoints);
    const minimum = fromDecimalString(this.#minimum, amount.asset);
    return fee.amount >= minimum.amount ? fee : minimum;
  }
}

/** Charges nothing. Useful for tests and for merchants on a zero-fee plan. */
export const zeroFeePolicy: FeePolicy = {
  feeFor: (amount) => ({ amount: 0n, asset: amount.asset }),
};
