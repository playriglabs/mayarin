/**
 * Admin routes.
 *
 * Registered only when `ADMIN_TOKEN` is set — an unconfigured deployment returns
 * 404 rather than exposing an unauthenticated trigger.
 */

import { randomBytes } from "node:crypto";
import { lookup } from "node:dns/promises";
import {
  assertWebhookUrl,
  isPrivateAddress,
  replayed,
  type WebhookDelivery,
  type WebhookDeliveryRepository,
  type WebhookEndpoint,
  type WebhookEndpointRepository,
} from "@mayarin/notifications";
import {
  ConflictError,
  fromDecimalString,
  generateId,
  NotFoundError,
  ValidationError,
} from "@mayarin/shared";
import { pairsOf } from "@mayarin/stablecoin";
import { Hono } from "hono";
import type { Container } from "../container.ts";
import { toPaymentIntentDto } from "../dto/payment-intent.ts";
import { toX402ResourceDto, x402ResourceSchema } from "../dto/x402-resource.ts";
import { isMarketConfigKey, MARKET_CONFIG_KEYS } from "../market.ts";
import { adminTokenMiddleware } from "../middleware/admin-token.ts";
import { requireX402 } from "./x402.ts";

export function adminRoutes(container: Container, token: string): Hono {
  const app = new Hono();

  app.use("*", adminTokenMiddleware(token));

  /** Forces one watcher pass over every configured pair. */
  app.post("/watcher/tick", async (c) => {
    const chain = container.config.chain;
    if (chain === undefined || container.watchers.size === 0) {
      throw new ValidationError("The chain layer is not enabled on this deployment");
    }

    const results = [];
    for (const pair of pairsOf(container.config.stablecoins)) {
      const watcher = container.watchers.get(pair.chain);
      if (watcher === undefined) continue;
      const result = await watcher.tick(pair.chain, pair.asset);
      results.push({
        chain: result.chain,
        asset: result.asset,
        scannedFrom: result.scannedFrom.toString(),
        scannedTo: result.scannedTo.toString(),
        recorded: result.recorded,
        confirmed: result.confirmed,
        orphaned: result.orphaned,
        funded: result.funded,
      });
    }

    return c.json({ passes: results });
  });

  /**
   * Looks payments up by the merchant's own order id.
   *
   * Behind the admin token rather than on the public surface: an intent id is
   * an unguessable ULID, but a merchant reference is `INV-1042`, so an
   * unauthenticated lookup would enumerate every payment a merchant ever took.
   */
  app.get("/payment-intents", async (c) => {
    const merchantId = c.req.query("merchantId");
    const merchantReference = c.req.query("merchantReference");
    if (merchantId === undefined) {
      throw new ValidationError("merchantId is required");
    }

    const intents = await container.intents.list({
      merchantId,
      ...(merchantReference === undefined ? {} : { merchantReference }),
    });

    return c.json({ paymentIntents: intents.map(toPaymentIntentDto) });
  });

  /**
   * Runtime market configuration (#95).
   *
   * Which stablecoins are admitted, which oracle feed serves a pair, which pool
   * prices a swap. Behind the admin token because a writable feed map is a
   * writable price: an endpoint that can point a feed at the wrong id can
   * mis-price every payment until someone notices.
   */
  app.get("/market-config", async (c) => {
    const entries = await container.market.entries();
    return c.json({
      keys: MARKET_CONFIG_KEYS,
      entries: entries.map((entry) => ({
        key: entry.key,
        value: entry.value,
        updatedAt: entry.updatedAt.toISOString(),
        updatedBy: entry.updatedBy ?? null,
      })),
    });
  });

  app.put("/market-config/:key", async (c) => {
    const key = c.req.param("key");
    if (!isMarketConfigKey(key)) {
      // A closed set: an operator can change what a key means, never invent one
      // nothing reads. A typo would otherwise be stored and silently ignored.
      throw new ValidationError(`Unknown market config key "${key}"`, {
        key,
        known: [...MARKET_CONFIG_KEYS],
      });
    }

    const body = await c.req.json();
    // Validated before it is stored, and the in-memory snapshot is left alone
    // if it fails — a bad write cannot mis-price a payment.
    await container.market.put(key, body.value);

    return c.json({ key, updated: true });
  });

  /** Forces one webhook dispatcher pass: enqueue new events, attempt due deliveries. */
  app.post("/webhooks/tick", async (c) => {
    if (container.webhooks === undefined) {
      throw new ValidationError("Webhooks are not enabled on this deployment");
    }
    return c.json(await container.webhooks.tick());
  });

  /**
   * Endpoint configuration (RFC #13).
   *
   * Admin-token guarded for now: merchant self-service belongs to the
   * authenticated merchant-config surface #95 designs, and moves there with it.
   * The secret is returned exactly once, at creation and rotation.
   */
  app.post("/webhooks/endpoints", async (c) => {
    const endpoints = requireEndpoints(container);
    const body = await c.req.json<{ merchantId?: string; url?: string }>();
    if (typeof body.merchantId !== "string" || body.merchantId.length === 0) {
      throw new ValidationError("merchantId is required");
    }
    if (typeof body.url !== "string") {
      throw new ValidationError("url is required");
    }
    await assertPublicWebhookUrl(body.url);

    // One endpoint per merchant in the first cut (RFC #13 non-goal: fan-out).
    // Rotate or deactivate the existing one instead of accumulating a second.
    if ((await endpoints.listActiveByMerchant(body.merchantId)).length > 0) {
      throw new ConflictError("The merchant already has an active endpoint", {});
    }

    const now = new Date();
    const endpoint: WebhookEndpoint = {
      id: generateId("whe", now.getTime()),
      merchantId: body.merchantId,
      url: body.url,
      secret: newSecret(),
      active: true,
      createdAt: now,
      updatedAt: now,
    };
    await endpoints.insert(endpoint);

    return c.json({ ...toEndpointDto(endpoint), secret: endpoint.secret }, 201);
  });

  app.get("/webhooks/endpoints", async (c) => {
    const endpoints = requireEndpoints(container);
    const merchantId = c.req.query("merchantId");
    if (merchantId === undefined || merchantId.length === 0) {
      throw new ValidationError("merchantId is required");
    }
    return c.json({
      endpoints: (await endpoints.listByMerchant(merchantId)).map(toEndpointDto),
    });
  });

  app.post("/webhooks/endpoints/:id/rotate", async (c) => {
    const endpoints = requireEndpoints(container);
    const endpoint = await findEndpoint(endpoints, c.req.param("id"));

    const rotated: WebhookEndpoint = {
      ...endpoint,
      secret: newSecret(),
      previousSecret: endpoint.secret,
      updatedAt: new Date(),
    };
    await endpoints.update(rotated);

    return c.json({ ...toEndpointDto(rotated), secret: rotated.secret });
  });

  app.post("/webhooks/endpoints/:id/deactivate", async (c) => {
    const endpoints = requireEndpoints(container);
    const endpoint = await findEndpoint(endpoints, c.req.param("id"));

    await endpoints.update({ ...endpoint, active: false, updatedAt: new Date() });
    return c.json({ id: endpoint.id, active: false });
  });

  /**
   * A merchant's recent deliveries, newest first — including DEAD ones. A
   * dead-lettered delivery only operators can see is a payment the merchant
   * silently misses.
   */
  app.get("/webhooks/deliveries", async (c) => {
    const deliveries = requireDeliveries(container);
    const merchantId = c.req.query("merchantId");
    if (merchantId === undefined || merchantId.length === 0) {
      throw new ValidationError("merchantId is required");
    }
    const limit = Math.min(Number(c.req.query("limit") ?? 50), 200);
    return c.json({
      deliveries: (await deliveries.listByMerchant({ merchantId, limit })).map(toDeliveryDto),
    });
  });

  /** Re-queues one delivery with a fresh schedule. Same body, same Webhook-Id. */
  app.post("/webhooks/deliveries/:id/replay", async (c) => {
    const deliveries = requireDeliveries(container);
    const id = c.req.param("id");
    const delivery = await deliveries.findById(id);
    if (delivery === null) {
      throw new NotFoundError(`Webhook delivery ${id} not found`);
    }

    const requeued = replayed(delivery, new Date());
    await deliveries.update(requeued);
    return c.json(toDeliveryDto(requeued), 202);
  });

  /**
   * Register an x402 resource.
   *
   * Admin rather than merchant-facing for now: a resource names the address a
   * payer is told to pay, so creating one is a deployment act, not a self-serve
   * one. Until this existed there was no way to give a running deployment a
   * resource at all — the registry's `save` had no caller — which meant no `402`
   * could be served by anything but a hand-written database row.
   *
   * The body names tokens, never their EIP-712 domain or transfer method: those
   * are read off the contracts, so a resource cannot be created advertising
   * terms no payer could sign.
   */
  app.post("/x402/resources", async (c) => {
    const service = requireX402(container);
    const body = x402ResourceSchema.parse(await c.req.json());

    const resource = await service.register({
      id: body.id,
      merchantId: body.merchantId,
      url: body.url,
      ...(body.description === undefined ? {} : { description: body.description }),
      ...(body.mimeType === undefined ? {} : { mimeType: body.mimeType }),
      price: fromDecimalString(body.price.amount, body.price.asset),
      accepts: body.accepts,
      maxTimeoutSeconds: body.maxTimeoutSeconds,
      // Omitted means unchanged: an operator re-registering a resource must
      // not silently unlist it (#273).
      ...(body.listed === undefined ? {} : { listed: body.listed }),
    });

    return c.json({ resource: toX402ResourceDto(resource) }, 201);
  });

  return app;
}

