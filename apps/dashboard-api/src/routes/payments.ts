/**
 * Payment routes — merchant/admin scoped reads.
 *
 * Mounted behind `require-auth`, so a verified session and its `Scope` are
 * present. The scope decides what the caller sees; the service enforces the
 * per-payment visibility split. Thin: parse query → call service → map DTO.
 */

import { UnauthorizedError } from "@mayarin/shared";
import { Hono } from "hono";
import { z } from "zod";
import type { Container } from "../container.ts";
import { toPaymentDetailDto, toPaymentIntentDto } from "../dto/payment.ts";
import type { AuthVars } from "../middleware/types.ts";

const listQuerySchema = z.object({
  limit: z.coerce.number().int().positive().optional(),
});

export function paymentRoutes(container: Container): Hono<{ Variables: AuthVars }> {
  const app = new Hono<{ Variables: AuthVars }>();

  app.get("/", async (c) => {
    const scope = c.get("scope");
    if (scope === undefined) throw new UnauthorizedError("Authentication required");
    const { limit } = listQuerySchema.parse(c.req.query());
    const intents = await container.payments.list(scope, limit);
    return c.json({ payments: intents.map(toPaymentIntentDto) });
  });

  app.get("/:id", async (c) => {
    const scope = c.get("scope");
    if (scope === undefined) throw new UnauthorizedError("Authentication required");
    const { intent, transaction, events } = await container.payments.get(scope, c.req.param("id"));
    return c.json(toPaymentDetailDto(intent, transaction, events));
  });

  return app;
}
