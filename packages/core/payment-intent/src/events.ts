import { type DomainEvent, generateId, serializeMoney } from "@mayarin/shared";
import type { PaymentIntent } from "./types.ts";

export const PAYMENT_INTENT_EVENT = {
  created: "payment_intent.created",
  confirmed: "payment_intent.confirmed",
  processing: "payment_intent.processing",
  completed: "payment_intent.completed",
  failed: "payment_intent.failed",
  expired: "payment_intent.expired",
} as const;

export type PaymentIntentEventType =
  (typeof PAYMENT_INTENT_EVENT)[keyof typeof PAYMENT_INTENT_EVENT];

export interface PaymentIntentEventPayload {
  readonly id: string;
  readonly status: PaymentIntent["status"];
  readonly merchantId: string;
  readonly amount: { readonly amount: string; readonly asset: string };
  readonly version: number;
}

export function paymentIntentEvent(
  type: PaymentIntentEventType,
  intent: PaymentIntent,
): DomainEvent<PaymentIntentEventType, PaymentIntentEventPayload> {
  return {
    id: generateId("evt", intent.updatedAt.getTime()),
    type,
    aggregateId: intent.id,
    occurredAt: intent.updatedAt,
    payload: {
      id: intent.id,
      status: intent.status,
      merchantId: intent.merchant.id,
      amount: serializeMoney(intent.amount),
      version: intent.version,
    },
  };
}
