/**
 * Postgres adapter for the audit query port (RFC #16).
 *
 * A projection over `clearing_transactions`, not a table of its own. The audit
 * trail is the records the system already keeps; storing a second copy for
 * compliance would create the one thing a compliance surface must not have — a
 * version of the truth that can drift from the truth.
 *
 * The merchant/time index added alongside this is what keeps the scan bounded;
 * without it the query degrades to a full table scan as history grows.
 */

import type { ClearingState } from "@mayarin/clearing";
import type { AuditFilter, AuditQueryRepository, PaymentAuditSummary } from "@mayarin/compliance";
import { and, desc, eq, gte, lt, type SQL } from "drizzle-orm";
import type { Executor } from "../client.ts";
import { present, toAsset, toMoney, toOptionalMoney } from "../mapping.ts";
import { clearingTransactions } from "../schema.ts";

type Row = typeof clearingTransactions.$inferSelect;

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

export class DrizzleAuditQueryRepository implements AuditQueryRepository {
  readonly #db: Executor;

  constructor(db: Executor) {
    this.#db = db;
  }

  async listPayments(filter: AuditFilter): Promise<readonly PaymentAuditSummary[]> {
    const conditions: SQL[] = [eq(clearingTransactions.merchantId, filter.merchantId)];

    // Inclusive lower bound, exclusive upper: two adjacent windows cover every
    // payment exactly once, which is what makes period-by-period totals add up.
    if (filter.from !== undefined) {
      conditions.push(gte(clearingTransactions.createdAt, filter.from));
    }
    if (filter.to !== undefined) {
      conditions.push(lt(clearingTransactions.createdAt, filter.to));
    }
    if (filter.asset !== undefined) {
      conditions.push(eq(clearingTransactions.settlementAsset, filter.asset));
    }

    const rows = await this.#db
      .select()
      .from(clearingTransactions)
      .where(and(...conditions))
      .orderBy(desc(clearingTransactions.createdAt))
      .limit(boundedLimit(filter.limit));

    return rows.map(toSummary);
  }
}

/**
 * A caller-supplied limit is clamped rather than trusted.
 *
 * An audit export asking for everything is a legitimate request and a way to
 * pull the whole table into memory. The cap makes the page size a decision this
 * adapter owns.
 */
function boundedLimit(limit: number | undefined): number {
  if (limit === undefined) return DEFAULT_LIMIT;
  return Math.min(Math.max(1, Math.trunc(limit)), MAX_LIMIT);
}

function toSummary(row: Row): PaymentAuditSummary {
  const settlementAsset = toAsset(row.settlementAsset);

  return {
    clearingTransactionId: row.id,
    paymentIntentId: row.paymentIntentId,
    merchantId: row.merchantId,
    state: row.state as ClearingState,
    sourceAmount: toMoney(row.sourceAmount, row.sourceAsset),
    settlementAsset,
    ...present("settlementAmount", toOptionalMoney(row.settlementAmount, row.settlementAsset)),
    ...present("fee", toOptionalMoney(row.feeAmount, row.settlementAsset)),
    ...present("netAmount", toOptionalMoney(row.netAmount, row.settlementAsset)),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
