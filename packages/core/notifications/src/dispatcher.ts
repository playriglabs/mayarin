/**
 * Webhook dispatcher.
 *
 * One `tick()` is one complete pass, in the watcher's shape: enqueue
 * deliveries for clearing events the cursor has not passed, then attempt every
 * delivery that is due. Both halves are idempotent — deliveries are keyed
 * `(eventId, endpointId)` and the cursor is written last — so a crash anywhere
 * in a pass repeats harmless work rather than losing or duplicating a
 * delivery.
 *
 * Retry is a fixed backoff schedule, then a dead letter. A delivery in `DEAD`
 * is visible and re-drivable by an operator; it never blocks the queue behind
 * it.
 */

import { type Clock, generateId } from "@mayarin/shared";
import type {
  WebhookCursorRepository,
  WebhookDeliveryRepository,
  WebhookEndpointRepository,
  WebhookOutbox,
} from "./repository.ts";
import {
  signWebhook,
  WEBHOOK_ID_HEADER,
  WEBHOOK_SIGNATURE_HEADER,
  WEBHOOK_TIMESTAMP_HEADER,
} from "./signature.ts";
import type { WebhookTransport } from "./transport.ts";
import type { NotifiableEvent, WebhookDelivery, WebhookEndpoint } from "./types.ts";

/** Seconds until each retry. One initial attempt plus one per entry, then DEAD. */
export const DEFAULT_BACKOFF_SECONDS = [60, 300, 1_800, 7_200, 43_200] as const;

export interface WebhookDispatcherOptions {
  readonly outbox: WebhookOutbox;
  readonly cursor: WebhookCursorRepository;
  readonly endpoints: WebhookEndpointRepository;
  readonly deliveries: WebhookDeliveryRepository;
  readonly transport: WebhookTransport;
  readonly clock: Clock;
  readonly backoffSeconds?: readonly number[];
  /** Cap on events enqueued and deliveries attempted per tick. */
  readonly batchSize?: number;
}

export interface DispatchTickResult {
  readonly enqueued: number;
  readonly delivered: number;
  readonly retried: number;
  readonly dead: number;
}

export class WebhookDispatcher {
  readonly #outbox: WebhookOutbox;
  readonly #cursor: WebhookCursorRepository;
  readonly #endpoints: WebhookEndpointRepository;
  readonly #deliveries: WebhookDeliveryRepository;
  readonly #transport: WebhookTransport;
  readonly #clock: Clock;
  readonly #backoffSeconds: readonly number[];
  readonly #batchSize: number;

  constructor(options: WebhookDispatcherOptions) {
    this.#outbox = options.outbox;
    this.#cursor = options.cursor;
    this.#endpoints = options.endpoints;
    this.#deliveries = options.deliveries;
    this.#transport = options.transport;
    this.#clock = options.clock;
    this.#backoffSeconds = options.backoffSeconds ?? DEFAULT_BACKOFF_SECONDS;
    this.#batchSize = options.batchSize ?? 50;
  }

  async tick(): Promise<DispatchTickResult> {
    const enqueued = await this.#enqueue();
    const attempted = await this.#deliver();
    return { enqueued, ...attempted };
  }

  async #enqueue(): Promise<number> {
    const cursor = await this.#cursor.get();
    const events = await this.#outbox.listAfter(cursor, this.#batchSize);
    let enqueued = 0;

    for (const event of events) {
      const endpoints = await this.#endpoints.listActiveByMerchant(event.merchantId);
      if (endpoints.length === 0) continue;

      const now = this.#clock.now();
      enqueued += await this.#deliveries.insertMany(
        endpoints.map((endpoint) => this.#createDelivery(event, endpoint, now)),
      );
    }

    // Written last, per the watcher's rule: a crash before this line re-reads
    // the same events, and the delivery key makes that free.
    const last = events[events.length - 1];
    if (last !== undefined) await this.#cursor.set(last.id);

