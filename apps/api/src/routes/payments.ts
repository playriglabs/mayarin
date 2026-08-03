/**
 * Payment status route.
 *
 * One view of a payment: what was owed (the intent), how far along paying it is
 * (the clearing transaction), and how it got there (the timeline). Accepts
 * either the intent id or the clearing transaction id, since callers hold
 * whichever they were handed.
 */

import { hasPrefix } from "@mayarin/shared";
import { Hono } from "hono";
import type { Container } from "../container.ts";
import { toPaymentDto } from "../serialization.ts";

export function paymentRoutes(container: Container): Hono {
  const app = new Hono();

  app.get("/:id", async (c) => {
    const id = c.req.param("id");

    if (hasPrefix(id, "clr")) {
      const transaction = await container.engine.getById(id);
      const [intent, events] = await Promise.all([
        container.intents.getById(transaction.paymentIntentId),
        container.engine.history(transaction.id),
      ]);
      return c.json(toPaymentDto(intent, transaction, events));
    }

    const intent = await container.intents.getById(id);
    const transaction = await container.engine.findByPaymentIntentId(intent.id);
    const events = transaction === null ? [] : await container.engine.history(transaction.id);

    return c.json(toPaymentDto(intent, transaction, events));
  });

  return app;
}
