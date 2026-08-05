import { isChainId } from "@mayarin/chain";
import {
  type ClearingDeposit,
  type ClearingEvent,
  type ClearingEventType,
  type ClearingRepository,
  type ClearingState,
  type ClearingTransaction,
  TERMINAL_CLEARING_STATES,
} from "@mayarin/clearing";
import type { ExecutionPath } from "@mayarin/payment-intent";
import { ConcurrencyError, ValidationError } from "@mayarin/shared";
import { and, asc, eq, notInArray } from "drizzle-orm";
import type { Executor } from "../client.ts";
import {
  present,
  runInTransaction,
  toAsset,
  toBigint,
  toMoney,
  toOptionalMoney,
} from "../mapping.ts";
import { clearingEvents, clearingTransactions } from "../schema.ts";

type Row = typeof clearingTransactions.$inferSelect;
type EventRow = typeof clearingEvents.$inferSelect;

export class DrizzleClearingRepository implements ClearingRepository {
  readonly #db: Executor;

  constructor(db: Executor) {
    this.#db = db;
  }

  /** The transaction and the events explaining it are written together. */
  async insert(transaction: ClearingTransaction, events: readonly ClearingEvent[]): Promise<void> {
    await runInTransaction(this.#db, async (tx) => {
      await tx.insert(clearingTransactions).values(toRow(transaction));
      if (events.length > 0) await tx.insert(clearingEvents).values(events.map(toEventRow));
    });
  }

  async update(
    transaction: ClearingTransaction,
    expectedVersion: number,
    events: readonly ClearingEvent[],
  ): Promise<void> {
    await runInTransaction(this.#db, async (tx) => {
      const updated = await tx
        .update(clearingTransactions)
        .set(toRow(transaction))
        .where(
          and(
            eq(clearingTransactions.id, transaction.id),
            eq(clearingTransactions.version, expectedVersion),
          ),
        )
        .returning({ id: clearingTransactions.id });

      if (updated.length === 0) {
        throw new ConcurrencyError(
          `Clearing transaction ${transaction.id} was modified concurrently`,
          { id: transaction.id, expectedVersion },
        );
      }

      if (events.length > 0) await tx.insert(clearingEvents).values(events.map(toEventRow));
    });
  }

  async findById(id: string): Promise<ClearingTransaction | null> {
    const [row] = await this.#db
      .select()
      .from(clearingTransactions)
      .where(eq(clearingTransactions.id, id))
      .limit(1);
    return row === undefined ? null : toDomain(row);
  }

  async findByPaymentIntentId(paymentIntentId: string): Promise<ClearingTransaction | null> {
    const [row] = await this.#db
      .select()
      .from(clearingTransactions)
      .where(eq(clearingTransactions.paymentIntentId, paymentIntentId))
      .limit(1);
    return row === undefined ? null : toDomain(row);
  }

  async findByProviderReference(
    provider: string,
    providerReference: string,
  ): Promise<ClearingTransaction | null> {
    const [row] = await this.#db
      .select()
      .from(clearingTransactions)
      .where(
        and(
          eq(clearingTransactions.provider, provider),
          eq(clearingTransactions.providerReference, providerReference),
        ),
      )
      .limit(1);
    return row === undefined ? null : toDomain(row);
  }

  async listEvents(clearingTransactionId: string): Promise<ClearingEvent[]> {
    const rows = await this.#db
      .select()
      .from(clearingEvents)
      .where(eq(clearingEvents.clearingTransactionId, clearingTransactionId))
      .orderBy(asc(clearingEvents.sequence));
    return rows.map(toEvent);
  }

  async listResumable(limit: number): Promise<ClearingTransaction[]> {
    const rows = await this.#db
      .select()
      .from(clearingTransactions)
      .where(notInArray(clearingTransactions.state, [...TERMINAL_CLEARING_STATES]))
      .orderBy(asc(clearingTransactions.createdAt))
      .limit(limit);
    return rows.map(toDomain);
  }
}

function toRow(transaction: ClearingTransaction): typeof clearingTransactions.$inferInsert {
  return {
    id: transaction.id,
    paymentIntentId: transaction.paymentIntentId,
    state: transaction.state,
    merchantId: transaction.merchant.id,
    merchantName: transaction.merchant.name,
    merchantCity: transaction.merchant.city,
    merchantCountryCode: transaction.merchant.countryCode,
    sourceAmount: transaction.sourceAmount.amount.toString(),
    sourceAsset: transaction.sourceAmount.asset,
    settlementAsset: transaction.settlementAsset,
    provider: transaction.provider,
    executionPath: transaction.executionPath ?? null,
    rateFrom: transaction.rate?.from ?? null,
    rateTo: transaction.rate?.to ?? null,
    rateMinorUnitsPerWholeUnit: transaction.rate?.minorUnitsPerWholeUnit.toString() ?? null,
    rateSource: transaction.rate?.source ?? null,
    rateLockedAt: transaction.rate?.lockedAt ?? null,
    rateExpiresAt: transaction.rate?.expiresAt ?? null,
    settlementAmount: transaction.settlementAmount?.amount.toString() ?? null,
    feeAmount: transaction.fee?.amount.toString() ?? null,
    netAmount: transaction.netAmount?.amount.toString() ?? null,
    providerReference: transaction.providerReference ?? null,
    failureReason: transaction.failure?.reason ?? null,
    failureCode: transaction.failure?.code ?? null,
    failureAt: transaction.failure?.at ?? null,
    ...depositColumns(transaction),
    createdAt: transaction.createdAt,
    updatedAt: transaction.updatedAt,
    version: transaction.version,
  };
}

