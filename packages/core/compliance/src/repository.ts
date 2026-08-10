/**
 * The one read this package cannot compose from an existing port.
 *
 * Everything a `PaymentAuditRecord` contains is already reachable: clearing
 * state and history through `ClearingRepository`, postings through
 * `LedgerRepository.listTransactionsByReference`, chain observations through the
 * deposit and settlement repositories. What none of them answer is "which
 * payments did this merchant take, in this window, in this asset" — the entry
 * point a compliance query starts from. So this port is deliberately one method
 * wide. Widening it to re-expose reads that already exist elsewhere would give
 * the same data two ports and two chances to drift.
 */

import type {
  AuditFilter,
  MerchantEventFilter,
  MerchantEventRow,
  PaymentAuditSummary,
} from "./types.ts";

export interface AuditQueryRepository {
  /**
   * Payments in scope, newest first.
   *
   * Newest first because a compliance question is nearly always about recent
   * activity, and because a stable order is what makes `limit` mean something.
   */
  listPayments(filter: AuditFilter): Promise<readonly PaymentAuditSummary[]>;
}

/**
 * The merchant event log — a unified timeline over clearing, settlement, and
 * webhook events. No table of its own: the three sources are append-only and
 * already kept, so the row is derived. The Drizzle adapter runs three bounded
 * `LIMIT n` queries (one per source) and merge-sorts in JS, which is simpler
 * than a cross-table union over three tables that share no column.
 */
export interface MerchantEventRepository {
  listByMerchant(
    merchantId: string,
    limit?: number,
    filter?: MerchantEventFilter,
  ): Promise<readonly MerchantEventRow[]>;
}
