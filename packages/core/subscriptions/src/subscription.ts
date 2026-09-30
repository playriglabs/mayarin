/**
 * The subscription aggregate: its schedule and its lifecycle. Pure — the
 * clock arrives as an argument, and every transition returns a new value with
 * an incremented `version`.
 */

import { InvalidStateTransitionError, ValidationError } from "@mayarin/shared";
import type { NewSubscription, Subscription, SubscriptionInterval } from "./types.ts";

const DAY_MS = 86_400_000;

/** Billing dates are UTC calendar arithmetic, so a merchant in any zone sees one schedule. */
function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

/**
 * The date of cycle `n` (0-based) for a schedule anchored at `anchor`.
 *
 * Months and years are counted from the anchor, never from the previous date,
 * and a day the target month lacks clamps to its last day: anchored 31 Jan,
 * cycle 1 is 28/29 Feb and cycle 2 is 31 Mar.
 */
export function billingDate(anchor: Date, interval: SubscriptionInterval, n: number): Date {
  if (interval === "week") return new Date(anchor.getTime() + n * 7 * DAY_MS);

  const months = interval === "month" ? n : n * 12;
  const total = anchor.getUTCMonth() + months;
  const year = anchor.getUTCFullYear() + Math.floor(total / 12);
  const month = ((total % 12) + 12) % 12;
  const day = Math.min(anchor.getUTCDate(), daysInMonth(year, month));
  return new Date(
    Date.UTC(
      year,
      month,
      day,
      anchor.getUTCHours(),
      anchor.getUTCMinutes(),
      anchor.getUTCSeconds(),
      anchor.getUTCMilliseconds(),
    ),
  );
}

/** When the next cycle bills. */
export function nextBillingAt(subscription: Subscription): Date {
  return billingDate(subscription.anchorAt, subscription.interval, subscription.billedCycles);
}

/** Whether a cycle is owed now. */
export function isDue(subscription: Subscription, now: Date): boolean {
  return subscription.state === "active" && nextBillingAt(subscription).getTime() <= now.getTime();
}

/**
 * The idempotency key of the cycle about to be billed: one per subscription
 * per billing date. A tick that runs twice issues one invoice and sends one
 * email, because both are keyed by it.
 */
export function cycleKey(subscription: Subscription): string {
  return `${subscription.id}:${nextBillingAt(subscription).toISOString()}`;
}

export function createSubscription(input: NewSubscription): Subscription {
  if (input.amount.amount <= 0n) {
    throw new ValidationError("A subscription must charge a positive amount", {
      amount: input.amount.amount.toString(),
    });
  }
  if (input.description.trim() === "") {
    throw new ValidationError("A subscription needs a description", {});
  }
  if (!Number.isInteger(input.daysUntilDue) || input.daysUntilDue < 0 || input.daysUntilDue > 90) {
    throw new ValidationError("Days until due must be a whole number from 0 to 90", {
      daysUntilDue: input.daysUntilDue,
    });
  }
  return {
    id: input.id,
    merchantId: input.merchantId,
    subscriber: input.subscriber,
    description: input.description.trim(),
    amount: input.amount,
    interval: input.interval,
    anchorAt: input.anchorAt,
    billedCycles: 0,
    daysUntilDue: input.daysUntilDue,
    state: "active",
    createdAt: input.now,
    updatedAt: input.now,
    version: 1,
  };
}

/** Records that the current cycle was billed; the next date follows from the anchor. */
export function markBilled(subscription: Subscription, now: Date): Subscription {
  if (subscription.state !== "active") {
    throw new InvalidStateTransitionError(`A ${subscription.state} subscription does not bill`, {
      id: subscription.id,
    });
  }
  return {
    ...subscription,
    billedCycles: subscription.billedCycles + 1,
    updatedAt: now,
    version: subscription.version + 1,
  };
}

export function pauseSubscription(subscription: Subscription, now: Date): Subscription {
  if (subscription.state !== "active") {
    throw new InvalidStateTransitionError(`A ${subscription.state} subscription cannot pause`, {
      id: subscription.id,
    });
  }
  return { ...subscription, state: "paused", updatedAt: now, version: subscription.version + 1 };
}

/**
 * Resumes billing from the next date that is not in the past. Periods missed
 * while paused are skipped, not back-billed: a pause means "stop charging".
 */
export function resumeSubscription(subscription: Subscription, now: Date): Subscription {
  if (subscription.state !== "paused") {
    throw new InvalidStateTransitionError(`A ${subscription.state} subscription cannot resume`, {
      id: subscription.id,
    });
  }
  let billedCycles = subscription.billedCycles;
  while (
    billingDate(subscription.anchorAt, subscription.interval, billedCycles).getTime() <
    now.getTime()
  ) {
    billedCycles += 1;
  }
  return {
    ...subscription,
    state: "active",
    billedCycles,
    updatedAt: now,
    version: subscription.version + 1,
  };
}

export function cancelSubscription(subscription: Subscription, now: Date): Subscription {
  if (subscription.state === "cancelled") return subscription;
  return {
    ...subscription,
    state: "cancelled",
    cancelledAt: now,
    updatedAt: now,
    version: subscription.version + 1,
  };
}