/**
 * The registration-time SSRF boundary: HTTPS, no literal private address, and
 * no hostname that resolves to one. A name can re-resolve later — this is the
 * cheap check, not a substitute for network-level egress policy.
 */
async function assertPublicWebhookUrl(url: string): Promise<void> {
  const parsed = assertWebhookUrl(url);

  let addresses: readonly { address: string }[];
  try {
    addresses = await lookup(parsed.hostname, { all: true });
  } catch {
    throw new ValidationError("url hostname does not resolve");
  }
  if (addresses.some((entry) => isPrivateAddress(entry.address))) {
    throw new ValidationError("url must not point at a private network");
  }
}

function requireDeliveries(container: Container): WebhookDeliveryRepository {
  if (container.webhookDeliveries === undefined) {
    throw new ValidationError("Webhooks are not enabled on this deployment");
  }
  return container.webhookDeliveries;
}

function toDeliveryDto(delivery: WebhookDelivery): Record<string, unknown> {
  return {
    id: delivery.id,
    eventId: delivery.eventId,
    endpointId: delivery.endpointId,
    merchantId: delivery.merchantId,
    status: delivery.status,
    attempts: delivery.attempts,
    nextAttemptAt: delivery.nextAttemptAt.toISOString(),
    lastStatusCode: delivery.lastStatusCode ?? null,
    lastError: delivery.lastError ?? null,
    deliveredAt: delivery.deliveredAt?.toISOString() ?? null,
    body: delivery.body,
    createdAt: delivery.createdAt.toISOString(),
  };
}

function requireEndpoints(container: Container): WebhookEndpointRepository {
  if (container.webhookEndpoints === undefined) {
    throw new ValidationError("Webhooks are not enabled on this deployment");
  }
  return container.webhookEndpoints;
}

async function findEndpoint(
  endpoints: WebhookEndpointRepository,
  id: string,
): Promise<WebhookEndpoint> {
  const endpoint = await endpoints.findById(id);
  if (endpoint === null) {
    throw new NotFoundError(`Webhook endpoint ${id} not found`);
  }
  return endpoint;
}

function newSecret(): string {
  return `whsec_${randomBytes(24).toString("base64url")}`;
}

/** The listing shape. Secrets never appear here — only creation and rotation show one. */
function toEndpointDto(endpoint: WebhookEndpoint): Record<string, unknown> {
  return {
    id: endpoint.id,
    merchantId: endpoint.merchantId,
    url: endpoint.url,
    active: endpoint.active,
    rotatedSecretActive: endpoint.previousSecret !== undefined,
    createdAt: endpoint.createdAt.toISOString(),
    updatedAt: endpoint.updatedAt.toISOString(),
  };
}
