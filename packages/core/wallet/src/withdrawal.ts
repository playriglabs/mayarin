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

export interface WalletWithdrawalRepository {
  insert(withdrawal: WalletWithdrawal): Promise<void>;
  listRecent(merchantId: string, limit: number): Promise<readonly WalletWithdrawal[]>;
}
