/**
 * Settlement wire types, mirrored from the dashboard API DTO (#15).
 *
 * Three amounts that are easy to conflate and must not be: `settlementAmount`
 * is the payment priced in the settlement asset, `fee` is what Mayarin takes,
 * `netAmount` is what the merchant receives. `onChain` is none of them — it is
 * what the chain reported actually moved, reported alongside so a discrepancy
 * stays visible instead of being overwritten.
 */

import type { MoneyDto } from "@/types/payment";

export interface OnChainAmounts {
  readonly settledAmount: MoneyDto;
  readonly fee: MoneyDto;
  readonly refundAmount: MoneyDto;
}

export interface SettlementChainRecord {
  readonly chain: string;
  readonly txHash: string;
  readonly blockNumber: string;
  readonly status: string;
  readonly firstSeenAt: string;
  readonly confirmedAt: string | null;
  /** Set when the log was reorged away. With `confirmedAt`, needs a human. */
  readonly orphanedAt: string | null;
}

export interface SettlementDto {
  readonly paymentIntentId: string;
  readonly clearingTransactionId: string;
  readonly state: string;
  /** What the buyer was charged, in the merchant's own currency. */
  readonly sourceAmount: MoneyDto;
  readonly settlementAsset: string;
  readonly settlementAmount: MoneyDto | null;
  readonly fee: MoneyDto | null;
  readonly netAmount: MoneyDto | null;
  readonly destination: string | null;
  readonly reference: string | null;
  readonly provider: string;
  readonly executionPath: string | null;
  readonly onChain: OnChainAmounts | null;
  /**
   * The rail the payer paid on. Present whenever a rail was chosen, unlike
   * `chain`, which exists only for a settlement with an on-chain log.
   */
  readonly payment: { readonly asset: string; readonly chain: string } | null;
  readonly chain: SettlementChainRecord | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  /** The intent's expiry: past it, a non-terminal row is abandoned, not moving. */
  readonly expiresAt: string;
  readonly completedAt: string | null;
}

export interface SettlementListResponse {
  readonly settlements: readonly SettlementDto[];
  readonly nextCursor: string | null;
  readonly summary: {
    readonly settledCount: number;
    readonly inFlightCount: number;
    readonly failedCount: number;
    readonly asset: string | null;
    readonly netAmount: MoneyDto | null;
    readonly fee: MoneyDto | null;
  };
}
