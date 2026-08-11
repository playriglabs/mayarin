/**
 * Merchant webhook routes (#13).
 *
 * Mounted behind `require-auth` + `requirePermission("settings:manage")`. The
 * merchant is always the one on the session — no route takes a merchant id, so
 * there is nothing to tamper with.
 */

import { UnauthorizedError } from "@mayarin/shared";
import { Hono } from "hono";
import type { Container } from "../container.ts";
import {
  createEndpointBodySchema,
  listQuerySchema,
  toDeliveryDto,
  toEndpointDto,
} from "../dto/webhook.ts";
import { csrfMiddleware } from "../middleware/csrf.ts";
import type { AuthVars } from "../middleware/types.ts";

export function webhookRoutes(container: Container): Hono<{ Variables: AuthVars }> {
  const app = new Hono<{ Variables: AuthVars }>();

  const scopeOf = (c: { get: (key: "scope") => AuthVars["scope"] }) => {
    const scope = c.get("scope");
    if (scope === undefined) throw new UnauthorizedError("Authentication required");
    return scope;
  };

  app.get("/endpoints", async (c) => {
    const endpoints = await container.webhooks.listEndpoints(scopeOf(c));
    return c.json({ endpoints: endpoints.map(toEndpointDto) });
  });

  // The secret is returned exactly once, here. The listing never shows it again.
  app.post("/endpoints", csrfMiddleware(), async (c) => {
    const body = createEndpointBodySchema.parse(await c.req.json());
    const endpoint = await container.webhooks.createEndpoint(scopeOf(c), body.url);
    return c.json({ endpoint: toEndpointDto(endpoint), secret: endpoint.secret }, 201);
  });

  app.post("/endpoints/:id/rotate", csrfMiddleware(), async (c) => {
    const endpoint = await container.webhooks.rotateSecret(scopeOf(c), c.req.param("id"));
    return c.json({ endpoint: toEndpointDto(endpoint), secret: endpoint.secret });
  });

  app.post("/endpoints/:id/deactivate", csrfMiddleware(), async (c) => {
    const endpoint = await container.webhooks.deactivateEndpoint(scopeOf(c), c.req.param("id"));
    return c.json({ endpoint: toEndpointDto(endpoint) });
  });

  /** The inspection surface: a webhook a merchant cannot see is one they will not trust. */
  app.get("/deliveries", async (c) => {
    const query = listQuerySchema.parse(c.req.query());
    const page = await container.webhooks.listDeliveries(scopeOf(c), {
      ...(query.limit === undefined ? {} : { limit: query.limit }),
      ...(query.q === undefined ? {} : { q: query.q }),
      ...(query.status === undefined ? {} : { status: query.status }),
      ...(query.sort === undefined ? {} : { sort: query.sort }),
      ...(query.from === undefined ? {} : { from: query.from }),
      ...(query.to === undefined ? {} : { to: query.to }),
      ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
    });
    return c.json({ deliveries: page.items.map(toDeliveryDto), nextCursor: page.nextCursor });
  });

  app.post("/deliveries/:id/replay", csrfMiddleware(), async (c) => {
    const delivery = await container.webhooks.replayDelivery(scopeOf(c), c.req.param("id"));
    return c.json({ delivery: toDeliveryDto(delivery) }, 202);
  });

  return app;
}
