/**
 * Merchant-facing webhook service (#13).
 *
 * The delivery surface #13 asks for — *"a merchant can list their recent
 * deliveries with response status, and replay one"* — behind the merchant's own
 * session rather than an admin token. A webhook a merchant cannot see is a
 * webhook they will not trust, and a dead-lettered one they cannot see is a
 * payment they silently miss; neither is fixed by an endpoint only an operator
 * can call.
 *
 * Every method takes the caller's `Scope` and reads `scope.merchantId` from it.
 * No method accepts a merchant id, so one merchant cannot read another's
 * deliveries or replay them — the same rule the settings surface follows, and
 * for a stronger reason here: a delivery body carries payment detail.
 */

import { randomBytes } from "node:crypto";
import { lookup } from "node:dns/promises";
import type {
  ListWebhookDeliveriesOptions,
  WebhookDelivery,
  WebhookDeliveryRepository,
  WebhookEndpoint,
  WebhookEndpointRepository,
} from "@mayarin/notifications";
import { assertWebhookUrl, isPrivateAddress, replayed } from "@mayarin/notifications";
import {
  type Clock,
  ConflictError,
  generateId,
  NotFoundError,
  ValidationError,
} from "@mayarin/shared";
import type { Scope } from "../dto/auth.ts";
import { cursorPage, DEFAULT_PAGE_SIZE, decodeCursor } from "../pagination.ts";

/**
 * Resolves a hostname to its addresses.
 *
 * Injected rather than reached for, so the suite does not depend on a working
 * resolver — a registration test that needs DNS is a test that fails on a
 * plane. The composition root passes node's; a test passes whatever it is
 * asserting about.
 */
export type HostnameResolver = (hostname: string) => Promise<readonly string[]>;

export const systemResolver: HostnameResolver = async (hostname) =>
  (await lookup(hostname, { all: true })).map((entry) => entry.address);

export interface WebhookServiceOptions {
  readonly endpoints: WebhookEndpointRepository;
  readonly deliveries: WebhookDeliveryRepository;
  readonly clock: Clock;
  /** Caps a listing; the route's own limit is clamped to it. */
  readonly pageSize?: number;
  readonly resolver?: HostnameResolver;
}

export interface WebhookDeliveryListFilter {
  readonly limit?: number;
  readonly q?: string;
  readonly status?: WebhookDelivery["status"];
  readonly sort?: NonNullable<ListWebhookDeliveriesOptions["sort"]>;
  readonly from?: Date;
  readonly to?: Date;
  readonly cursor?: string;
}

export interface WebhookDeliveryPage {
  readonly items: readonly WebhookDelivery[];
  readonly nextCursor: string | null;
}

export class WebhookService {
  readonly #endpoints: WebhookEndpointRepository;
  readonly #deliveries: WebhookDeliveryRepository;
  readonly #clock: Clock;
  readonly #pageSize: number;
  readonly #resolver: HostnameResolver;

  constructor(options: WebhookServiceOptions) {
    this.#endpoints = options.endpoints;
    this.#deliveries = options.deliveries;
    this.#clock = options.clock;
    this.#pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE;
    this.#resolver = options.resolver ?? systemResolver;
  }

  async listEndpoints(scope: Scope): Promise<readonly WebhookEndpoint[]> {
    return this.#endpoints.listByMerchant(scope.merchantId);
  }