function toDomain(row: Row): ClearingTransaction {
  const settlementAsset = toAsset(row.settlementAsset);
  const rateMinorUnits = toBigint(row.rateMinorUnitsPerWholeUnit);

  return {
    id: row.id,
    paymentIntentId: row.paymentIntentId,
    state: row.state as ClearingState,
    merchant: {
      id: row.merchantId,
      name: row.merchantName,
      city: row.merchantCity,
      countryCode: row.merchantCountryCode,
    },
    sourceAmount: toMoney(row.sourceAmount, row.sourceAsset),
    settlementAsset,
    provider: row.provider,
    ...present("executionPath", row.executionPath as ExecutionPath | null),
    ...(rateMinorUnits === undefined || row.rateFrom === null || row.rateTo === null
      ? {}
      : {
          rate: {
            from: toAsset(row.rateFrom),
            to: toAsset(row.rateTo),
            minorUnitsPerWholeUnit: rateMinorUnits,
            source: row.rateSource ?? "unknown",
            lockedAt: row.rateLockedAt ?? row.updatedAt,
            ...present("expiresAt", row.rateExpiresAt),
          },
        }),
    ...present("settlementAmount", toOptionalMoney(row.settlementAmount, settlementAsset)),
    ...present("fee", toOptionalMoney(row.feeAmount, settlementAsset)),
    ...present("netAmount", toOptionalMoney(row.netAmount, settlementAsset)),
    ...present("deposit", toDeposit(row)),
    ...present("providerReference", row.providerReference),
    ...(row.failureReason === null || row.failureAt === null
      ? {}
      : {
          failure: {
            reason: row.failureReason,
            code: row.failureCode ?? "CLEARING_FAILED",
            at: row.failureAt,
          },
        }),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    version: row.version,
  };
}

function toEventRow(event: ClearingEvent): typeof clearingEvents.$inferInsert {
  return {
    id: event.id,
    clearingTransactionId: event.clearingTransactionId,
    sequence: event.sequence,
    type: event.type,
    fromState: event.fromState ?? null,
    toState: event.toState,
    payload: { ...event.payload },
    occurredAt: event.occurredAt,
  };
}

function toEvent(row: EventRow): ClearingEvent {
  return {
    id: row.id,
    clearingTransactionId: row.clearingTransactionId,
    sequence: row.sequence,
    type: row.type as ClearingEventType,
    ...present("fromState", row.fromState as ClearingState | null),
    toState: row.toState as ClearingState,
    payload: row.payload,
    occurredAt: row.occurredAt,
  };
}

/**
 * The deposit block is set together or not at all, so a row missing any part of
 * it has no deposit rather than a half-built one.
 */
function toDeposit(row: Row): ClearingDeposit | undefined {
  const { depositAsset, depositChain, depositAddress, depositAmount } = row;
  if (
    depositAsset === null ||
    depositChain === null ||
    depositAddress === null ||
    depositAmount === null ||
    row.depositRateMinorUnitsPerWholeUnit === null ||
    row.depositRateSource === null ||
    row.depositRateLockedAt === null
  ) {
    return undefined;
  }

  if (!isChainId(depositChain)) {
    throw new ValidationError(`Stored chain "${depositChain}" is not supported`, {
      chain: depositChain,
    });
  }

  return {
    asset: toAsset(depositAsset),
    chain: depositChain,
    address: depositAddress,
    amount: toMoney(depositAmount, depositAsset),
    rate: {
      // Not stored: they are the source asset and the deposit asset, and a
      // second copy is a second thing that can disagree.
      from: toAsset(row.sourceAsset),
      to: toAsset(depositAsset),
      minorUnitsPerWholeUnit: BigInt(row.depositRateMinorUnitsPerWholeUnit),
      source: row.depositRateSource,
      lockedAt: row.depositRateLockedAt,
      ...(row.depositRateExpiresAt === null ? {} : { expiresAt: row.depositRateExpiresAt }),
    },
  };
}

function depositColumns(transaction: ClearingTransaction) {
  const deposit = transaction.deposit;
  if (deposit === undefined) {
    return {
      depositAsset: null,
      depositChain: null,
      depositAddress: null,
      depositAmount: null,
      depositRateMinorUnitsPerWholeUnit: null,
      depositRateSource: null,
      depositRateLockedAt: null,
      depositRateExpiresAt: null,
    };
  }

  return {
    depositAsset: deposit.asset,
    depositChain: deposit.chain,
    depositAddress: deposit.address,
    depositAmount: deposit.amount.amount.toString(),
    depositRateMinorUnitsPerWholeUnit: deposit.rate.minorUnitsPerWholeUnit.toString(),
    depositRateSource: deposit.rate.source,
    depositRateLockedAt: deposit.rate.lockedAt,
    depositRateExpiresAt: deposit.rate.expiresAt ?? null,
  };
}
