/**
 * What an invoice is owed, and what to call it.
 *
 * Nothing here is stored. An invoice's paid amount is the sum of the completed
 * intents that carry its number, and its status follows from that sum, its
 * stored state, and the clock. Persisting either would create a second source
 * of truth that goes stale the moment a payment completes and no writer runs.
 *
 * Partial payment across several intents therefore needs no extra machinery: a
 * buyer paying a Rp 10.000.000 invoice in two halves produces two completed
 * intents under one number, and the sum is simply correct.
 */

import type { PaymentIntent } from "@mayarin/payment-intent";
import { type Money, money, subtract, sum } from "@mayarin/shared";
import type { Invoice, InvoicePayment, InvoiceStatus } from "./types.ts";

/**
 * The payments that actually count, in the order they completed.
 *
 * One filter, used by both the sum and the list a reader is shown, so "paid
 * Rp 5.000.000" and "paid with USDC on Arc" can never describe different sets
 * of intents.
 *
 * Only `COMPLETED` intents. An intent that is merely created, or is
 * mid-clearing, is a promise — treating it as payment would show an invoice as
 * settled while the money was still in flight. An intent in another asset is
 * ignored rather than converted: there is no rate here, and inventing one would
 * misstate a balance.
 */
export function paymentsOf(
  invoice: Invoice,
  intents: readonly PaymentIntent[],
): readonly InvoicePayment[] {
  return intents
    .filter((intent) => intent.status === "COMPLETED")
    .filter((intent) => intent.amount.asset === invoice.currency)
    .map((intent) => ({
      intentId: intent.id,
      amount: intent.amount,
      // Absent on a fiat-only intent, which is every Phase 1 intent — a
      // document that was paid without a rail says so by omitting one rather
      // than by naming a chain nothing settled on.
      ...(intent.payment === undefined ? {} : { rail: intent.payment }),
      paidAt: intent.completedAt ?? intent.updatedAt,
    }))
    .sort((left, right) => left.paidAt.getTime() - right.paidAt.getTime());
}

/** Totals what a buyer has actually paid — the sum of the payments that count. */
export function paidAmount(invoice: Invoice, intents: readonly PaymentIntent[]): Money {
  return sum(
    paymentsOf(invoice, intents).map((payment) => payment.amount),
    invoice.currency,
  );
}

/** What is still owed. Never negative: an overpayment reads as settled, not as a debt owed back. */
export function outstandingOf(invoice: Invoice, paid: Money): Money {
  const remaining = subtract(invoice.total, paid);
  return remaining.amount < 0n ? money(0n, invoice.currency) : remaining;
}

/**
 * The status a reader is shown.
 *
 * Precedence matters and is deliberate. A voided invoice is void whatever was
 * paid against it, because the document is withdrawn and the payment is a
 * separate conversation. A fully paid invoice is paid even when it settled
 * after its due date — being late is a fact about a payment, not a standing
 * state of a document that is now closed.
 */
export function invoiceStatus(invoice: Invoice, paid: Money, now: Date): InvoiceStatus {
  if (invoice.state === "void") return "void";
  if (invoice.state === "draft") return "draft";

  const outstanding = outstandingOf(invoice, paid);
  if (outstanding.amount === 0n) return "paid";

  if (invoice.dueAt !== undefined && now.getTime() >= invoice.dueAt.getTime()) return "overdue";
  return paid.amount > 0n ? "partially_paid" : "issued";
}

/** Convenience for a reader that has the intents but wants every derived figure at once. */
export function viewOf(
  invoice: Invoice,
  intents: readonly PaymentIntent[],
  now: Date,
): {
  readonly status: InvoiceStatus;
  readonly paid: Money;
  readonly outstanding: Money;
  readonly payments: readonly InvoicePayment[];
} {
  const payments = paymentsOf(invoice, intents);
  const paid = sum(
    payments.map((payment) => payment.amount),
    invoice.currency,
  );
  return {
    status: invoiceStatus(invoice, paid, now),
    paid,
    outstanding: outstandingOf(invoice, paid),
    payments,
  };
}
