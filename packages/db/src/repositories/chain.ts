/**
 * Drizzle chain repositories.
 *
 * Two uniqueness guarantees are the database's, not the application's: one
 * address per clearing transaction, and one deposit row per
 * `(chain, tx_hash, log_index)`. Both are expressed as `ON CONFLICT DO NOTHING`
 * followed by a read, so a concurrent writer loses the race harmlessly rather
 * than raising.
 */

import type {
  AllocateDepositAddress,
  ChainId,
  Deposit,
  DepositAddress,
  DepositAddressRepository,
  DepositRepository,
  DepositStatus,
  DepositStatusUpdate,
  SettlementEvent,
  SettlementEventRepository,
  SettlementLog,
  SettlementStatusUpdate,
  TransferLog,
  WatchedAddress,
  WatcherCursorRepository,
} from "@mayarin/chain";
import { isChainId } from "@mayarin/chain";
import {
  type AssetCode,
  ConflictError,
  generateId,
  type Money,
  ValidationError,
  zero,
} from "@mayarin/shared";
import { and, asc, eq, gte, inArray, isNull, ne, or, sql } from "drizzle-orm";
import type { Database } from "../client.ts";
import { present, toAsset, toMoney } from "../mapping.ts";
import {
  chainDeposits,
  clearingTransactions,
  depositAddresses,
  settlementEvents,
  watcherCursors,
} from "../schema.ts";

const TERMINAL_STATES = ["SUCCESS", "FAILED"] as const;

export class DrizzleDepositAddressRepository implements DepositAddressRepository {
  readonly #db: Database;

  constructor(db: Database) {
    this.#db = db;
  }

  async allocate(input: AllocateDepositAddress): Promise<DepositAddress> {
    const existing = await this.findByClearingTransactionId(input.clearingTransactionId);
    if (existing !== null) return existing;

    // The sequence is the allocator: concurrent callers get distinct indices
    // without a lock, and a rolled-back transaction merely skips one.
    const [row] = await this.#db.execute<{ nextval: string }>(
      sql`select nextval('deposit_address_index_seq') as nextval`,
    );
    if (row === undefined) {
      throw new ConflictError("Could not allocate a deposit derivation index", {
        clearingTransactionId: input.clearingTransactionId,
      });
    }

    const derivationIndex = Number(row.nextval);
    const address: DepositAddress = {
      id: generateId("dad", input.now.getTime()),
      clearingTransactionId: input.clearingTransactionId,
      derivationIndex,
      chain: input.chain,
      asset: input.asset,
      address: input.deriver.derive(derivationIndex).toLowerCase(),
      createdAt: new Date(input.now),
    };

    await this.#db
      .insert(depositAddresses)
      .values({
        id: address.id,
        clearingTransactionId: address.clearingTransactionId,
        derivationIndex: address.derivationIndex,
        chain: address.chain,
        asset: address.asset,
        address: address.address,
        createdAt: address.createdAt,
      })
      .onConflictDoNothing();

