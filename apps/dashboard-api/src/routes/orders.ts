/**
 * Order routes — the commerce view of a merchant's payments.
 *
 * Mounted behind `require-auth` + `requirePermission("payments:read")`. Read
 * only, so no CSRF. Thin: parse query → call service → map DTO.
 */

import { UnauthorizedError } from "@mayarin/shared";
import { Hono } from "hono";
import { z } from "zod";
import type { Container } from "../container.ts";
import { toOrderDto } from "../dto/orders.ts";
import type { AuthVars } from "../middleware/types.ts";

const listQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(200).optional(),
  /** When set, lists only this customer's orders. Ownership is checked by the service. */
  customerId: z.string().min(1).optional(),
});

export function orderRoutes(container: Container): Hono<{ Variables: AuthVars }> {
  const app = new Hono<{ Variables: AuthVars }>();

  app.get("/", async (c) => {
    const scope = c.get("scope");
    if (scope === undefined) throw new UnauthorizedError("Authentication required");
    const { limit, customerId } = listQuerySchema.parse(c.req.query());

    const rows =
      customerId === undefined
        ? await container.orders.list(scope, limit)
        : await container.orders.listByCustomer(scope, customerId, limit);

    return c.json({ orders: rows.map(toOrderDto) });
  });

  return app;
}
