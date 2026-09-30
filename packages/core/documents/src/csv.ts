/**
 * Payments as CSV rows (#294).
 *
 * Amounts are the machine form (`toDecimalString`: ungrouped, dot decimal) with
 * the asset in its own column. The human form would be read as a different
 * number by a spreadsheet in half the world's locales — `50.432` is fifty
 * thousand in Indonesia and fifty in the United States.
 */

import type { ClearingTransaction } from "@mayarin/clearing";
import type { PaymentIntent } from "@mayarin/payment-intent";
import { type Money, toDecimalString } from "@mayarin/shared";
import { clearedRate, invoiceIdOf, settlementHashOf } from "./document.ts";

export const PAYMENT_CSV_COLUMNS = [
  "payment_id",
  "created_at",
  "completed_at",
  "status",
  "merchant_reference",
  "invoice_id",
  "customer_id",
  "amount",
  "currency",
  "paid_asset",
  "paid_amount",
  "network",
  "rate",
  "rate_source",
  "settlement_asset",
  "settlement_amount",
  "fee",
  "net_amount",
  "transaction_hash",
  "failure_reason",
] as const;

function decimal(value: Money | undefined): string {
  return value === undefined ? "" : toDecimalString(value);
}

/**
 * One payment as cells, in `PAYMENT_CSV_COLUMNS` order.
 *
 * `rate` is units of the settlement asset per one whole unit of the currency
 * the merchant priced in, as the two frozen amounts define it (`clearedRate`).
 */
export function paymentCsvRow(
  intent: PaymentIntent,
  transaction: ClearingTransaction | null,
): readonly string[] {
  const paid = transaction?.deposit?.amount ?? transaction?.contract?.payerEstimate;
  const rate = transaction === null ? undefined : clearedRate(transaction);
  return [
    intent.id,
    intent.createdAt.toISOString(),
    intent.completedAt?.toISOString() ?? "",
    intent.status,
    intent.merchantReference ?? "",
    invoiceIdOf(intent) ?? "",
    intent.metadata.customerId ?? "",
    toDecimalString(intent.amount),
    intent.amount.asset,
    paid?.asset ?? intent.payment?.asset ?? "",
    decimal(paid),
    transaction?.deposit?.chain ?? intent.payment?.chain ?? "",
    rate === undefined ? "" : toDecimalString(rate.per),
    transaction?.rate?.source ?? "",
    intent.settlementAsset,
    decimal(transaction?.settlementAmount),
    decimal(transaction?.fee),
    decimal(transaction?.onChain?.settledAmount ?? transaction?.netAmount),
    transaction === null ? "" : (settlementHashOf(transaction) ?? ""),
    intent.failureReason ?? transaction?.failure?.reason ?? "",
  ];
}

/**
 * A cell as RFC 4180 writes it, with a spreadsheet formula guard: a value a
 * merchant typed — a reference, a failure reason — that starts with `=`, `+`,
 * `-`, `@`, tab or carriage return is prefixed with `'` so it is read as text,
 * never executed.
 */
export function csvCell(value: string): string {
  const guarded = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded;
}

export function csvLine(cells: readonly string[]): string {
  return `${cells.map(csvCell).join(",")}\r\n`;
}