  /**
   * Registers where this merchant wants to be told.
   *
   * The secret is generated here and returned to the caller exactly once — the
   * listing never shows it again. One active endpoint per merchant, because a
   * fan-out that nobody asked for is a way to leak payment detail to a stale
   * URL somebody forgot about.
   */
  async createEndpoint(scope: Scope, url: string): Promise<WebhookEndpoint> {
    await assertPublicUrl(url, this.#resolver);

    const active = await this.#endpoints.listActiveByMerchant(scope.merchantId);
    if (active.length > 0) {
      throw new ConflictError("This merchant already has an active webhook endpoint", {
        merchantId: scope.merchantId,
        endpointId: active[0]?.id,
      });
    }

    const now = this.#clock.now();
    const endpoint: WebhookEndpoint = {
      id: generateId("whe", now.getTime()),
      merchantId: scope.merchantId,
      url,
      secret: newSecret(),
      active: true,
      createdAt: now,
      updatedAt: now,
    };
    await this.#endpoints.insert(endpoint);
    return endpoint;
  }

  /**
   * Rolls the signing secret, keeping the old one valid.
   *
   * Both are accepted while the merchant redeploys their verifier; without the
   * overlap a rotation drops every delivery in flight, which is the reason
   * merchants avoid rotating at all.
   */
  async rotateSecret(scope: Scope, endpointId: string): Promise<WebhookEndpoint> {
    const endpoint = await this.#ownEndpoint(scope, endpointId);
    const rotated: WebhookEndpoint = {
      ...endpoint,
      secret: newSecret(),
      previousSecret: endpoint.secret,
      updatedAt: this.#clock.now(),
    };
    await this.#endpoints.update(rotated);
    return rotated;
  }

  async deactivateEndpoint(scope: Scope, endpointId: string): Promise<WebhookEndpoint> {
    const endpoint = await this.#ownEndpoint(scope, endpointId);
    const deactivated: WebhookEndpoint = {
      ...endpoint,
      active: false,
      updatedAt: this.#clock.now(),
    };
    await this.#endpoints.update(deactivated);
    return deactivated;
  }

  async listDeliveries(
    scope: Scope,
    filter: WebhookDeliveryListFilter = {},
  ): Promise<WebhookDeliveryPage> {
    const limit = Math.min(filter.limit ?? this.#pageSize, this.#pageSize);
    const cursor = decodeCursor(filter.cursor);
    const rows = await this.#deliveries.listByMerchant({
      merchantId: scope.merchantId,
      limit: limit + 1,
      ...(filter.q === undefined ? {} : { q: filter.q }),
      ...(filter.status === undefined ? {} : { status: filter.status }),
      ...(filter.sort === undefined ? {} : { sort: filter.sort }),
      ...(filter.from === undefined ? {} : { from: filter.from }),
      ...(filter.to === undefined ? {} : { to: filter.to }),
      ...(cursor === undefined ? {} : { cursor: { id: cursor.id, createdAt: cursor.createdAt } }),
    });
    return cursorPage(rows, limit, (last) => ({ id: last.id, createdAt: last.createdAt }));
  }

  /**
   * Re-queues one of this merchant's deliveries.
   *
   * The body is untouched, so the receiver sees the same bytes and the same
   * `Webhook-Id` and can deduplicate — a replay is a second attempt at the same
   * delivery, never a second event.
   */
  async replayDelivery(scope: Scope, deliveryId: string): Promise<WebhookDelivery> {
    const delivery = await this.#deliveries.findById(deliveryId);
    // Not-found rather than forbidden for another merchant's delivery: a 403
    // would confirm the id exists, which is the one bit a caller should not
    // learn from an id they were never given.
    if (delivery === null || delivery.merchantId !== scope.merchantId) {
      throw new NotFoundError(`Webhook delivery ${deliveryId} not found`, { id: deliveryId });
    }

    const requeued = replayed(delivery, this.#clock.now());
    await this.#deliveries.update(requeued);
    return requeued;
  }

  async #ownEndpoint(scope: Scope, endpointId: string): Promise<WebhookEndpoint> {
    const endpoint = await this.#endpoints.findById(endpointId);
    if (endpoint === null || endpoint.merchantId !== scope.merchantId) {
      throw new NotFoundError(`Webhook endpoint ${endpointId} not found`, { id: endpointId });
    }
    return endpoint;
  }
}

function newSecret(): string {
  return `whsec_${randomBytes(24).toString("base64url")}`;
}

/**
 * The registration-time SSRF boundary: HTTPS, no literal private address, and
 * no hostname that resolves to one.
 *
 * The literal checks are pure and live in `@mayarin/notifications`; the DNS
 * lookup is I/O and stays here, at the edge. A name can re-resolve later, so
 * this is the cheap check rather than a substitute for egress policy.
 */
async function assertPublicUrl(url: string, resolve: HostnameResolver): Promise<void> {
  const parsed = assertWebhookUrl(url);

  let addresses: readonly string[];
  try {
    addresses = await resolve(parsed.hostname);
  } catch {
    throw new ValidationError("url hostname does not resolve");
  }
  if (addresses.some(isPrivateAddress)) {
    throw new ValidationError("url must not point at a private network");
  }
}
