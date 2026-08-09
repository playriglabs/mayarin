import { isChainId } from "@mayarin/chain";
import {
  type ClearingContract,
  type ClearingDeposit,
  type ClearingEvent,
  type ClearingEventType,
  type ClearingRepository,
  type ClearingState,
  type ClearingTransaction,
  type OnChainSettlement,
  TERMINAL_CLEARING_STATES,
} from "@mayarin/clearing";
import type { ExecutionPath } from "@mayarin/payment-intent";
import { type AssetCode, ConcurrencyError, ValidationError } from "@mayarin/shared";
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
import { notifyPaymentChanged } from "../notify.ts";
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
      // Queued until commit, discarded on rollback: a listener is never told
      // about a change that did not happen.
      await notifyPaymentChanged(tx, transaction.paymentIntentId);
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
      await notifyPaymentChanged(tx, transaction.paymentIntentId);
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

  async findByContractIntentId(intentId: string): Promise<ClearingTransaction | null> {
    const [row] = await this.#db
      .select()
      .from(clearingTransactions)
      .where(eq(clearingTransactions.contractIntentId, intentId))
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
  const onChain = transaction.onChain;
  return {
    id: transaction.id,
    onChainSettledAmount: onChain?.settledAmount.amount.toString() ?? null,
    onChainFee: onChain?.fee.amount.toString() ?? null,
    onChainRefundAmount: onChain?.refundAmount.amount.toString() ?? null,
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
    rateScaled: transaction.rate?.scaledRate.toString() ?? null,
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
    ...contractColumns(transaction),
    createdAt: transaction.createdAt,
    updatedAt: transaction.updatedAt,
    version: transaction.version,
  };
}

function toDomain(row: Row): ClearingTransaction {
  const settlementAsset = toAsset(row.settlementAsset);
  const rateMinorUnits = toBigint(row.rateScaled);

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
            scaledRate: rateMinorUnits,
            source: row.rateSource ?? "unknown",
            lockedAt: row.rateLockedAt ?? row.updatedAt,
            ...present("expiresAt", row.rateExpiresAt),
          },
        }),
    ...present("settlementAmount", toOptionalMoney(row.settlementAmount, settlementAsset)),
    ...present("fee", toOptionalMoney(row.feeAmount, settlementAsset)),
    ...present("netAmount", toOptionalMoney(row.netAmount, settlementAsset)),
    ...present("deposit", toDeposit(row)),
    ...present("contract", toContract(row)),
    ...present("onChain", toOnChain(row, settlementAsset)),
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
    row.depositRateScaled === null ||
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
      scaledRate: BigInt(row.depositRateScaled),
      source: row.depositRateSource,
      lockedAt: row.depositRateLockedAt,
      ...(row.depositRateExpiresAt === null ? {} : { expiresAt: row.depositRateExpiresAt }),
    },
  };
}

function contractColumns(transaction: ClearingTransaction) {
  const contract = transaction.contract;
  if (contract === undefined) {
    return {
      contractIntentId: null,
      contractSettlementToken: null,
      contractMinOut: null,
      contractFee: null,
      contractMerchantSafe: null,
      contractRefundTo: null,
      contractDeadline: null,
      contractSignature: null,
      contractSigner: null,
      contractPayerEstimate: null,
      contractPayerAsset: null,
      contractExpiresAt: null,
      contractTxHash: null,
    };
  }

  const { order } = contract;
  return {
    contractIntentId: order.intentId,
    contractSettlementToken: order.settlementToken,
    contractMinOut: order.minOut.toString(),
    contractFee: order.fee.toString(),
    contractMerchantSafe: order.merchantSafe,
    contractRefundTo: order.refundTo,
    contractDeadline: order.deadline.toString(),
    contractSignature: order.signature,
    contractSigner: order.signer,
    contractPayerEstimate: contract.payerEstimate.amount.toString(),
    contractPayerAsset: contract.payerEstimate.asset,
    contractExpiresAt: contract.expiresAt,
    contractTxHash: contract.txHash ?? null,
  };
}

/**
 * What the chain reported, or `undefined` for a payment settled before the
 * indexer carried the figures through.
 */
function toOnChain(row: Row, settlementAsset: AssetCode): OnChainSettlement | undefined {
  if (row.onChainSettledAmount === null) return undefined;
  return {
    settledAmount: toMoney(row.onChainSettledAmount, settlementAsset),
    fee: toMoney(row.onChainFee ?? "0", settlementAsset),
    refundAmount: toMoney(row.onChainRefundAmount ?? "0", settlementAsset),
  };
}

/**
 * Rebuilds the lock, or `undefined` when the row carries none.
 *
 * Keyed off `contract_intent_id`: a lock without one could not be matched to a
 * `PaymentCompleted` log, so a row missing it is not a partial lock to salvage.
 */
function toContract(row: Row): ClearingContract | undefined {
  const minOut = toBigint(row.contractMinOut);
  if (
    row.contractIntentId === null ||
    row.contractSettlementToken === null ||
    minOut === undefined ||
    row.contractMerchantSafe === null ||
    row.contractRefundTo === null ||
    row.contractSignature === null ||
    row.contractSigner === null ||
    row.contractExpiresAt === null ||
    row.contractPayerAsset === null
  ) {
    return undefined;
  }

  return {
    order: {
      intentId: row.contractIntentId,
      settlementToken: row.contractSettlementToken,
      minOut,
      fee: toBigint(row.contractFee) ?? 0n,
      merchantSafe: row.contractMerchantSafe,
      refundTo: row.contractRefundTo,
      deadline: toBigint(row.contractDeadline) ?? 0n,
      signature: row.contractSignature,
      signer: row.contractSigner,
    },
    payerEstimate: toMoney(row.contractPayerEstimate ?? "0", row.contractPayerAsset),
    expiresAt: row.contractExpiresAt,
    ...present("txHash", row.contractTxHash),
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
      depositRateScaled: null,
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
    depositRateScaled: deposit.rate.scaledRate.toString(),
    depositRateSource: deposit.rate.source,
    depositRateLockedAt: deposit.rate.lockedAt,
    depositRateExpiresAt: deposit.rate.expiresAt ?? null,
  };
}
