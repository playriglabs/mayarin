/**
 * Audit DTOs — the compliance record on the wire.
 *
 * Every bigint becomes a string, because JSON has no bigint and a compliance
 * record that loses precision on the way out is worse than no record. Block
 * numbers and raw on-chain amounts are rendered as exact decimal strings for
 * the same reason `MoneyDto.amount` is.
 *
 * Pure mappers; the route assembles them.
 */

import type { Deposit, SettlementEvent } from "@mayarin/chain";
import type {
  PaymentAuditRecord,
  PaymentAuditSummary,
  ReconciliationVerdict,
} from "@mayarin/compliance";
import type { LedgerTransaction } from "@mayarin/ledger";
import { optionalMoney, toMoneyDto } from "./money.ts";
import { toClearingDto, toPaymentIntentDto, toTimelineDto } from "./payment.ts";

export function toAuditSummaryDto(summary: PaymentAuditSummary) {
  return {
    clearingTransactionId: summary.clearingTransactionId,
    paymentIntentId: summary.paymentIntentId,
    merchantId: summary.merchantId,
    state: summary.state,
    sourceAmount: toMoneyDto(summary.sourceAmount),
    settlementAsset: summary.settlementAsset,
    settlementAmount: optionalMoney(summary.settlementAmount) ?? null,
    fee: optionalMoney(summary.fee) ?? null,
    netAmount: optionalMoney(summary.netAmount) ?? null,
    createdAt: summary.createdAt.toISOString(),
    updatedAt: summary.updatedAt.toISOString(),
  };
}

/** A posting, entry by entry — the double entry itself, not a net figure. */
export function toPostingDto(posting: LedgerTransaction) {
  return {
    id: posting.id,
    description: posting.description,
    reference: posting.reference ?? null,
    createdAt: posting.createdAt.toISOString(),
    entries: posting.entries.map((entry) => ({
      accountCode: entry.accountCode,
      direction: entry.direction,
      amount: toMoneyDto(entry.amount),
    })),
  };
}

export function toDepositDto(deposit: Deposit) {
  return {
    chain: deposit.chain,
    txHash: deposit.txHash,
    logIndex: deposit.logIndex,
    address: deposit.address,
    amount: toMoneyDto(deposit.amount),
    blockNumber: deposit.blockNumber.toString(),
    status: deposit.status,
    firstSeenAt: deposit.firstSeenAt.toISOString(),
    confirmedAt: deposit.confirmedAt?.toISOString() ?? null,
    orphanedAt: deposit.orphanedAt?.toISOString() ?? null,
  };
}

export function toSettlementDto(settlement: SettlementEvent) {
  return {
    chain: settlement.chain,
    txHash: settlement.txHash,
    logIndex: settlement.logIndex,
    blockNumber: settlement.blockNumber.toString(),
    intentId: settlement.intentId,
    merchantSafe: settlement.merchantSafe,
    settledAmount: settlement.settledAmount.toString(),
    fee: settlement.fee.toString(),
    refundAmount: settlement.refundAmount.toString(),
    status: settlement.status,
    firstSeenAt: settlement.firstSeenAt.toISOString(),
    confirmedAt: settlement.confirmedAt?.toISOString() ?? null,
    orphanedAt: settlement.orphanedAt?.toISOString() ?? null,
  };
}

/** The tagged union crosses the wire tagged — `status` is the discriminant. */
export function toReconciliationDto(verdict: ReconciliationVerdict) {
  switch (verdict.status) {
    case "MATCHED":
      return {
        status: verdict.status,
        net: toMoneyDto(verdict.net),
        fee: toMoneyDto(verdict.fee),
      };
    case "MISMATCHED":
      return {
        status: verdict.status,
        differences: verdict.differences.map((difference) => ({
          field: difference.field,
          ledger: toMoneyDto(difference.ledger),
          onChain: toMoneyDto(difference.onChain),
        })),
      };
    case "NO_ON_CHAIN_RECORD":
      return { status: verdict.status };
  }
}

export function toAuditRecordDto(record: PaymentAuditRecord) {
  return {
    clearing: toClearingDto(record.transaction),
    paymentIntent: record.intent === undefined ? null : toPaymentIntentDto(record.intent),
    timeline: toTimelineDto(record.history),
    postings: record.postings.map(toPostingDto),
    deposits: record.deposits.map(toDepositDto),
    settlement: record.settlement === undefined ? null : toSettlementDto(record.settlement),
    reconciliation: toReconciliationDto(record.reconciliation),
  };
}
