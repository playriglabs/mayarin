/**
 * Batch payouts (#295).
 *
 * A merchant pays many recipients in one transaction, from one of two sources:
 * their managed Safe (submitted by an owner key at threshold 1), or any wallet
 * they connect, paying from its own balance through `PayoutBatcher`.
 * **Mayarin never signs a payout** — it prepares the calldata and afterwards
 * reads the chain back to record what moved. That keeps the custody boundary
 * exactly where `WalletProvider` put it: the managed signer can still only
 * withdraw to the merchant's own verified wallets, so a stolen dashboard
 * session still cannot pay anybody.
 */

import type { ChainId } from "@mayarin/chain";
import type { Money } from "@mayarin/shared";

/**
 * Where a batch is paid from. `safe`: the merchant's managed Safe, submitted by
 * its owner key. `wallet`: whichever wallet is connected, from its own balance.
 */
export const PAYOUT_SOURCES = ["safe", "wallet"] as const;

export type PayoutSource = (typeof PAYOUT_SOURCES)[number];

/** One recipient, as the merchant's file named them. */
export interface PayoutRow {
  /** 1-based line in the uploaded file, so an error can point at it. */
  readonly line: number;
  /** Lowercase `0x`-prefixed. */
  readonly to: string;
  readonly amount: Money;
  readonly note?: string;
}

export interface PayoutRowError {
  readonly line: number;
  readonly message: string;
}

export interface ParsedPayouts {
  readonly rows: readonly PayoutRow[];
  readonly errors: readonly PayoutRowError[];
}

/**
 * An ERC-20 `Transfer` as the chain logged it. The only evidence a payout is
 * recorded from: the merchant's claim that they paid is not one.
 */
export interface ObservedTransfer {
  readonly from: string;
  readonly to: string;
  readonly amount: Money;
}

/** A batch the chain confirmed, row for row. Append-only, like a withdrawal. */
export interface PayoutBatch {
  readonly id: string;
  readonly merchantId: string;
  readonly chain: ChainId;
  /** Where the money left: the managed Safe, or the wallet that paid directly. */
  readonly sourceAddress: string;
  /** The account that sent the transaction — the Safe's owner, or the paying wallet itself. */
  readonly submittedBy: string;
  readonly transactionHash: string;
  readonly rows: readonly PayoutRow[];
  readonly completedAt: Date;
}
