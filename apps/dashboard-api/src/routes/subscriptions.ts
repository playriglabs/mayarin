/**
 * Subscription routes (#296).
 *
 * Behind `require-auth` + `catalog:manage`, the same permission as invoices:
 * a subscription is a schedule of invoices. Thin: parse → service → DTO.
 */

import { decimalMoneySchema, timestampSchema, UnauthorizedError } from "@mayarin/shared";
import { nextBillingAt, SUBSCRIPTION_INTERVALS, type Subscription } from "@mayarin/subscriptions";
import { Hono } from "hono";
import { z } from "zod";
import type { Container } from "../container.ts";
import { toInvoiceViewDto } from "../dto/invoices.ts";
import { toMoneyDto } from "../dto/money.ts";
import { csrfMiddleware } from "../middleware/csrf.ts";
import type { AuthVars } from "../middleware/types.ts";

const createSchema = z
  .object({
    customerId: z.string().min(1),
    description: z.string().trim().min(1).max(200),
    amount: decimalMoneySchema,
    interval: z.enum(SUBSCRIPTION_INTERVALS),
    startAt: timestampSchema.optional(),
    daysUntilDue: z.number().int().min(0).max(90),
  })
  .strict();

function toSubscriptionDto(subscription: Subscription) {
  return {
    id: subscription.id,
    subscriber: {
      customerId: subscription.subscriber.customerId,
      name: subscription.subscriber.name,
      email: subscription.subscriber.email ?? null,
    },
    description: subscription.description,
    amount: toMoneyDto(subscription.amount),
    interval: subscription.interval,
    state: subscription.state,
    billedCycles: subscription.billedCycles,
    daysUntilDue: subscription.daysUntilDue,
    anchorAt: subscription.anchorAt.toISOString(),
    // Only an active subscription has a next bill; a paused one's date is
    // recomputed on resume, and a cancelled one has none.
    nextBillingAt:
      subscription.state === "active" ? nextBillingAt(subscription).toISOString() : null,
    createdAt: subscription.createdAt.toISOString(),
    cancelledAt: subscription.cancelledAt?.toISOString() ?? null,
  };
}

export function subscriptionRoutes(container: Container): Hono<{ Variables: AuthVars }> {
  const app = new Hono<{ Variables: AuthVars }>();
  const checkoutBaseUrl = container.config.checkoutBaseUrl;

  const scopeOf = (c: { get: (key: "scope") => AuthVars["scope"] }) => {
    const scope = c.get("scope");
    if (scope === undefined) throw new UnauthorizedError("Authentication required");
    return scope;
  };

  app.get("/", async (c) => {
    const rows = await container.subscriptions.list(scopeOf(c));
    return c.json({ subscriptions: rows.map(toSubscriptionDto) });
  });

  app.post("/", csrfMiddleware(), async (c) => {
    const body = createSchema.parse(await c.req.json());
    const subscription = await container.subscriptions.create(scopeOf(c), {
      customerId: body.customerId,
      description: body.description,
      amount: body.amount,
      interval: body.interval,
      daysUntilDue: body.daysUntilDue,
      ...(body.startAt === undefined ? {} : { startAt: body.startAt }),
    });
    return c.json({ subscription: toSubscriptionDto(subscription) }, 201);
  });

  /** The subscription and every cycle's invoice, with its paid/overdue status. */
  app.get("/:id", async (c) => {
    const { subscription, cycles } = await container.subscriptions.detail(
      scopeOf(c),
      c.req.param("id"),
    );
    const views = await Promise.all(
      cycles.map((invoice) => container.invoices.viewInvoice(invoice.id)),
    );
    return c.json({
      subscription: toSubscriptionDto(subscription),
      cycles: views.map((view) => toInvoiceViewDto(view, checkoutBaseUrl)),
    });
  });

  for (const action of ["pause", "resume", "cancel"] as const) {
    app.post(`/:id/${action}`, csrfMiddleware(), async (c) => {
      const subscription = await container.subscriptions[action](scopeOf(c), c.req.param("id"));
      return c.json({ subscription: toSubscriptionDto(subscription) });
    });
  }

  return app;
}
