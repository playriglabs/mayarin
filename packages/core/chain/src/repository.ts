/**
 * Chain persistence ports.
 *
 * Two idempotency guarantees live here, and both are enforced by a unique
 * index rather than by application logic: one deposit address per clearing
 * transaction, and one row per `(chain, txHash, logIndex)`.
 */

import type { AssetCode, Money } from "@mayarin/shared";
import type {
  ChainId,
  Deposit,
  DepositAddress,
  DepositStatus,
  TransferLog,
  WatchedAddress,
} from "./types.ts";

export interface AllocateDepositAddress {
  readonly clearingTransactionId: string;
  readonly chain: ChainId;
  readonly asset: AssetCode;
  readonly deriver: { derive(index: number): string };
  readonly now: Date;
}

export interface DepositAddressRepository {
  /**
   * Allocates the next derivation index and stores the derived address.
   * Idempotent: a second call for the same clearing transaction returns the
   * address already allocated, so a replayed PRICE_LOCKED step cannot hand a
   * payer a second address.
   */
  allocate(input: AllocateDepositAddress): Promise<DepositAddress>;
  findByClearingTransactionId(clearingTransactionId: string): Promise<DepositAddress | null>;
  /**
   * Addresses to scan. Non-terminal transactions are `fundable`; those that
   * went terminal since `retainTerminalSince` are returned unfundable, so a
   * late transfer is still recorded rather than lost.
   */
  listWatched(chain: ChainId, retainTerminalSince: Date): Promise<WatchedAddress[]>;
}

export interface DepositStatusUpdate {
  readonly id: string;
  readonly status: DepositStatus;
  readonly at: Date;
}

export interface DepositRepository {
  /** Upsert on `(chain, txHash, logIndex)`. Replaying a log cannot double-count. */
  record(transfers: readonly TransferLog[], now: Date): Promise<Deposit[]>;
  /** Non-terminal or recently-confirmed deposits worth re-probing, oldest first. */
  listProbable(chain: ChainId, limit: number): Promise<Deposit[]>;
  updateStatuses(updates: readonly DepositStatusUpdate[]): Promise<void>;
  listByAddress(chain: ChainId, address: string): Promise<Deposit[]>;
  /** Sum of CONFIRMED deposits at an address. The number the funding rule uses. */
  confirmedTotal(chain: ChainId, address: string, asset: AssetCode): Promise<Money>;
}

export interface WatcherCursorRepository {
  get(chain: ChainId, asset: AssetCode): Promise<bigint | null>;
  set(chain: ChainId, asset: AssetCode, block: bigint): Promise<void>;
}
