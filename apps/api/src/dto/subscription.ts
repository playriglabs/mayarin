/**
 * Subscription request schema and response DTO (#296).
 *
 * `nextBillingAt` is derived on the way out, never stored: only an active
 * subscription has one. A paused one's date is recomputed on resume, and a
 * cancelled one has none.
 */

import { decimalMoneySchema, timestampSchema } from "@mayarin/shared";
import {
  nextBillingAt,
  SUBSCRIPTION_INTERVALS,
  type Subscription,
  type SubscriptionInterval,
  type SubscriptionState,
} from "@mayarin/subscriptions";
import { z } from "zod";
import { type MoneyDto, toMoneyDto } from "./money.ts";

export const createSubscriptionBodySchema = z
  .object({
    customer: z
      .object({
        name: z.string().trim().min(1).max(255),
        /** Required: every cycle's invoice is emailed here. */
        email: z.string().email().max(320),
      })
      .strict(),
    description: z.string().trim().min(1).max(200),
    amount: decimalMoneySchema,
    interval: z.enum(SUBSCRIPTION_INTERVALS),
    startAt: timestampSchema.optional(),
    daysUntilDue: z.number().int().min(0).max(90).default(7),
  })
  .strict();

export type CreateSubscriptionBody = z.input<typeof createSubscriptionBodySchema>;

export interface SubscriptionDto {
  readonly id: string;
  readonly subscriber: {
    readonly customerId: string;
    readonly name: string;
    readonly email: string | null;
  };
  readonly description: string;
  readonly amount: MoneyDto;
  readonly interval: SubscriptionInterval;
  readonly state: SubscriptionState;
  readonly billedCycles: number;
  readonly daysUntilDue: number;
  readonly anchorAt: string;
  readonly nextBillingAt: string | null;
  readonly createdAt: string;
  readonly cancelledAt: string | null;
}

export function toSubscriptionDto(subscription: Subscription): SubscriptionDto {
  return {
    id: subscription.id,
    subscriber: {
      customerId: subscription.subscriber.customerId,
      name: subscription.subscriber.name,
      email: subscription.subscriber.email ?? null,
    },
    description: subscription.description,
    amount: toMoneyDto(subscription.amount),
    interval: subscription.interval,
    state: subscription.state,
    billedCycles: subscription.billedCycles,
    daysUntilDue: subscription.daysUntilDue,
    anchorAt: subscription.anchorAt.toISOString(),
    nextBillingAt:
      subscription.state === "active" ? nextBillingAt(subscription).toISOString() : null,
    createdAt: subscription.createdAt.toISOString(),
    cancelledAt: subscription.cancelledAt?.toISOString() ?? null,
  };
}
