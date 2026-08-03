/**
 * Provider webhook route.
 *
 * One endpoint per provider, resolved through the adapter registry — adding a
 * payment rail does not add a route.
 *
 * The raw body is passed through untouched so adapters can verify signatures
 * over exactly the bytes that were signed. A webhook only ever *wakes* the
 * clearing engine; the engine then confirms the outcome with the provider
 * before moving money.
 */

import { Hono } from "hono";
import type { Container } from "../container.ts";
import { toClearingDto } from "../serialization.ts";

export function webhookRoutes(container: Container): Hono {
  const app = new Hono();

  app.post("/:provider", async (c) => {
    const provider = c.req.param("provider");
    const rawBody = await c.req.text();

    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(c.req.header())) {
      if (value !== undefined) headers[key.toLowerCase()] = value;
    }

    const progress = await container.engine.handleSettlementWebhook(provider, {
      headers,
      rawBody,
    });

    // Always acknowledge a well-formed delivery: an event Mayarin has nothing to
    // do with must not make the provider retry forever.
    return c.json(
      {
        received: true,
        clearing: progress === null ? null : toClearingDto(progress.transaction),
      },
      202,
    );
  });

  return app;
}
