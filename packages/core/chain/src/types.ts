/**
 * Chain layer types.
 *
 * A deposit is an *observation*, not a posting. Nothing here touches a ledger
 * account: the ledger entry for a funded payment is the clearing engine's
 * existing `assetReceivedPosting`, unchanged.
 */

import type { AssetCode, Money } from "@mayarin/shared";

/** EVM chains Phase 2A watches. Phase 2B widens this. */
export const CHAIN_IDS = ["base", "base-sepolia"] as const;

export type ChainId = (typeof CHAIN_IDS)[number];

export function isChainId(value: unknown): value is ChainId {
  return typeof value === "string" && (CHAIN_IDS as readonly string[]).includes(value);
}

/**
 * Numeric EVM chain ids. A chain fact, not deployment configuration — the
 * EIP-155 id of a chain is the same everywhere Mayarin runs, so it belongs
 * beside `CHAIN_IDS` rather than in any one deployment's config.
 */
export const EVM_CHAIN_IDS: Readonly<Record<ChainId, bigint>> = {
  base: 8_453n,
  "base-sepolia": 84_532n,
};

/** A block identified by both height and hash — the hash is what detects a reorg. */
export interface BlockRef {
  readonly number: bigint;
  readonly hash: string;
}

/** An ERC-20 `Transfer` as read from the chain, before any policy is applied. */
export interface TransferLog {
  readonly chain: ChainId;
  readonly asset: AssetCode;
  readonly txHash: string;
  readonly logIndex: number;
  readonly blockNumber: bigint;
  readonly blockHash: string;
  readonly from: string;
  readonly to: string;
  /** Raw token amount, in the asset's minor units. */
  readonly amount: bigint;
}

/**
 * Deposit lifecycle.
 *
 * `PENDING` has touched nothing and can still disappear. `CONFIRMED` is past
 * the configured depth and is the only status that can fund a payment.
 * `ORPHANED` was reorged away.
 */
export const DEPOSIT_STATUSES = ["PENDING", "CONFIRMED", "ORPHANED"] as const;

export type DepositStatus = (typeof DEPOSIT_STATUSES)[number];

export interface Deposit {
  readonly id: string;
  readonly chain: ChainId;
  readonly txHash: string;
  readonly logIndex: number;
  readonly address: string;
  readonly amount: Money;
  readonly blockNumber: bigint;
  readonly blockHash: string;
  readonly status: DepositStatus;
  readonly firstSeenAt: Date;
  readonly confirmedAt?: Date;
  readonly orphanedAt?: Date;
}

/** A deposit that was counted and then reorged away — the case needing a human. */
export function isOrphanedAfterConfirmed(deposit: Deposit): boolean {
  return deposit.confirmedAt !== undefined && deposit.orphanedAt !== undefined;
}

export interface DepositAddress {
  readonly id: string;
  readonly clearingTransactionId: string;
  /** BIP-32 index. Persisting it is what makes the address re-derivable. */
  readonly derivationIndex: number;
  readonly chain: ChainId;
  readonly asset: AssetCode;
  readonly address: string;
  readonly createdAt: Date;
}

/** An address the watcher scans for, joined to what its payment expects. */
export interface WatchedAddress {
  readonly clearingTransactionId: string;
  readonly chain: ChainId;
  readonly asset: AssetCode;
  readonly address: string;
  readonly requiredAmount: Money;
  /** False once the clearing transaction is terminal: still recorded, never funds. */
  readonly fundable: boolean;
}
