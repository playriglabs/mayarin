/**
 * Drizzle notification repositories (RFC #13).
 *
 * The outbox is a read over `clearing_events` joined to its transaction — no
 * second event table to keep in sync. Delivery uniqueness on
 * `(event_id, endpoint_id)` is the database's guarantee, expressed as
 * `ON CONFLICT DO NOTHING`, so a re-read of the outbox or a concurrent
 * dispatcher loses the race harmlessly.
 */

import type { ClearingEventType, ClearingState } from "@mayarin/clearing";
import {
  type NotifiableEvent,
  toWebhookEventType,
  type WebhookCursorRepository,
  type WebhookDelivery,
  type WebhookDeliveryRepository,
  type WebhookDeliveryStatus,
  type WebhookEndpoint,
  type WebhookEndpointRepository,
  type WebhookOutbox,
} from "@mayarin/notifications";
import { and, asc, desc, eq, gt, lte } from "drizzle-orm";
import type { Database } from "../client.ts";
import {
  clearingEvents,
  clearingTransactions,
  paymentIntents,
  webhookCursors,
  webhookDeliveries,
  webhookEndpoints,
} from "../schema.ts";

export class DrizzleWebhookOutbox implements WebhookOutbox {
  readonly #db: Database;

  constructor(db: Database) {
    this.#db = db;
  }

  async listAfter(cursor: string | undefined, limit: number): Promise<readonly NotifiableEvent[]> {
    const rows = await this.#db
      .select({
        id: clearingEvents.id,
        type: clearingEvents.type,
        toState: clearingEvents.toState,
        sequence: clearingEvents.sequence,
        occurredAt: clearingEvents.occurredAt,
        clearingTransactionId: clearingEvents.clearingTransactionId,
        merchantId: clearingTransactions.merchantId,
        paymentIntentId: clearingTransactions.paymentIntentId,
        metadata: paymentIntents.metadata,
      })
      .from(clearingEvents)
      .innerJoin(
        clearingTransactions,
        eq(clearingEvents.clearingTransactionId, clearingTransactions.id),
      )
      .innerJoin(paymentIntents, eq(clearingTransactions.paymentIntentId, paymentIntents.id))
      .where(cursor === undefined ? undefined : gt(clearingEvents.id, cursor))
      .orderBy(asc(clearingEvents.id))
      .limit(limit);

    return rows.map((row) => ({
      id: row.id,
      merchantId: row.merchantId,
      paymentIntentId: row.paymentIntentId,
      clearingTransactionId: row.clearingTransactionId,
      type: toWebhookEventType(row.type as ClearingEventType),
      state: row.toState as ClearingState,
      sequence: row.sequence,
      metadata: row.metadata,
      occurredAt: row.occurredAt,
    }));
  }
}

export class DrizzleWebhookCursorRepository implements WebhookCursorRepository {
  readonly #db: Database;
  readonly #consumer: string;

  constructor(db: Database, consumer = "webhook-dispatcher") {
    this.#db = db;
    this.#consumer = consumer;
  }

