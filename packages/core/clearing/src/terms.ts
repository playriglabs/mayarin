/**
 * What a merchant pays and may move: the fee on a payment and the ceilings on
 * it. Stored per merchant and read at each price lock, so changing a row
 * changes the next payment without a deploy.
 *
 * Amounts are whole units of the settlement asset (`"0.10"`, `"1000"`), so one
 * value serves USDC and EURC alike, as `BasisPointsFeePolicy` takes its minimum.
 */

import type { Money } from "@mayarin/shared";
import { BasisPointsFeePolicy } from "./fees.ts";

export interface MerchantTerms {
  readonly feeBasisPoints: number;
  readonly feeMinimum: string;
  /** The most one payment may settle for. */
  readonly maxPaymentSettlement: string;
  /** The most the merchant may be priced for in a rolling 24 hours. */
  readonly maxDailySettlement: string;
}

export interface MerchantTermsRepository {
  /** Throws `NotFoundError` for an unknown merchant. */
  get(merchantId: string): Promise<MerchantTerms>;
  /** Replaces all four values; the next price lock reads them. */
  set(merchantId: string, terms: MerchantTerms): Promise<void>;
}

/** The fee `terms` charge on `amount`, in the same asset. */
export function feeUnder(terms: MerchantTerms, amount: Money): Money {
  return new BasisPointsFeePolicy(terms.feeBasisPoints, terms.feeMinimum).feeFor(amount);
}
