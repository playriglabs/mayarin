/**
 * Persistence and outbox ports.
 *
 * The outbox is the seam onto the clearing event log: every state transition
 * already appends a `ClearingEvent` in the same database transaction as the
 * state change, so those rows are the durable record deliveries derive from.
 * Nothing here asks the engine to publish anything extra — a crash between a
 * transition and a delivery loses nothing, because the next tick re-reads the
 * log from the cursor.
 */

import type { NotifiableEvent, WebhookDelivery, WebhookEndpoint } from "./types.ts";

export interface WebhookOutbox {
  /**
   * Events with an id after `cursor`, oldest first. Event ids are ULIDs, so id
   * order is creation order and the cursor is just the last id processed.
   */
  listAfter(cursor: string | undefined, limit: number): Promise<readonly NotifiableEvent[]>;
}

/** Where the dispatcher's read position survives a restart. */
export interface WebhookCursorRepository {
  get(): Promise<string | undefined>;
  set(eventId: string): Promise<void>;
}

export interface WebhookEndpointRepository {
  insert(endpoint: WebhookEndpoint): Promise<void>;
  update(endpoint: WebhookEndpoint): Promise<void>;
  findById(id: string): Promise<WebhookEndpoint | null>;
  listByMerchant(merchantId: string): Promise<readonly WebhookEndpoint[]>;
  listActiveByMerchant(merchantId: string): Promise<readonly WebhookEndpoint[]>;
}

export interface WebhookDeliveryRepository {
  /**
   * Inserts, skipping any `(eventId, endpointId)` pair already present, and
   * returns how many rows were actually inserted. That key is what makes
   * re-reading the outbox harmless: a replayed event maps onto the delivery it
   * already has, and counts as zero.
   */
  insertMany(deliveries: readonly WebhookDelivery[]): Promise<number>;
  update(delivery: WebhookDelivery): Promise<void>;
  /** PENDING deliveries whose `nextAttemptAt` has passed, oldest due first. */
  listDue(now: Date, limit: number): Promise<readonly WebhookDelivery[]>;
  findById(id: string): Promise<WebhookDelivery | null>;
  /**
   * A merchant's recent deliveries, newest first. This is the inspection
   * surface the RFC requires: a webhook a merchant cannot see is a webhook
   * they will not trust — and a dead-lettered one they cannot see is a payment
   * they silently miss.
   */
  listByMerchant(merchantId: string, limit: number): Promise<readonly WebhookDelivery[]>;
}

/**
 * Re-queues a delivery, whatever state it is in. Attempts restart so a replay
 * gets the full schedule; the body is untouched, so the receiver sees the same
 * bytes and the same `Webhook-Id` and can deduplicate.
 */
export function replayed(delivery: WebhookDelivery, now: Date): WebhookDelivery {
  return {
    ...delivery,
    status: "PENDING",
    attempts: 0,
    nextAttemptAt: now,
    updatedAt: now,
  };
}