    // A concurrent allocation for the same transaction wins; read back rather
    // than assume ours landed.
    const stored = await this.findByClearingTransactionId(input.clearingTransactionId);
    if (stored === null) {
      throw new ConflictError("Deposit address allocation did not persist", {
        clearingTransactionId: input.clearingTransactionId,
      });
    }
    return stored;
  }

  async findByClearingTransactionId(clearingTransactionId: string): Promise<DepositAddress | null> {
    const [row] = await this.#db
      .select()
      .from(depositAddresses)
      .where(eq(depositAddresses.clearingTransactionId, clearingTransactionId))
      .limit(1);

    return row === undefined ? null : toDepositAddress(row);
  }

  async listWatched(chain: ChainId, retainTerminalSince: Date): Promise<WatchedAddress[]> {
    const rows = await this.#db
      .select({
        clearingTransactionId: depositAddresses.clearingTransactionId,
        chain: depositAddresses.chain,
        asset: depositAddresses.asset,
        address: depositAddresses.address,
        depositAmount: clearingTransactions.depositAmount,
        depositAsset: clearingTransactions.depositAsset,
        state: clearingTransactions.state,
      })
      .from(depositAddresses)
      .innerJoin(
        clearingTransactions,
        eq(depositAddresses.clearingTransactionId, clearingTransactions.id),
      )
      .where(
        and(
          eq(depositAddresses.chain, chain),
          or(
            // Still in flight, or terminal but inside the retention window.
            sql`${clearingTransactions.state} not in ${TERMINAL_STATES}`,
            // `gte`, not a `sql` template: an interpolated value in a template
            // is bound raw, without the column's type mapping, so a `Date`
            // reaches the driver as a `Date` and fails to serialize. Every
            // watcher tick called this.
            gte(clearingTransactions.updatedAt, retainTerminalSince),
          ),
        ),
      );

    return rows.flatMap((row) => {
      if (row.depositAmount === null || row.depositAsset === null) return [];
      if (!isChainId(row.chain)) return [];
      return [
        {
          clearingTransactionId: row.clearingTransactionId,
          chain: row.chain,
          asset: toAsset(row.asset),
          address: row.address,
          requiredAmount: toMoney(row.depositAmount, row.depositAsset),
          fundable: !(TERMINAL_STATES as readonly string[]).includes(row.state),
        },
      ];
    });
  }
}

export class DrizzleDepositRepository implements DepositRepository {
  readonly #db: Database;

  constructor(db: Database) {
    this.#db = db;
  }

  async record(transfers: readonly TransferLog[], now: Date): Promise<Deposit[]> {
    if (transfers.length === 0) return [];

    await this.#db
      .insert(chainDeposits)
      .values(
        transfers.map((transfer) => ({
          id: generateId("dep", now.getTime()),
          chain: transfer.chain,
          txHash: transfer.txHash,
          logIndex: transfer.logIndex,
          address: transfer.to.toLowerCase(),
          asset: transfer.asset,
          amount: transfer.amount.toString(),
          blockNumber: transfer.blockNumber.toString(),
          blockHash: transfer.blockHash,
          status: "PENDING" satisfies DepositStatus,
          firstSeenAt: new Date(now),
        })),
      )
      .onConflictDoNothing();

    const rows = await this.#db
      .select()
      .from(chainDeposits)
      .where(
        inArray(
          chainDeposits.txHash,
          transfers.map((transfer) => transfer.txHash),
        ),
      );

    return rows.map(toDeposit);
  }

  async listProbable(chain: ChainId, limit: number): Promise<Deposit[]> {
    const rows = await this.#db
      .select()
      .from(chainDeposits)
      .where(and(eq(chainDeposits.chain, chain), sql`${chainDeposits.status} <> 'ORPHANED'`))
      .orderBy(asc(chainDeposits.blockNumber))
      .limit(limit);

    return rows.map(toDeposit);
  }

  async updateStatuses(updates: readonly DepositStatusUpdate[]): Promise<void> {
    for (const update of updates) {
      await this.#db
        .update(chainDeposits)
        .set({
          status: update.status,
          ...(update.status === "CONFIRMED" ? { confirmedAt: new Date(update.at) } : {}),
          ...(update.status === "ORPHANED" ? { orphanedAt: new Date(update.at) } : {}),
        })
        .where(eq(chainDeposits.id, update.id));
    }
  }

  async listByAddress(chain: ChainId, address: string): Promise<Deposit[]> {
    const rows = await this.#db
      .select()
      .from(chainDeposits)
      .where(and(eq(chainDeposits.chain, chain), eq(chainDeposits.address, address.toLowerCase())))
      .orderBy(asc(chainDeposits.blockNumber));

    return rows.map(toDeposit);
  }

