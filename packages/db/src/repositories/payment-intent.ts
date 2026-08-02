import type {
  PaymentIntent,
  PaymentIntentRepository,
  PaymentIntentStatus,
  PaymentSource,
} from "@mayarr/payment-intent";
import type { QrScheme } from "@mayarr/qr-parser";
import { ConcurrencyError } from "@mayarr/shared";
import { and, eq } from "drizzle-orm";
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
    sourceType: intent.source.type,
    sourceScheme: intent.source.type === "qr" ? intent.source.scheme : null,
    sourcePayload: intent.source.type === "qr" ? intent.source.payload : null,
    metadata: { ...intent.metadata },
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
    source: toSource(row),
    metadata: row.metadata,
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
