/**
 * A webhook event that is not a clearing event (disputes, #313).
 *
 * Payment events travel the outbox and the dispatcher. Some facts have no
 * clearing event behind them: a dispute opening, a message in its thread, its
 * outcome. They are put on the same delivery table the dispatcher drains, so the
 * signing, retries and dead letter are the ones every payment event gets, in the
 * same envelope (`id`, `type`, `occurredAt`, `data`).
 *
 * `event.id` is the receiver's idempotency key and the delivery's own: enqueueing
 * the same event twice is a no-op, so a retried operation cannot send it twice.
 */

import { generateId } from "@mayarin/shared";
import type { WebhookDeliveryRepository, WebhookEndpointRepository } from "./repository.ts";

export interface MerchantEvent {
  readonly id: string;
  readonly type: string;
  readonly occurredAt: Date;
  readonly data: Readonly<Record<string, unknown>>;
}

export interface MerchantEventSink {
  readonly endpoints: Pick<WebhookEndpointRepository, "listActiveByMerchant">;
  readonly deliveries: Pick<WebhookDeliveryRepository, "insertMany">;
}

/** One delivery per active endpoint of the merchant. Returns how many were new. */
export async function enqueueMerchantEvent(
  sink: MerchantEventSink,
  merchantId: string,
  event: MerchantEvent,
  now: Date,
): Promise<number> {
  const endpoints = await sink.endpoints.listActiveByMerchant(merchantId);
  if (endpoints.length === 0) return 0;
  const body = JSON.stringify({
    id: event.id,
    type: event.type,
    occurredAt: event.occurredAt.toISOString(),
    data: event.data,
  });
  return sink.deliveries.insertMany(
    endpoints.map((endpoint) => ({
      id: generateId("whd", now.getTime()),
      eventId: event.id,
      endpointId: endpoint.id,
      merchantId,
      body,
      status: "PENDING" as const,
      attempts: 0,
      nextAttemptAt: now,
      createdAt: now,
      updatedAt: now,
    })),
  );
}
