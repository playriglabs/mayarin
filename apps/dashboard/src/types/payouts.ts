/** Batch payouts (#295) — the dashboard API's wire shapes. */

import type { MoneyDto } from "@/types/payment";

export interface PayoutRowDto {
  readonly line: number;
  readonly to: string;
  readonly amount: MoneyDto;
  readonly note: string | null;
}

export interface PayoutRowError {
  readonly line: number;
  readonly message: string;
}

/**
 * What the wallet sends. `from` is set for a Safe batch (only its owner can send
 * it) and absent for a wallet batch, which any connected wallet may send.
 */
export interface PayoutTransactionDto {
  readonly from?: string;
  readonly to: string;
  readonly data: string;
}

/** `safe`: the managed Safe, via its owner. `wallet`: any connected wallet, its own balance. */
export type PayoutSource = "safe" | "wallet";

/** An allowance the paying wallet must grant `PayoutBatcher` before a wallet batch. */
export interface PayoutApprovalDto {
  readonly asset: string;
  readonly token: string;
  /** Minor units: the batch total in this token. */
  readonly amount: string;
  /** `approve(batcher, amount)` calldata. */
  readonly data: string;
}

export interface PayoutRequest {
  readonly chain: string;
  readonly source: PayoutSource;
  readonly csv: string;
}

export interface PreparePayoutResponse {
  readonly rows: readonly PayoutRowDto[];
  readonly errors: readonly PayoutRowError[];
  readonly totals: readonly MoneyDto[];
  /** `null` while any row has an error. */
  readonly transaction: PayoutTransactionDto | null;
  /** Wallet batches only: check each allowance, approve where it falls short. */
  readonly approvals: readonly PayoutApprovalDto[];
}

export interface PayoutBatchDto {
  readonly id: string;
  readonly chain: string;
  readonly sourceAddress: string;
  readonly submittedBy: string;
  readonly transactionHash: string;
  readonly rows: readonly PayoutRowDto[];
  /** One per asset, in the order each first appears. */
  readonly totals: readonly MoneyDto[];
  readonly completedAt: string;
}

export interface PayoutBatchResponse {
  readonly batch: PayoutBatchDto;
}

export interface PayoutHistoryResponse {
  readonly batches: readonly PayoutBatchDto[];
  readonly nextCursor: string | null;
}
