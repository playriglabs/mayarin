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
  SettlementEvent,
  SettlementLog,
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
  /**
   * Sum of every deposit at an address that has not been orphaned.
   *
   * What the balance reconciliation subtracts from: it asks "how much of what
   * this address holds have we already accounted for", and a PENDING deposit is
   * accounted for — counting only CONFIRMED ones would record the same value a
   * second time in the window before it confirms. An ORPHANED one is excluded
   * because the chain no longer holds it either.
   */
  recordedTotal(chain: ChainId, address: string, asset: AssetCode): Promise<Money>;
}

/**
 * How far a scan has read.
 *
 * `stream` names what is being scanned. The wallet watcher scans one asset at a
 * time and passes its `AssetCode`; the settlement indexer scans one router and
 * passes its address. A plain string rather than a union because the set is
 * open — the column has always been text, so this widens the port to what the
 * storage already allowed.
 */
export interface WatcherCursorRepository {
  get(chain: ChainId, stream: string): Promise<bigint | null>;
  set(chain: ChainId, stream: string, block: bigint): Promise<void>;
}

export interface SettlementStatusUpdate {
  readonly id: string;
  readonly status: DepositStatus;
  readonly at: Date;
}

export interface SettlementEventRepository {
  /**
   * Upsert on `(chain, txHash, logIndex)` — the key the log envelope itself
   * provides, so replaying a range cannot record a settlement twice.
   */
  record(logs: readonly SettlementLog[], now: Date): Promise<SettlementEvent[]>;
  /** Non-terminal or recently-confirmed settlements worth re-probing, oldest first. */
  listProbable(chain: ChainId, limit: number): Promise<SettlementEvent[]>;
  updateStatuses(updates: readonly SettlementStatusUpdate[]): Promise<void>;
  /** CONFIRMED settlements the engine has not been told about yet. */
  listCompletable(chain: ChainId, limit: number): Promise<SettlementEvent[]>;
  /** Marks a settlement as handed to the engine, so it is never replayed. */
  markCompleted(id: string, at: Date): Promise<void>;
  findByIntentId(intentId: string): Promise<SettlementEvent | null>;
  /**
   * The settlements behind a page of on-chain intent ids, in one round trip.
   *
   * What a merchant-facing settlement listing needs: it already holds the page
   * of payments and wants the chain's word on each. Ids with no settlement are
   * absent rather than null-padded — the caller indexes by `intentId` anyway.
   */
  listByIntentIds(intentIds: readonly string[]): Promise<readonly SettlementEvent[]>;
}
