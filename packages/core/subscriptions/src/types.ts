/**
 * Subscriptions (#296): recurring billing, send-to-pay.
 *
 * Each cycle is an ordinary invoice issued to the customer, which they pay on
 * any rail — so the clearing engine, ledger, receipts and x402 need nothing
 * new. Auto-charge (an allowance pulled each period) is a later collection
 * method on the same aggregate; it needs gas sponsorship (#9) first.
 *
 * Stored state is small on purpose: the schedule (anchor + interval + how many
 * cycles have been billed) and a lifecycle state. The next billing date is
 * derived from the anchor every time, never accumulated, so month-end
 * clamping cannot drift — a subscription anchored on 31 January bills on
 * 28/29 February and 31 March, not 28 March forever after.
 */

import type { Money } from "@mayarin/shared";

/** The metadata key a cycle's invoice — and so every payment on it — carries. */
export const SUBSCRIPTION_METADATA_KEY = "subscriptionId";

export const SUBSCRIPTION_INTERVALS = ["week", "month", "year"] as const;

export type SubscriptionInterval = (typeof SUBSCRIPTION_INTERVALS)[number];

/**
 * `cancelled` is terminal. `paused` bills nothing and, on resume, skips every
 * period it missed rather than back-billing them.
 */
export const SUBSCRIPTION_STATES = ["active", "paused", "cancelled"] as const;

export type SubscriptionState = (typeof SUBSCRIPTION_STATES)[number];

/** Who is billed, as they were when subscribed — a snapshot, like an invoice's buyer. */
export interface SubscriberSnapshot {
  readonly customerId: string;
  readonly name: string;
  /** Absent: each cycle's invoice is issued, but the merchant sends the link. */
  readonly email?: string;
}

export interface Subscription {
  readonly id: string;
  readonly merchantId: string;
  readonly subscriber: SubscriberSnapshot;
  /** The line printed on every cycle's invoice. */
  readonly description: string;
  readonly amount: Money;
  readonly interval: SubscriptionInterval;
  /** The first billing date; every later one is derived from it. */
  readonly anchorAt: Date;
  /** Cycles billed so far. The next one is cycle number `billedCycles`. */
  readonly billedCycles: number;
  /** Days between a cycle's invoice and its due date. */
  readonly daysUntilDue: number;
  readonly state: SubscriptionState;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly cancelledAt?: Date;
  /** Incremented on every change. The optimistic-locking token. */
  readonly version: number;
}

export interface NewSubscription {
  readonly id: string;
  readonly merchantId: string;
  readonly subscriber: SubscriberSnapshot;
  readonly description: string;
  readonly amount: Money;
  readonly interval: SubscriptionInterval;
  readonly anchorAt: Date;
  readonly daysUntilDue: number;
  readonly now: Date;
}