  async confirmedTotal(chain: ChainId, address: string, asset: AssetCode): Promise<Money> {
    return this.#total(chain, address, asset, (status) => status === "CONFIRMED");
  }

  async recordedTotal(chain: ChainId, address: string, asset: AssetCode): Promise<Money> {
    // Everything the chain still holds for us, confirmed or not. An orphaned
    // deposit is excluded because the chain no longer holds it either.
    return this.#total(chain, address, asset, (status) => status !== "ORPHANED");
  }

  async #total(
    chain: ChainId,
    address: string,
    asset: AssetCode,
    keep: (status: DepositStatus) => boolean,
  ): Promise<Money> {
    const deposits = await this.listByAddress(chain, address);
    return deposits
      .filter((deposit) => keep(deposit.status) && deposit.amount.asset === asset)
      .reduce<Money>(
        (total, deposit) => ({ amount: total.amount + deposit.amount.amount, asset }),
        zero(asset),
      );
  }
}

export class DrizzleWatcherCursorRepository implements WatcherCursorRepository {
  readonly #db: Database;

  constructor(db: Database) {
    this.#db = db;
  }

  async get(chain: ChainId, stream: string): Promise<bigint | null> {
    const [row] = await this.#db
      .select()
      .from(watcherCursors)
      .where(and(eq(watcherCursors.chain, chain), eq(watcherCursors.asset, stream)))
      .limit(1);

    return row === undefined ? null : BigInt(row.lastBlock);
  }

  async set(chain: ChainId, stream: string, block: bigint): Promise<void> {
    await this.#db
      .insert(watcherCursors)
      .values({
        chain,
        asset: stream,
        lastBlock: block.toString(),
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [watcherCursors.chain, watcherCursors.asset],
        set: { lastBlock: block.toString(), updatedAt: new Date() },
      });
  }
}

function toDepositAddress(row: typeof depositAddresses.$inferSelect): DepositAddress {
  if (!isChainId(row.chain)) {
    throw new ValidationError(`Stored chain "${row.chain}" is not supported`, {
      chain: row.chain,
    });
  }
  return {
    id: row.id,
    clearingTransactionId: row.clearingTransactionId,
    derivationIndex: row.derivationIndex,
    chain: row.chain,
    asset: toAsset(row.asset),
    address: row.address,
    createdAt: row.createdAt,
  };
}

function toDeposit(row: typeof chainDeposits.$inferSelect): Deposit {
  if (!isChainId(row.chain)) {
    throw new ValidationError(`Stored chain "${row.chain}" is not supported`, {
      chain: row.chain,
    });
  }
  return {
    id: row.id,
    chain: row.chain,
    txHash: row.txHash,
    logIndex: row.logIndex,
    address: row.address,
    amount: toMoney(row.amount, row.asset),
    blockNumber: BigInt(row.blockNumber),
    blockHash: row.blockHash,
    status: row.status as DepositStatus,
    firstSeenAt: row.firstSeenAt,
    ...(row.confirmedAt === null ? {} : { confirmedAt: row.confirmedAt }),
    ...(row.orphanedAt === null ? {} : { orphanedAt: row.orphanedAt }),
  };
}

/**
 * Settlement events read from a `PaymentRouter` (#8).
 *
 * `record` upserts on `(chain, tx_hash, log_index)` and deliberately does
 * nothing on conflict: a re-scanned range must not reset a status that
 * reclassification already moved forward.
 */
export class DrizzleSettlementEventRepository implements SettlementEventRepository {
  readonly #db: Database;

  constructor(db: Database) {
    this.#db = db;
  }

