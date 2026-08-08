/**
 * Admin routes.
 *
 * Registered only when `ADMIN_TOKEN` is set — an unconfigured deployment returns
 * 404 rather than exposing an unauthenticated trigger.
 */

import { randomBytes } from "node:crypto";
import type { WebhookEndpoint, WebhookEndpointRepository } from "@mayarin/notifications";
import { generateId, NotFoundError, ValidationError } from "@mayarin/shared";
import { pairsOf } from "@mayarin/stablecoin";
import { Hono } from "hono";
import type { Container } from "../container.ts";
import { toPaymentIntentDto } from "../dto/payment-intent.ts";
import { isMarketConfigKey, MARKET_CONFIG_KEYS } from "../market.ts";
import { adminTokenMiddleware } from "../middleware/admin-token.ts";

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
    if (typeof body.url !== "string" || !/^https?:\/\//.test(body.url)) {
      throw new ValidationError("url must be an http(s) URL");
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

  return app;
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
