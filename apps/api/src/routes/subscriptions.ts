/**
 * Subscription routes (#296).
 *
 * Writes need `catalog:manage`, the same permission as invoices: a
 * subscription is a schedule of invoices. Reads need any key of the merchant,
 * because a subscription names its subscriber. Thin: parse → service → DTO.
 */

import { Hono } from "hono";
import type { Container } from "../container.ts";
import { toInvoiceViewDto } from "../dto/invoice.ts";
import { createSubscriptionBodySchema, toSubscriptionDto } from "../dto/subscription.ts";
import { type ApiKeyAuthEnv, requireApiKey } from "../middleware/api-key.ts";

export function subscriptionRoutes(container: Container): Hono<ApiKeyAuthEnv> {
  const app = new Hono<ApiKeyAuthEnv>();
  const baseUrl = container.config.checkoutBaseUrl;
  const auth = requireApiKey(container.verifyApiKey);
  const manage = requireApiKey(container.verifyApiKey, "catalog:manage");

  app.post("/", manage, async (c) => {
    const body = createSubscriptionBodySchema.parse(await c.req.json());
    const subscription = await container.subscriptions.create(c.get("scope").merchantId, {
      customer: body.customer,
      description: body.description,
      amount: body.amount,
      interval: body.interval,
      daysUntilDue: body.daysUntilDue,
      ...(body.startAt === undefined ? {} : { startAt: body.startAt }),
    });
    return c.json({ subscription: toSubscriptionDto(subscription) }, 201);
  });

  app.get("/", auth, async (c) => {
    const rows = await container.subscriptions.list(c.get("scope").merchantId);
    return c.json({ subscriptions: rows.map(toSubscriptionDto) });
  });

  /** The subscription and every cycle's invoice, each with its pay URL and status. */
  app.get("/:id", auth, async (c) => {
    const { subscription, cycles } = await container.subscriptions.get(
      c.get("scope").merchantId,
      c.req.param("id"),
    );
    const views = await Promise.all(
      cycles.map((invoice) => container.invoices.viewInvoice(invoice.id)),
    );
    return c.json({
      subscription: toSubscriptionDto(subscription),
      cycles: views.map((view) => toInvoiceViewDto(view, baseUrl)),
    });
  });

  for (const action of ["pause", "resume", "cancel"] as const) {
    app.post(`/:id/${action}`, manage, async (c) => {
      const subscription = await container.subscriptions[action](
        c.get("scope").merchantId,
        c.req.param("id"),
      );
      return c.json({ subscription: toSubscriptionDto(subscription) });
    });
  }

  return app;
}
