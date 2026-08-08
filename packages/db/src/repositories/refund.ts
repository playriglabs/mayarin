/**
 * Postgres adapter for the refund port (#12).
 *
 * `update` takes no expected version and the table has no `version` column: a
 * refund's lifecycle is `PENDING → SUCCEEDED | FAILED`, driven by exactly one
 * caller — the service that created it — so there is no second writer to race.
 * What guards against a duplicate is the unique idempotency key, not a version.
 */

import type { Refund, RefundRepository, RefundState } from "@mayarin/clearing";
import { and, asc, eq } from "drizzle-orm";
import type { Executor } from "../client.ts";
import { present, toMoney } from "../mapping.ts";
import { refunds } from "../schema.ts";

type Row = typeof refunds.$inferSelect;

export class DrizzleRefundRepository implements RefundRepository {
  readonly #db: Executor;

  constructor(db: Executor) {
    this.#db = db;
  }

  async insert(refund: Refund): Promise<void> {
    await this.#db.insert(refunds).values(toRow(refund));
  }

  async update(refund: Refund): Promise<void> {
    await this.#db.update(refunds).set(toRow(refund)).where(eq(refunds.id, refund.id));
  }

  async findById(id: string): Promise<Refund | null> {
    const [row] = await this.#db.select().from(refunds).where(eq(refunds.id, id)).limit(1);
    return row === undefined ? null : toDomain(row);
  }

  async findByIdempotencyKey(key: string): Promise<Refund | null> {
    const [row] = await this.#db
      .select()
      .from(refunds)
      .where(eq(refunds.idempotencyKey, key))
      .limit(1);
    return row === undefined ? null : toDomain(row);
  }

  /** Oldest first: the sum that bounds a new refund reads in the order it accrued. */
  async listByClearingTransactionId(clearingTransactionId: string): Promise<readonly Refund[]> {
    const rows = await this.#db
      .select()
      .from(refunds)
      .where(eq(refunds.clearingTransactionId, clearingTransactionId))
      .orderBy(asc(refunds.createdAt));
    return rows.map(toDomain);
  }

  /** Everything not failed against one payment — what the refundable balance counts. */
  async listActive(clearingTransactionId: string): Promise<readonly Refund[]> {
    const rows = await this.#db
      .select()
      .from(refunds)
      .where(
        and(
          eq(refunds.clearingTransactionId, clearingTransactionId),
          eq(refunds.state, "SUCCEEDED"),
        ),
      )
      .orderBy(asc(refunds.createdAt));
    return rows.map(toDomain);
  }
}

function toRow(refund: Refund): typeof refunds.$inferInsert {
  return {
    id: refund.id,
    clearingTransactionId: refund.clearingTransactionId,
    paymentIntentId: refund.paymentIntentId,
    merchantId: refund.merchantId,
    amount: refund.amount.amount.toString(),
    amountAsset: refund.amount.asset,
    state: refund.state,
    reason: refund.reason ?? null,
    idempotencyKey: refund.idempotencyKey ?? null,
    providerReference: refund.providerReference ?? null,
    failureReason: refund.failureReason ?? null,
    createdAt: refund.createdAt,
    updatedAt: refund.updatedAt,
  };
}

function toDomain(row: Row): Refund {
  return {
    id: row.id,
    clearingTransactionId: row.clearingTransactionId,
    paymentIntentId: row.paymentIntentId,
    merchantId: row.merchantId,
    amount: toMoney(row.amount, row.amountAsset),
    state: row.state as RefundState,
    ...present("reason", row.reason),
    ...present("idempotencyKey", row.idempotencyKey),
    ...present("providerReference", row.providerReference),
    ...present("failureReason", row.failureReason),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
