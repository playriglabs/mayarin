/**
 * Compliance application service — the audit trail query interface (RFC #16).
 *
 * Composition, not storage. Every port it holds already existed and is already
 * append-only; this service is the one place that knows they describe the same
 * payment and how to join them. Nothing here writes, so an audit read cannot
 * change what it is auditing.
 *
 * The ports arrive injected, as everywhere else in `packages/core`, so the whole
 * reconstruction is exercisable against in-memory fakes with no database.
 */

import type { DepositRepository, SettlementEventRepository } from "@mayarin/chain";
import type { ClearingRepository, ClearingTransaction } from "@mayarin/clearing";
import type { LedgerRepository } from "@mayarin/ledger";
import type { PaymentIntentRepository } from "@mayarin/payment-intent";
import { NotFoundError } from "@mayarin/shared";
import { reconcile } from "./reconciliation.ts";
import type { AuditQueryRepository } from "./repository.ts";
import type { AuditFilter, PaymentAuditRecord, PaymentAuditSummary } from "./types.ts";

export interface ComplianceServiceOptions {
  readonly audits: AuditQueryRepository;
  readonly clearing: ClearingRepository;
  readonly ledger: LedgerRepository;
  readonly intents: PaymentIntentRepository;
  readonly deposits: DepositRepository;
  readonly settlements: SettlementEventRepository;
}

export class ComplianceService {
  readonly #audits: AuditQueryRepository;
  readonly #clearing: ClearingRepository;
  readonly #ledger: LedgerRepository;
  readonly #intents: PaymentIntentRepository;
  readonly #deposits: DepositRepository;
  readonly #settlements: SettlementEventRepository;

  constructor(options: ComplianceServiceOptions) {
    this.#audits = options.audits;
    this.#clearing = options.clearing;
    this.#ledger = options.ledger;
    this.#intents = options.intents;
    this.#deposits = options.deposits;
    this.#settlements = options.settlements;
  }

  /** Payments in scope, newest first. The entry point of an audit. */
  async listPayments(filter: AuditFilter): Promise<readonly PaymentAuditSummary[]> {
    return this.#audits.listPayments(filter);
  }

  /**
   * The full immutable record for one of `merchantId`'s payments.
   *
   * Merchant-scoped for the same reason `AuditFilter` has no "all merchants"
   * value, and enforced here rather than at the HTTP edge so no future caller
   * can reach an unscoped read. Another merchant's payment raises the same
   * `NotFoundError` an absent id does, so a not-found and a forbidden are
   * indistinguishable on the wire — the property `PaymentReadService` already
   * holds, kept identical here.
   *
   * Throws rather than returning `undefined`: an audit asking for a payment
   * that does not exist is a bad reference, not an empty result, and the
   * taxonomy already maps that onto a 404 in one place.
   */
  async record(merchantId: string, clearingTransactionId: string): Promise<PaymentAuditRecord> {
    const transaction = await this.#clearing.findById(clearingTransactionId);
    if (transaction === null || transaction.merchant.id !== merchantId) {
      throw new NotFoundError(`No clearing transaction ${clearingTransactionId}`, {
        clearingTransactionId,
      });
    }

    const [history, postings, intent, deposits, settlement] = await Promise.all([
      this.#clearing.listEvents(transaction.id),
      this.#ledger.listTransactionsByReference(transaction.id),
      this.#intents.findById(transaction.paymentIntentId),
      this.#depositsFor(transaction),
      this.#settlementFor(transaction),
    ]);

    return {
      transaction,
      ...(intent === null ? {} : { intent }),
      history,
      postings,
      deposits,
      ...(settlement === undefined ? {} : { settlement }),
      reconciliation: reconcile({
        settlementAsset: transaction.settlementAsset,
        postings,
        ...(settlement === undefined ? {} : { settlement }),
      }),
    };
  }

  /**
   * Every transfer seen at this payment's deposit address, confirmed or not.
   *
   * Unconfirmed and orphaned transfers are included on purpose. They are part of
   * what was observed, and an audit that shows only what succeeded cannot answer
   * why a payment did not.
   */
  async #depositsFor(transaction: ClearingTransaction) {
    const deposit = transaction.deposit;
    if (deposit === undefined) return [];
    return this.#deposits.listByAddress(deposit.chain, deposit.address);
  }

  /** The `PaymentCompleted` log, when this payment took the contract path. */
  async #settlementFor(transaction: ClearingTransaction) {
    const intentId = transaction.contract?.order.intentId;
    if (intentId === undefined) return undefined;
    return (await this.#settlements.findByIntentId(intentId)) ?? undefined;
  }
}
