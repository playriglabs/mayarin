/**
 * Postgres adapter for how a payment was funded (0043).
 *
 * Keyed by the provider's order id, so recording the same order twice is one row.
 * The fields a status poll changes — the provider's status and the moment it
 * settled — are the only ones an update touches.
 */

import { and, desc, eq, gte, inArray, isNull } from "drizzle-orm";
import type { Executor } from "../client.ts";
import { paymentFundings } from "../schema.ts";

export type FundingKind = "local-currency";

export interface PaymentFunding {
  readonly orderId: string;
  readonly paymentIntentId: string;
  readonly merchantId: string;
  readonly kind: FundingKind;
  readonly provider: string;
  readonly paymentCode: string;
  readonly paymentName: string;
  readonly paymentLogoUrl: string | null;
  readonly fiatCurrency: string;
  readonly fiatAmount: string;
  readonly status: string;
  readonly settledAt: Date | null;
  readonly createdAt: Date;
}

export interface PaymentFundingRepository {
  record(funding: Omit<PaymentFunding, "settledAt">, now: Date): Promise<void>;
  listByPayment(paymentIntentId: string): Promise<readonly PaymentFunding[]>;
  /**
   * The newest funding of each payment that has one, in a single query — for a
   * list page, which would otherwise ask once per row.
   */
  latestByPayments(
    paymentIntentIds: readonly string[],
  ): Promise<ReadonlyMap<string, PaymentFunding>>;
  /** Orders not yet seen settled, oldest first, created no earlier than `since`. */
  listOpen(since: Date, limit: number): Promise<readonly PaymentFunding[]>;
  update(
    orderId: string,
    change: { readonly status: string; readonly settledAt?: Date },
    now: Date,
  ): Promise<void>;
}

type Row = typeof paymentFundings.$inferSelect;

function toFunding(row: Row): PaymentFunding {
  return {
    orderId: row.orderId,
    paymentIntentId: row.paymentIntentId,
    merchantId: row.merchantId,
    kind: row.kind as FundingKind,
    provider: row.provider,
    paymentCode: row.paymentCode,
    paymentName: row.paymentName,
    paymentLogoUrl: row.paymentLogoUrl,
    fiatCurrency: row.fiatCurrency,
    fiatAmount: row.fiatAmount,
    status: row.status,
    settledAt: row.settledAt,
    createdAt: row.createdAt,
  };
}

export class DrizzlePaymentFundingRepository implements PaymentFundingRepository {
  readonly #db: Executor;

  constructor(db: Executor) {
    this.#db = db;
  }

  async record(funding: Omit<PaymentFunding, "settledAt">, now: Date): Promise<void> {
    await this.#db
      .insert(paymentFundings)
      .values({
        orderId: funding.orderId,
        paymentIntentId: funding.paymentIntentId,
        merchantId: funding.merchantId,
        kind: funding.kind,
        provider: funding.provider,
        paymentCode: funding.paymentCode,
        paymentName: funding.paymentName,
        paymentLogoUrl: funding.paymentLogoUrl,
        fiatCurrency: funding.fiatCurrency,
        fiatAmount: funding.fiatAmount,
        status: funding.status,
        createdAt: funding.createdAt,
        updatedAt: now,
      })
      .onConflictDoNothing({ target: paymentFundings.orderId });
  }

  async listByPayment(paymentIntentId: string): Promise<readonly PaymentFunding[]> {
    const rows = await this.#db
      .select()
      .from(paymentFundings)
      .where(eq(paymentFundings.paymentIntentId, paymentIntentId))
      .orderBy(desc(paymentFundings.createdAt));
    return rows.map(toFunding);
  }

  async latestByPayments(
    paymentIntentIds: readonly string[],
  ): Promise<ReadonlyMap<string, PaymentFunding>> {
    const latest = new Map<string, PaymentFunding>();
    if (paymentIntentIds.length === 0) return latest;

    const rows = await this.#db
      .select()
      .from(paymentFundings)
      .where(inArray(paymentFundings.paymentIntentId, [...paymentIntentIds]))
      .orderBy(desc(paymentFundings.createdAt));
    // Newest first, so the first row seen for a payment is its latest.
    for (const row of rows) {
      if (!latest.has(row.paymentIntentId)) latest.set(row.paymentIntentId, toFunding(row));
    }
    return latest;
  }

  async listOpen(since: Date, limit: number): Promise<readonly PaymentFunding[]> {
    const rows = await this.#db
      .select()
      .from(paymentFundings)
      .where(and(isNull(paymentFundings.settledAt), gte(paymentFundings.createdAt, since)))
      .orderBy(paymentFundings.createdAt)
      .limit(limit);
    return rows.map(toFunding);
  }

  async update(
    orderId: string,
    change: { readonly status: string; readonly settledAt?: Date },
    now: Date,
  ): Promise<void> {
    await this.#db
      .update(paymentFundings)
      .set({
        status: change.status,
        ...(change.settledAt === undefined ? {} : { settledAt: change.settledAt }),
        updatedAt: now,
      })
      .where(eq(paymentFundings.orderId, orderId));
  }
}
