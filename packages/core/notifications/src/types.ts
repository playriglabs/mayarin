/**
 * Webhook notification types (RFC #13).
 *
 * A webhook is a signal, not truth — the posture Phase 1 set for inbound
 * webhooks holds for outbound ones too. A delivery carries ids and the new
 * state, nothing a receiver could book against. A receiver that needs the
 * authoritative record asks the API with the ids the signal gave it.
 */

import type { ClearingEvent, ClearingEventType, ClearingState } from "@mayarin/clearing";

export const WEBHOOK_EVENT_TYPES = [
  "payment.created",
  "payment.state_changed",
  "payment.failed",
] as const;
export type WebhookEventType = (typeof WEBHOOK_EVENT_TYPES)[number];

/**
 * A clearing event projected to what a merchant integration is told.
 *
 * `id` is the clearing event's own id. It rides on every delivery as the
 * receiver's idempotency key, so a retried delivery is recognisable as a
 * repeat of the same fact rather than a new fact.
 */
export interface NotifiableEvent {
  readonly id: string;
  readonly merchantId: string;
  readonly paymentIntentId: string;
  readonly clearingTransactionId: string;
  readonly type: WebhookEventType;
  readonly state: ClearingState;
  /**
   * The clearing event's 1-based position in its payment's history. Deliveries
   * are at-least-once and unordered; the sequence is what lets a receiver
   * discard a stale event instead of trusting arrival order.
   */
  readonly sequence: number;
  /**
   * The intent's free-form metadata, so a merchant reconciles against their
   * own ids without a lookup. `merchantReference` joins it when #10 adds the
   * field to the intent.
   */
  readonly metadata: Readonly<Record<string, string>>;
  readonly occurredAt: Date;
}

/** Where one merchant wants to be told, and the secret their deliveries are signed with. */
export interface WebhookEndpoint {
  readonly id: string;
  readonly merchantId: string;
  readonly url: string;
  readonly secret: string;
  /**
   * The secret before the last rotation. Deliveries are signed with both, so a
   * receiver still holding the old secret keeps verifying until it catches up.
   */
  readonly previousSecret?: string;
  readonly active: boolean;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export const WEBHOOK_DELIVERY_STATUSES = ["PENDING", "DELIVERED", "DEAD"] as const;
export type WebhookDeliveryStatus = (typeof WEBHOOK_DELIVERY_STATUSES)[number];

/**
 * One attempt-tracked delivery of one event to one endpoint.
 *
 * `body` is frozen at enqueue so every attempt sends identical bytes: a
 * receiver deduplicating on content or verifying a logged signature must never
 * see the same event serialise two different ways.
 */
export interface WebhookDelivery {
  readonly id: string;
  readonly eventId: string;
  readonly endpointId: string;
  readonly merchantId: string;
  readonly body: string;
  readonly status: WebhookDeliveryStatus;
  /** Attempts made so far, so `0` means not yet tried. */
  readonly attempts: number;
  readonly nextAttemptAt: Date;
  readonly lastStatusCode?: number;
  readonly lastError?: string;
  readonly deliveredAt?: Date;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/**
 * Projects a clearing event into the notifiable shape.
 *
 * Lives in core so the Drizzle outbox adapter and the in-memory fake derive
 * the same projection from the same source, instead of each inventing one.
 */
export function toNotifiableEvent(
  event: ClearingEvent,
  context: {
    readonly merchantId: string;
    readonly paymentIntentId: string;
    readonly metadata?: Readonly<Record<string, string>>;
  },
): NotifiableEvent {
  return {
    id: event.id,
    merchantId: context.merchantId,
    paymentIntentId: context.paymentIntentId,
    clearingTransactionId: event.clearingTransactionId,
    type: toWebhookEventType(event.type),
    state: event.toState,
    sequence: event.sequence,
    metadata: context.metadata ?? {},
    occurredAt: event.occurredAt,
  };
}

export function toWebhookEventType(type: ClearingEventType): WebhookEventType {
  switch (type) {
    case "transaction.created":
      return "payment.created";
    case "state.changed":
      return "payment.state_changed";
    case "state.failed":
      return "payment.failed";
  }
}