    return enqueued;
  }

  #createDelivery(event: NotifiableEvent, endpoint: WebhookEndpoint, now: Date): WebhookDelivery {
    return {
      id: generateId("whd", now.getTime()),
      eventId: event.id,
      endpointId: endpoint.id,
      merchantId: event.merchantId,
      body: toBody(event),
      status: "PENDING",
      attempts: 0,
      nextAttemptAt: now,
      createdAt: now,
      updatedAt: now,
    };
  }

  async #deliver(): Promise<{ delivered: number; retried: number; dead: number }> {
    const due = await this.#deliveries.listDue(this.#clock.now(), this.#batchSize);
    let delivered = 0;
    let retried = 0;
    let dead = 0;

    for (const delivery of due) {
      const endpoint = await this.#endpoints.findById(delivery.endpointId);

      // An endpoint that is gone or switched off can never accept this
      // delivery. Parking it as DEAD keeps the record; retrying it forever
      // would just hide the misconfiguration.
      if (endpoint === null || !endpoint.active) {
        await this.#deliveries.update({
          ...delivery,
          status: "DEAD",
          lastError: "endpoint inactive",
          updatedAt: this.#clock.now(),
        });
        dead += 1;
        continue;
      }

      const outcome = await this.#attempt(delivery, endpoint);
      if (outcome === "delivered") delivered += 1;
      else if (outcome === "retried") retried += 1;
      else dead += 1;
    }

    return { delivered, retried, dead };
  }

  async #attempt(
    delivery: WebhookDelivery,
    endpoint: WebhookEndpoint,
  ): Promise<"delivered" | "retried" | "dead"> {
    const now = this.#clock.now();
    const secrets =
      endpoint.previousSecret === undefined
        ? [endpoint.secret]
        : [endpoint.secret, endpoint.previousSecret];

    const request = {
      url: endpoint.url,
      body: delivery.body,
      headers: {
        "content-type": "application/json",
        [WEBHOOK_ID_HEADER]: delivery.eventId,
        [WEBHOOK_TIMESTAMP_HEADER]: String(Math.floor(now.getTime() / 1_000)),
        [WEBHOOK_SIGNATURE_HEADER]: signWebhook({ secrets, timestamp: now, body: delivery.body }),
      },
    };

    let statusCode: number | undefined;
    let error: string | undefined;
    try {
      const response = await this.#transport.post(request);
      statusCode = response.status;
    } catch (caught) {
      error = caught instanceof Error ? caught.message : String(caught);
    }

    if (statusCode !== undefined && statusCode >= 200 && statusCode < 300) {
      await this.#deliveries.update({
        ...delivery,
        status: "DELIVERED",
        attempts: delivery.attempts + 1,
        lastStatusCode: statusCode,
        deliveredAt: now,
        updatedAt: now,
      });
      return "delivered";
    }

    const failed = this.#failed(delivery, now, {
      ...(statusCode === undefined ? {} : { statusCode }),
      ...(error === undefined ? {} : { error }),
    });
    await this.#deliveries.update(failed);
    return failed.status === "DEAD" ? "dead" : "retried";
  }

  #failed(
    delivery: WebhookDelivery,
    now: Date,
    outcome: { readonly statusCode?: number; readonly error?: string },
  ): WebhookDelivery {
    const attempts = delivery.attempts + 1;
    const backoffSeconds = this.#backoffSeconds[attempts - 1];

    return {
      ...delivery,
      status: backoffSeconds === undefined ? "DEAD" : "PENDING",
      attempts,
      nextAttemptAt:
        backoffSeconds === undefined ? now : new Date(now.getTime() + backoffSeconds * 1_000),
      ...(outcome.statusCode === undefined ? {} : { lastStatusCode: outcome.statusCode }),
      ...(outcome.error === undefined ? {} : { lastError: outcome.error }),
      updatedAt: now,
    };
  }
}

/** The payload a receiver sees: ids and the new state, never amounts to book against. */
function toBody(event: NotifiableEvent): string {
  return JSON.stringify({
    id: event.id,
    type: event.type,
    occurredAt: event.occurredAt.toISOString(),
    data: {
      paymentIntentId: event.paymentIntentId,
      clearingTransactionId: event.clearingTransactionId,
      state: event.state,
    },
  });
}
