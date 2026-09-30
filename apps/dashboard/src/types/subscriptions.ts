/** Subscriptions (#296) — the dashboard API's wire shapes. */

import type { InvoiceDto } from "@/types/invoices";
import type { MoneyDto } from "@/types/payment";

export type SubscriptionInterval = "week" | "month" | "year";
export type SubscriptionState = "active" | "paused" | "cancelled";

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
  /** `null` unless active. */
  readonly nextBillingAt: string | null;
  readonly createdAt: string;
  readonly cancelledAt: string | null;
}

export interface SubscriptionListResponse {
  readonly subscriptions: readonly SubscriptionDto[];
}

export interface SubscriptionResponse {
  readonly subscription: SubscriptionDto;
}

export interface SubscriptionDetailResponse {
  readonly subscription: SubscriptionDto;
  /** One issued invoice per billed cycle, with its paid/overdue status. */
  readonly cycles: readonly InvoiceDto[];
}

export interface CreateSubscriptionRequest {
  readonly customerId: string;
  readonly description: string;
  readonly amount: { readonly amount: string; readonly asset: string };
  readonly interval: SubscriptionInterval;
  readonly startAt?: string;
  readonly daysUntilDue: number;
}

export type SubscriptionAction = "pause" | "resume" | "cancel";
