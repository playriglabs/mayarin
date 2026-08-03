/**
 * Confirmation and reorg policy.
 *
 * Pure functions over numbers and hashes: no chain client, no repository, no
 * clock. Confirmation depth is the finality line — a deposit below it has
 * touched nothing and can vanish freely; at or above it, the deposit may fund a
 * payment, and losing it afterwards is a fact to record rather than a state to
 * undo.
 */

import type { DepositStatus } from "./types.ts";

export interface ConfirmationPolicy {
  /** Confirmations required before a deposit may fund a payment. */
  readonly depth: number;
  /**
   * How far past `depth` to keep probing for a reorg, as a multiple of it.
   * Bounds the work: past `depth * reorgWatchWindow` a deposit is final.
   */
  readonly reorgWatchWindow: number;
}

/** Confirmations counted inclusively: a deposit in the head block has one. */
export function confirmationsOf(blockNumber: bigint, headNumber: bigint): number {
  if (blockNumber > headNumber) return 0;
  return Number(headNumber - blockNumber) + 1;
}

export function isWithinReorgWatch(confirmations: number, policy: ConfirmationPolicy): boolean {
  return confirmations <= policy.depth * policy.reorgWatchWindow;
}

export interface ClassifyDepositInput {
  readonly current: DepositStatus;
  readonly blockNumber: bigint;
  /** Hash of the block the deposit was seen in. */
  readonly blockHash: string;
  readonly headNumber: bigint;
  /** Hash the chain currently reports at that height; `undefined` past the head. */
  readonly canonicalHash: string | undefined;
  readonly policy: ConfirmationPolicy;
}

export function classifyDeposit(input: ClassifyDepositInput): DepositStatus {
  // Orphaned is terminal: a block that left the canonical chain does not return
  // under the same hash, and re-confirming one would erase the audit trail.
  if (input.current === "ORPHANED") return "ORPHANED";

  // No hash to compare against means the chain has not reached that height yet
  // — during a deep reorg the head can briefly sit below a known deposit. That
  // is not evidence of an orphan, so hold at the current status: CONFIRMED is
  // the finality line, and a lagging or reorged RPC must not unwind it back to
  // PENDING on missing evidence alone.
  if (input.canonicalHash === undefined) return input.current;

  if (input.canonicalHash !== input.blockHash) return "ORPHANED";

  const confirmations = confirmationsOf(input.blockNumber, input.headNumber);
  return confirmations >= input.policy.depth ? "CONFIRMED" : "PENDING";
}
