/**
 * The webhook event of a subscription cycle (#303): a cycle's invoice was issued.
 *
 * The id is the cycle key (`${subscriptionId}:${billingDate}`), the same one the
 * invoice and its email use, so a replayed billing tick enqueues the same event
 * and the delivery table drops the repeat.
 */

import type { MerchantEvent } from "./merchant-event.ts";

export interface SubscriptionCycleFacts {
  readonly cycleKey: string;
  readonly subscriptionId: string;
  readonly customerId: string;
  readonly invoiceId: string;
  readonly payUrl: string;
  readonly amount: string;
  readonly asset: string;
  readonly dueAt: Date | undefined;
  readonly createdAt: Date;
}

/** `subscription.cycle_created`: a cycle was billed; the subscriber can pay at `payUrl`. */
export function subscriptionCycleCreatedEvent(cycle: SubscriptionCycleFacts): MerchantEvent {
  return {
    id: cycle.cycleKey,
    type: "subscription.cycle_created",
    occurredAt: cycle.createdAt,
    data: {
      subscriptionId: cycle.subscriptionId,
      customerId: cycle.customerId,
      invoiceId: cycle.invoiceId,
      payUrl: cycle.payUrl,
      amount: cycle.amount,
      asset: cycle.asset,
      dueAt: cycle.dueAt?.toISOString() ?? null,
    },
  };
}