  async get(): Promise<string | undefined> {
    const [row] = await this.#db
      .select({ eventId: webhookCursors.eventId })
      .from(webhookCursors)
      .where(eq(webhookCursors.consumer, this.#consumer))
      .limit(1);
    return row?.eventId;
  }

  async set(eventId: string): Promise<void> {
    await this.#db
      .insert(webhookCursors)
      .values({ consumer: this.#consumer, eventId, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: webhookCursors.consumer,
        set: { eventId, updatedAt: new Date() },
      });
  }
}

export class DrizzleWebhookEndpointRepository implements WebhookEndpointRepository {
  readonly #db: Database;

  constructor(db: Database) {
    this.#db = db;
  }

  async insert(endpoint: WebhookEndpoint): Promise<void> {
    await this.#db.insert(webhookEndpoints).values(toEndpointRow(endpoint));
  }

  async update(endpoint: WebhookEndpoint): Promise<void> {
    await this.#db
      .update(webhookEndpoints)
      .set(toEndpointRow(endpoint))
      .where(eq(webhookEndpoints.id, endpoint.id));
  }

  async findById(id: string): Promise<WebhookEndpoint | null> {
    const [row] = await this.#db
      .select()
      .from(webhookEndpoints)
      .where(eq(webhookEndpoints.id, id))
      .limit(1);
    return row === undefined ? null : toEndpoint(row);
  }

  async listByMerchant(merchantId: string): Promise<readonly WebhookEndpoint[]> {
    const rows = await this.#db
      .select()
      .from(webhookEndpoints)
      .where(eq(webhookEndpoints.merchantId, merchantId))
      .orderBy(asc(webhookEndpoints.id));
    return rows.map(toEndpoint);
  }

  async listActiveByMerchant(merchantId: string): Promise<readonly WebhookEndpoint[]> {
    const rows = await this.#db
      .select()
      .from(webhookEndpoints)
      .where(and(eq(webhookEndpoints.merchantId, merchantId), eq(webhookEndpoints.active, true)))
      .orderBy(asc(webhookEndpoints.id));
    return rows.map(toEndpoint);
  }
}

export class DrizzleWebhookDeliveryRepository implements WebhookDeliveryRepository {
  readonly #db: Database;

  constructor(db: Database) {
    this.#db = db;
  }

  async insertMany(deliveries: readonly WebhookDelivery[]): Promise<number> {
    if (deliveries.length === 0) return 0;

    const inserted = await this.#db
      .insert(webhookDeliveries)
      .values(deliveries.map(toDeliveryRow))
      .onConflictDoNothing({
        target: [webhookDeliveries.eventId, webhookDeliveries.endpointId],
      })
      .returning({ id: webhookDeliveries.id });
    return inserted.length;
  }

  async update(delivery: WebhookDelivery): Promise<void> {
    await this.#db
      .update(webhookDeliveries)
      .set(toDeliveryRow(delivery))
      .where(eq(webhookDeliveries.id, delivery.id));
  }

  async listDue(now: Date, limit: number): Promise<readonly WebhookDelivery[]> {
    const rows = await this.#db
      .select()
      .from(webhookDeliveries)
      .where(
        and(eq(webhookDeliveries.status, "PENDING"), lte(webhookDeliveries.nextAttemptAt, now)),
      )
      .orderBy(asc(webhookDeliveries.nextAttemptAt))
      .limit(limit);
    return rows.map(toDelivery);
  }

  async findById(id: string): Promise<WebhookDelivery | null> {
    const [row] = await this.#db
      .select()
      .from(webhookDeliveries)
      .where(eq(webhookDeliveries.id, id))
      .limit(1);
    return row === undefined ? null : toDelivery(row);
  }

  async listByMerchant(merchantId: string, limit: number): Promise<readonly WebhookDelivery[]> {
    const rows = await this.#db
      .select()
      .from(webhookDeliveries)
      .where(eq(webhookDeliveries.merchantId, merchantId))
      .orderBy(desc(webhookDeliveries.id))
      .limit(limit);
    return rows.map(toDelivery);
  }
}

type EndpointRow = typeof webhookEndpoints.$inferSelect;
type DeliveryRow = typeof webhookDeliveries.$inferSelect;

function toEndpointRow(endpoint: WebhookEndpoint): EndpointRow {
  return {
    id: endpoint.id,
    merchantId: endpoint.merchantId,
    url: endpoint.url,
    secret: endpoint.secret,
    previousSecret: endpoint.previousSecret ?? null,
    active: endpoint.active,
    createdAt: endpoint.createdAt,
    updatedAt: endpoint.updatedAt,
  };
}

function toEndpoint(row: EndpointRow): WebhookEndpoint {
  return {
    id: row.id,
    merchantId: row.merchantId,
    url: row.url,
    secret: row.secret,
    ...(row.previousSecret === null ? {} : { previousSecret: row.previousSecret }),
    active: row.active,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toDeliveryRow(delivery: WebhookDelivery): DeliveryRow {
  return {
    id: delivery.id,
    eventId: delivery.eventId,
    endpointId: delivery.endpointId,
    merchantId: delivery.merchantId,
    body: delivery.body,
    status: delivery.status,
    attempts: delivery.attempts,
    nextAttemptAt: delivery.nextAttemptAt,
    lastStatusCode: delivery.lastStatusCode ?? null,
    lastError: delivery.lastError ?? null,
    deliveredAt: delivery.deliveredAt ?? null,
    createdAt: delivery.createdAt,
    updatedAt: delivery.updatedAt,
  };
}

function toDelivery(row: DeliveryRow): WebhookDelivery {
  return {
    id: row.id,
    eventId: row.eventId,
    endpointId: row.endpointId,
    merchantId: row.merchantId,
    body: row.body,
    status: row.status as WebhookDeliveryStatus,
    attempts: row.attempts,
    nextAttemptAt: row.nextAttemptAt,
    ...(row.lastStatusCode === null ? {} : { lastStatusCode: row.lastStatusCode }),
    ...(row.lastError === null ? {} : { lastError: row.lastError }),
    ...(row.deliveredAt === null ? {} : { deliveredAt: row.deliveredAt }),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
