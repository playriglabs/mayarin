/**
 * Settlement routes (#15).
 *
 * A read of the merchant's own payouts. Mounted behind `require-auth` +
 * `requirePermission("payments:read")`: this is a deeper view of the payments
 * the caller can already see, not a wider one.
 */

import { UnauthorizedError } from "@mayarin/shared";
import { Hono } from "hono";
import { z } from "zod";
import type { Container } from "../container.ts";
import { toSettlementDto } from "../dto/settlement.ts";
import type { AuthVars } from "../middleware/types.ts";

const listQuerySchema = z.object({
  limit: z.coerce.number().int().positive().optional(),
});

export function settlementRoutes(container: Container): Hono<{ Variables: AuthVars }> {
  const app = new Hono<{ Variables: AuthVars }>();

  app.get("/", async (c) => {
    const scope = c.get("scope");
    if (scope === undefined) throw new UnauthorizedError("Authentication required");
    const { limit } = listQuerySchema.parse(c.req.query());
    const rows = await container.settlements.list(scope, limit);
    return c.json({ settlements: rows.map(toSettlementDto) });
  });

  return app;
}