  async record(logs: readonly SettlementLog[], now: Date): Promise<SettlementEvent[]> {
    if (logs.length === 0) return [];

    await this.#db
      .insert(settlementEvents)
      .values(
        logs.map((log) => ({
          id: generateId("stl", now.getTime()),
          chain: log.chain,
          txHash: log.txHash,
          logIndex: log.logIndex,
          blockNumber: log.blockNumber.toString(),
          blockHash: log.blockHash,
          intentId: log.intentId,
          merchantSafe: log.merchantSafe,
          settledAmount: log.settledAmount.toString(),
          fee: log.fee.toString(),
          refundAmount: log.refundAmount.toString(),
          status: "PENDING",
          firstSeenAt: now,
        })),
      )
      .onConflictDoNothing({
        target: [settlementEvents.chain, settlementEvents.txHash, settlementEvents.logIndex],
      });

    const rows = await this.#db
      .select()
      .from(settlementEvents)
      .where(
        inArray(
          settlementEvents.txHash,
          logs.map((log) => log.txHash),
        ),
      );

    return rows.map(toSettlementEvent);
  }

  async listProbable(chain: ChainId, limit: number): Promise<SettlementEvent[]> {
    const rows = await this.#db
      .select()
      .from(settlementEvents)
      .where(and(eq(settlementEvents.chain, chain), ne(settlementEvents.status, "ORPHANED")))
      .orderBy(asc(settlementEvents.blockNumber))
      .limit(limit);

    return rows.map(toSettlementEvent);
  }

  async updateStatuses(updates: readonly SettlementStatusUpdate[]): Promise<void> {
    for (const update of updates) {
      await this.#db
        .update(settlementEvents)
        .set({
          status: update.status,
          ...(update.status === "CONFIRMED" ? { confirmedAt: update.at } : {}),
          ...(update.status === "ORPHANED" ? { orphanedAt: update.at } : {}),
        })
        .where(eq(settlementEvents.id, update.id));
    }
  }

  async listCompletable(chain: ChainId, limit: number): Promise<SettlementEvent[]> {
    const rows = await this.#db
      .select()
      .from(settlementEvents)
      .where(
        and(
          eq(settlementEvents.chain, chain),
          eq(settlementEvents.status, "CONFIRMED"),
          isNull(settlementEvents.completedAt),
        ),
      )
      .orderBy(asc(settlementEvents.blockNumber))
      .limit(limit);

    return rows.map(toSettlementEvent);
  }

  async markCompleted(id: string, at: Date): Promise<void> {
    await this.#db
      .update(settlementEvents)
      .set({ completedAt: at })
      .where(eq(settlementEvents.id, id));
  }

  async findByIntentId(intentId: string): Promise<SettlementEvent | null> {
    const [row] = await this.#db
      .select()
      .from(settlementEvents)
      .where(eq(settlementEvents.intentId, intentId))
      .limit(1);

    return row === undefined ? null : toSettlementEvent(row);
  }

  async listByIntentIds(intentIds: readonly string[]): Promise<readonly SettlementEvent[]> {
    // `inArray` with an empty list is invalid SQL in Postgres, and a merchant
    // with no on-chain settlements is the ordinary case, not an error.
    if (intentIds.length === 0) return [];
    const rows = await this.#db
      .select()
      .from(settlementEvents)
      .where(inArray(settlementEvents.intentId, [...intentIds]));

    return rows.map(toSettlementEvent);
  }
}

function toSettlementEvent(row: typeof settlementEvents.$inferSelect): SettlementEvent {
  return {
    id: row.id,
    chain: row.chain as ChainId,
    txHash: row.txHash,
    logIndex: row.logIndex,
    blockNumber: BigInt(row.blockNumber),
    blockHash: row.blockHash,
    intentId: row.intentId,
    merchantSafe: row.merchantSafe,
    settledAmount: BigInt(row.settledAmount),
    fee: BigInt(row.fee),
    refundAmount: BigInt(row.refundAmount),
    status: row.status as DepositStatus,
    firstSeenAt: row.firstSeenAt,
    ...present("confirmedAt", row.confirmedAt),
    ...present("orphanedAt", row.orphanedAt),
    ...present("completedAt", row.completedAt),
  };
}
