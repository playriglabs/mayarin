import { isChainId } from "@mayarin/chain";
import type {
  ExecutionPath,
  ListPaymentIntentsOptions,
  PaymentIntent,
  PaymentIntentRepository,
  PaymentIntentStatus,
  PaymentRail,
  PaymentSource,
} from "@mayarin/payment-intent";
import type { QrScheme } from "@mayarin/qr-parser";
import { ConcurrencyError, ValidationError } from "@mayarin/shared";
import { and, asc, desc, eq, gt, gte, ilike, lt, or } from "drizzle-orm";
import type { Executor } from "../client.ts";
import { present, toAsset, toMoney } from "../mapping.ts";
import { paymentIntents } from "../schema.ts";

type Row = typeof paymentIntents.$inferSelect;

export class DrizzlePaymentIntentRepository implements PaymentIntentRepository {
  readonly #db: Executor;

  constructor(db: Executor) {
    this.#db = db;
  }

  async insert(intent: PaymentIntent): Promise<void> {
    await this.#db.insert(paymentIntents).values(toRow(intent));
  }

  async findById(id: string): Promise<PaymentIntent | null> {
    const [row] = await this.#db
      .select()
      .from(paymentIntents)
      .where(eq(paymentIntents.id, id))
      .limit(1);
    return row === undefined ? null : toDomain(row);
  }

  async findByIdempotencyKey(key: string): Promise<PaymentIntent | null> {
    const [row] = await this.#db
      .select()
      .from(paymentIntents)
      .where(eq(paymentIntents.idempotencyKey, key))
      .limit(1);
    return row === undefined ? null : toDomain(row);
  }

  /**
   * Optimistic update: the row only moves if it is still at the version the
   * caller read, so two concurrent transitions cannot silently overwrite one
   * another.
   */
  async update(intent: PaymentIntent, expectedVersion: number): Promise<void> {
    const updated = await this.#db
      .update(paymentIntents)
      .set(toRow(intent))
      .where(and(eq(paymentIntents.id, intent.id), eq(paymentIntents.version, expectedVersion)))
      .returning({ id: paymentIntents.id });

    if (updated.length === 0) {
      throw new ConcurrencyError(`Payment intent ${intent.id} was modified concurrently`, {
        id: intent.id,
        expectedVersion,
      });
    }
  }

  async list(options: ListPaymentIntentsOptions = {}): Promise<readonly PaymentIntent[]> {
    const limit = options.limit ?? 100;
    const filters = [
      options.merchantId === undefined
        ? undefined
        : eq(paymentIntents.merchantId, options.merchantId),
      options.merchantReference === undefined
        ? undefined
        : eq(paymentIntents.merchantReference, options.merchantReference),
      options.q === undefined
        ? undefined
        : or(
            ilike(paymentIntents.id, `%${options.q}%`),
            ilike(paymentIntents.merchantReference, `%${options.q}%`),
          ),
      options.status === undefined ? undefined : eq(paymentIntents.status, options.status),
      options.from === undefined ? undefined : gte(paymentIntents.createdAt, options.from),
      options.to === undefined ? undefined : lt(paymentIntents.createdAt, options.to),
      cursorFilter(options),
    ].filter((filter) => filter !== undefined);

    const sort = options.sort ?? "-created";
    const order =
      sort === "created"
        ? [asc(paymentIntents.createdAt), asc(paymentIntents.id)]
        : sort === "-amount"
          ? [desc(paymentIntents.amount), desc(paymentIntents.id)]
          : [desc(paymentIntents.createdAt), desc(paymentIntents.id)];

    const rows = await this.#db
      .select()
      .from(paymentIntents)
      .where(filters.length === 0 ? undefined : and(...filters))
      .orderBy(...order)
      .limit(limit);
    return rows.map(toDomain);
  }
}

