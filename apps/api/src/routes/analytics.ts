/**
 * Merchant analytics over the API: the figures the dashboard's Analytics page
 * draws, for an integration to read.
 *
 * Scoped by the key's merchant and needs `payments:read`. One request returns
 * every metric, the payer mix and per-network performance for a range.
 */

import { Hono } from "hono";
import type { Container } from "../container.ts";
import { analyticsQuerySchema } from "../dto/analytics.ts";
import { type ApiKeyAuthEnv, requireApiKey } from "../middleware/api-key.ts";

export function analyticsRoutes(container: Container): Hono<ApiKeyAuthEnv> {
  const app = new Hono<ApiKeyAuthEnv>();

  app.get("/", requireApiKey(container.verifyApiKey, "payments:read"), async (c) => {
    const query = analyticsQuerySchema.parse(c.req.query());
    return c.json(await container.analytics.report(c.get("scope").merchantId, query));
  });

  return app;
}
