/**
 * Payment change notifications (#13).
 *
 * A payer watching a checkout page needs to hear about a state change within
 * milliseconds, and the process serving that page is not necessarily the one
 * that made the change. The in-process event bus cannot cross that gap: a payer
 * connected to one instance would never see an event published on another, and
 * their page would sit silent through a successful payment.
 *
 * Postgres already sits between every instance, so it carries the signal.
 * `NOTIFY` fires **on commit**, which is exactly the moment a reader should be
 * told — a listener woken before the commit would read the old row.
 *
 * The payload is only the payment intent id. `NOTIFY` caps at 8000 bytes, and
 * more importantly a payload is a second copy of state that can disagree with
 * the row: a listener re-reads instead, so there is one source of truth and no
 * payment detail travels through a channel nobody authorised.
 */

import { sql } from "drizzle-orm";
import type { Sql } from "postgres";
import type { Executor } from "./client.ts";

/** The channel every payment state change is announced on. */
export const PAYMENT_CHANGED_CHANNEL = "mayarin_payment_changed";

/**
 * Announces that a payment changed, inside the caller's transaction.
 *
 * Must be called within the same transaction as the write. Postgres queues the
 * notification until commit and discards it on rollback, so a listener cannot
 * be told about a change that did not happen.
 */
export async function notifyPaymentChanged(
  executor: Executor,
  paymentIntentId: string,
): Promise<void> {
  await executor.execute(sql`select pg_notify(${PAYMENT_CHANGED_CHANNEL}, ${paymentIntentId})`);
}

export interface PaymentChangeSubscription {
  unlisten(): Promise<void>;
}

/**
 * Listens for payment changes.
 *
 * Holds a dedicated connection for the life of the subscription — that is what
 * `LISTEN` is, and why this takes the raw client rather than the pool.
 */
export async function listenPaymentChanged(
  client: Sql,
  onChange: (paymentIntentId: string) => void,
): Promise<PaymentChangeSubscription> {
  const subscription = await client.listen(PAYMENT_CHANGED_CHANNEL, (payload) => {
    if (payload.length > 0) onChange(payload);
  });
  return { unlisten: () => subscription.unlisten() };
}
