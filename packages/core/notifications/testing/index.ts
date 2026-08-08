/**
 * Reference in-memory fakes for the notification ports, in the segregated
 * `/testing` subpath so domain `src/` stays pure.
 *
 * The outbox fake orders and filters by id exactly as the Drizzle adapter
 * will, so cursor behaviour is proven against the same contract.
 */

import type {
  NotifiableEvent,
  WebhookCursorRepository,
  WebhookDelivery,
  WebhookDeliveryRepository,
  WebhookEndpoint,
  WebhookEndpointRepository,
  WebhookOutbox,
  WebhookRequest,
  WebhookResponse,
  WebhookTransport,
} from "../src/index.ts";

export class InMemoryWebhookOutbox implements WebhookOutbox {
  readonly #events: NotifiableEvent[] = [];

  add(...events: readonly NotifiableEvent[]): void {
    this.#events.push(...events);
  }

  async listAfter(cursor: string | undefined, limit: number): Promise<readonly NotifiableEvent[]> {
    return this.#events
      .filter((event) => cursor === undefined || event.id > cursor)
      .sort((a, b) => (a.id < b.id ? -1 : 1))
      .slice(0, limit);
  }
}

export class InMemoryWebhookCursor implements WebhookCursorRepository {
  #value: string | undefined;

  async get(): Promise<string | undefined> {
    return this.#value;
  }

  async set(eventId: string): Promise<void> {
    this.#value = eventId;
  }
}

export class InMemoryWebhookEndpointRepository implements WebhookEndpointRepository {
  readonly #endpoints = new Map<string, WebhookEndpoint>();

  async insert(endpoint: WebhookEndpoint): Promise<void> {
    this.#endpoints.set(endpoint.id, endpoint);
  }

  async update(endpoint: WebhookEndpoint): Promise<void> {
    this.#endpoints.set(endpoint.id, endpoint);
  }

  async findById(id: string): Promise<WebhookEndpoint | null> {
    return this.#endpoints.get(id) ?? null;
  }

  async listByMerchant(merchantId: string): Promise<readonly WebhookEndpoint[]> {
    return [...this.#endpoints.values()].filter((endpoint) => endpoint.merchantId === merchantId);
  }

  async listActiveByMerchant(merchantId: string): Promise<readonly WebhookEndpoint[]> {
    return (await this.listByMerchant(merchantId)).filter((endpoint) => endpoint.active);
  }
}

export class InMemoryWebhookDeliveryRepository implements WebhookDeliveryRepository {
  readonly #deliveries = new Map<string, WebhookDelivery>();
  readonly #seen = new Set<string>();

  async insertMany(deliveries: readonly WebhookDelivery[]): Promise<number> {
    let inserted = 0;
    for (const delivery of deliveries) {
      const key = `${delivery.eventId}:${delivery.endpointId}`;
      if (this.#seen.has(key)) continue;
      this.#seen.add(key);
      this.#deliveries.set(delivery.id, delivery);
      inserted += 1;
    }
    return inserted;
  }

  async update(delivery: WebhookDelivery): Promise<void> {
    this.#deliveries.set(delivery.id, delivery);
  }

  async listDue(now: Date, limit: number): Promise<readonly WebhookDelivery[]> {
    return [...this.#deliveries.values()]
      .filter((delivery) => delivery.status === "PENDING" && delivery.nextAttemptAt <= now)
      .sort((a, b) => a.nextAttemptAt.getTime() - b.nextAttemptAt.getTime())
      .slice(0, limit);
  }

  /** Every delivery ever stored, for assertions. */
  all(): readonly WebhookDelivery[] {
    return [...this.#deliveries.values()];
  }
}

/**
 * Capturing transport. Responds 200 unless outcomes are queued; a queued
 * `Error` is thrown, a queued number is returned as the status.
 */
export class CapturingWebhookTransport implements WebhookTransport {
  readonly requests: WebhookRequest[] = [];
  readonly #outcomes: Array<number | Error> = [];

  queue(...outcomes: ReadonlyArray<number | Error>): void {
    this.#outcomes.push(...outcomes);
  }

  async post(request: WebhookRequest): Promise<WebhookResponse> {
    this.requests.push(request);
    const outcome = this.#outcomes.shift() ?? 200;
    if (outcome instanceof Error) throw outcome;
    return { status: outcome };
  }
}
