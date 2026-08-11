/**
 * Reference in-memory fake for the audit query port, in the segregated
 * `/testing` subpath so domain `src/` stays pure.
 *
 * Backed by clearing transactions rather than by pre-built summaries, so it
 * derives the same row from the same source the Drizzle adapter reads. A fake
 * that stores the answer instead of computing it cannot disagree with the real
 * adapter, which sounds like a feature and means the tests stop checking the
 * projection.
 */

import type { ClearingTransaction } from "@mayarin/clearing";
import type {
  AuditFilter,
  AuditQueryRepository,
  MerchantEventFilter,
  MerchantEventRepository,
  MerchantEventRow,
  PaymentAuditSummary,
} from "../src/index.ts";

const DEFAULT_LIMIT = 100;
const DEFAULT_EVENT_LIMIT = 50;

export class InMemoryAuditQueryRepository implements AuditQueryRepository {
  readonly #transactions: ClearingTransaction[] = [];

  add(...transactions: readonly ClearingTransaction[]): void {
    this.#transactions.push(...transactions);
  }

  async listPayments(filter: AuditFilter): Promise<readonly PaymentAuditSummary[]> {
    return this.#transactions
      .filter((transaction) => matches(transaction, filter))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, filter.limit ?? DEFAULT_LIMIT)
      .map(toSummary);
  }
}

function matches(transaction: ClearingTransaction, filter: AuditFilter): boolean {
  if (transaction.merchant.id !== filter.merchantId) return false;
  // Inclusive lower bound, exclusive upper — adjacent windows neither overlap
  // nor leave a gap, which is what makes a month-by-month audit add up.
  if (filter.from !== undefined && transaction.createdAt < filter.from) return false;
  if (filter.to !== undefined && transaction.createdAt >= filter.to) return false;
  if (filter.asset !== undefined && transaction.settlementAsset !== filter.asset) return false;
  return true;
}

function toSummary(transaction: ClearingTransaction): PaymentAuditSummary {
  const { settlementAmount, fee, netAmount } = transaction;

  return {
    clearingTransactionId: transaction.id,
    paymentIntentId: transaction.paymentIntentId,
    merchantId: transaction.merchant.id,
    state: transaction.state,
    sourceAmount: transaction.sourceAmount,
    settlementAsset: transaction.settlementAsset,
    ...(settlementAmount === undefined ? {} : { settlementAmount }),
    ...(fee === undefined ? {} : { fee }),
    ...(netAmount === undefined ? {} : { netAmount }),
    createdAt: transaction.createdAt,
    updatedAt: transaction.updatedAt,
  };
}

/**
 * Reference in-memory fake for the merchant event log. Stores rows directly
 * rather than deriving them from three sources — the Drizzle adapter's
 * three-query merge is what the route tests exercise through the real repo
 * path, and a fake that recomputed the merge would just duplicate that logic
 * and drift. Tests seed the rows they want on the timeline.
 */
export class InMemoryMerchantEventRepository implements MerchantEventRepository {
  readonly #rows: MerchantEventRow[] = [];

  add(...rows: readonly MerchantEventRow[]): void {
    this.#rows.push(...rows);
  }

  async listByMerchant(
    merchantId: string,
    limit?: number,
    filter: MerchantEventFilter = {},
  ): Promise<readonly MerchantEventRow[]> {
    const q = filter.q?.toLocaleLowerCase();
    const direction = filter.sort === "created" ? 1 : -1;
    return this.#rows
      .filter((row) => row.merchantId === merchantId)
      .filter((row) => q === undefined || row.summary.toLocaleLowerCase().includes(q))
      .filter((row) => filter.status === undefined || row.severity === filter.status)
      .filter((row) => filter.from === undefined || row.occurredAt >= filter.from)
      .filter((row) => filter.to === undefined || row.occurredAt < filter.to)
      .sort((a, b) => {
        const time = a.occurredAt.getTime() - b.occurredAt.getTime();
        return time === 0 ? direction * a.id.localeCompare(b.id) : direction * time;
      })
      .filter((row) => {
        if (filter.cursor === undefined) return true;
        const time = row.occurredAt.getTime() - filter.cursor.occurredAt.getTime();
        const compared = time === 0 ? row.id.localeCompare(filter.cursor.id) : time;
        return direction * compared > 0;
      })
      .slice(0, limit ?? DEFAULT_EVENT_LIMIT);
  }
}
