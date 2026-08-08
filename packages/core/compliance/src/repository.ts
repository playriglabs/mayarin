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

import type { AuditFilter, PaymentAuditSummary } from "./types.ts";

export interface AuditQueryRepository {
  /**
   * Payments in scope, newest first.
   *
   * Newest first because a compliance question is nearly always about recent
   * activity, and because a stable order is what makes `limit` mean something.
   */
  listPayments(filter: AuditFilter): Promise<readonly PaymentAuditSummary[]>;
}