function cursorFilter(options: ListPaymentIntentsOptions) {
  const cursor = options.cursor;
  if (cursor === undefined) return undefined;
  const sort = options.sort ?? "-created";
  if (sort === "-amount") {
    if (cursor.amount === undefined) return undefined;
    const amount = cursor.amount.toString();
    return or(
      lt(paymentIntents.amount, amount),
      and(eq(paymentIntents.amount, amount), lt(paymentIntents.id, cursor.id)),
    );
  }
  if (sort === "created") {
    return or(
      gt(paymentIntents.createdAt, cursor.createdAt),
      and(eq(paymentIntents.createdAt, cursor.createdAt), gt(paymentIntents.id, cursor.id)),
    );
  }
  return or(
    lt(paymentIntents.createdAt, cursor.createdAt),
    and(eq(paymentIntents.createdAt, cursor.createdAt), lt(paymentIntents.id, cursor.id)),
  );
}

function toRow(intent: PaymentIntent): typeof paymentIntents.$inferInsert {
  return {
    id: intent.id,
    status: intent.status,
    merchantId: intent.merchant.id,
    merchantName: intent.merchant.name,
    merchantCity: intent.merchant.city,
    merchantCountryCode: intent.merchant.countryCode,
    merchantCategoryCode: intent.merchant.categoryCode ?? null,
    amount: intent.amount.amount.toString(),
    amountAsset: intent.amount.asset,
    settlementAsset: intent.settlementAsset,
    provider: intent.provider,
    executionPath: intent.executionPath ?? null,
    ...paymentRailColumns(intent),
    sourceType: intent.source.type,
    sourceScheme: intent.source.type === "qr" ? intent.source.scheme : null,
    sourcePayload: intent.source.type === "qr" ? intent.source.payload : null,
    metadata: { ...intent.metadata },
    merchantReference: intent.merchantReference ?? null,
    idempotencyKey: intent.idempotencyKey ?? null,
    requestFingerprint: intent.requestFingerprint ?? null,
    clearingTransactionId: intent.clearingTransactionId ?? null,
    failureReason: intent.failureReason ?? null,
    createdAt: intent.createdAt,
    updatedAt: intent.updatedAt,
    expiresAt: intent.expiresAt,
    confirmedAt: intent.confirmedAt ?? null,
    completedAt: intent.completedAt ?? null,
    version: intent.version,
  };
}

function toDomain(row: Row): PaymentIntent {
  return {
    id: row.id,
    status: row.status as PaymentIntentStatus,
    merchant: {
      id: row.merchantId,
      name: row.merchantName,
      city: row.merchantCity,
      countryCode: row.merchantCountryCode,
      ...present("categoryCode", row.merchantCategoryCode),
    },
    amount: toMoney(row.amount, row.amountAsset),
    settlementAsset: toAsset(row.settlementAsset),
    provider: row.provider,
    ...present("executionPath", row.executionPath as ExecutionPath | null),
    ...present("payment", toPaymentRail(row)),
    source: toSource(row),
    metadata: row.metadata,
    ...present("merchantReference", row.merchantReference),
    ...present("idempotencyKey", row.idempotencyKey),
    ...present("requestFingerprint", row.requestFingerprint),
    ...present("clearingTransactionId", row.clearingTransactionId),
    ...present("failureReason", row.failureReason),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    expiresAt: row.expiresAt,
    ...present("confirmedAt", row.confirmedAt),
    ...present("completedAt", row.completedAt),
    version: row.version,
  };
}

function toSource(row: Row): PaymentSource {
  if (row.sourceType === "qr" && row.sourcePayload !== null) {
    return {
      type: "qr",
      scheme: (row.sourceScheme ?? "EMVCO") as QrScheme,
      payload: row.sourcePayload,
    };
  }
  return { type: "manual" };
}

function toPaymentRail(row: Row): PaymentRail | undefined {
  if (row.paymentAsset === null || row.paymentChain === null) return undefined;
  if (!isChainId(row.paymentChain)) {
    throw new ValidationError(`Stored chain "${row.paymentChain}" is not supported`, {
      chain: row.paymentChain,
    });
  }
  return { asset: toAsset(row.paymentAsset), chain: row.paymentChain };
}

function paymentRailColumns(intent: PaymentIntent) {
  return {
    paymentAsset: intent.payment?.asset ?? null,
    paymentChain: intent.payment?.chain ?? null,
  };
}
