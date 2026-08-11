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
  q: z.string().trim().min(1).optional(),
  status: z
    .enum(["CREATED", "CONFIRMED", "PROCESSING", "COMPLETED", "FAILED", "EXPIRED"])
    .optional(),
  sort: z.enum(["created", "-created", "-amount"]).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  cursor: z.string().min(1).optional(),
});

export function orderRoutes(container: Container): Hono<{ Variables: AuthVars }> {
  const app = new Hono<{ Variables: AuthVars }>();

  app.get("/", async (c) => {
    const scope = c.get("scope");
    if (scope === undefined) throw new UnauthorizedError("Authentication required");
    const query = listQuerySchema.parse(c.req.query());

    if (query.customerId !== undefined) {
      const rows = await container.orders.listByCustomer(scope, query.customerId, query.limit);
      return c.json({ orders: rows.map(toOrderDto), nextCursor: null });
    }

    const page = await container.orders.list(scope, {
      ...(query.limit === undefined ? {} : { limit: query.limit }),
      ...(query.q === undefined ? {} : { q: query.q }),
      ...(query.status === undefined ? {} : { status: query.status }),
      ...(query.sort === undefined ? {} : { sort: query.sort }),
      ...(query.from === undefined ? {} : { from: query.from }),
      ...(query.to === undefined ? {} : { to: query.to }),
      ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
    });
    return c.json({ orders: page.items.map(toOrderDto), nextCursor: page.nextCursor });
  });

  return app;
}
