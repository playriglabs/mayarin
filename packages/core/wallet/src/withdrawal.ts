/**
 * Durable history of successful managed-wallet withdrawals.
 *
 * A withdrawal is append-only. The provider has already confirmed the chain
 * transaction before this record is created, so there is no mutable status
 * here that could drift from the transaction receipt.
 */

import type { ChainId } from "@mayarin/chain";
import type { Money } from "@mayarin/shared";

export interface WalletWithdrawal {
  readonly id: string;
  readonly merchantId: string;
  readonly chain: ChainId;
  /** The managed Safe funds moved out of. */
  readonly walletAddress: string;
  /** The merchant-controlled destination funds moved to. */
  readonly destinationAddress: string;
  readonly amount: Money;
  readonly transactionHash: string;
  readonly completedAt: Date;
}

/**
 * Where a page of history resumes: the last row the caller already saw.
 *
 * A keyset rather than an offset, and the id is carried alongside the timestamp
 * because two withdrawals can complete in the same millisecond — an offset over
 * an append-only table repeats or skips a row whenever one lands mid-read.
 */
export interface WalletWithdrawalCursor {
  readonly id: string;
  readonly completedAt: Date;
}

export interface WalletWithdrawalRepository {
  insert(withdrawal: WalletWithdrawal): Promise<void>;
  /**
   * Newest first, resuming after `cursor` when one is given.
   *
   * Ask for one more row than a page holds: the extra row is how the caller
   * knows there is a next page without a second count query.
   */
  listRecent(
    merchantId: string,
    limit: number,
    cursor?: WalletWithdrawalCursor,
  ): Promise<readonly WalletWithdrawal[]>;
}
