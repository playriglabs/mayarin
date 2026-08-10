/**
 * Event log routes — the merchant timeline.
 *
 * Read-only, `payments:read`, no CSRF. Mirrors `routes/settlements.ts`: scope
 * guard, parse `limit`, hand to the service, map to DTOs.
 */

import { UnauthorizedError } from "@mayarin/shared";
import { Hono } from "hono";
import { z } from "zod";
import type { Container } from "../container.ts";
import { toEventDto } from "../dto/event-logs.ts";
import type { AuthVars } from "../middleware/types.ts";

const listQuerySchema = z.object({
  limit: z.coerce.number().int().positive().optional(),
});

export function eventLogRoutes(container: Container): Hono<{ Variables: AuthVars }> {
  const app = new Hono<{ Variables: AuthVars }>();
  app.get("/", async (c) => {
    const scope = c.get("scope");
    if (scope === undefined) throw new UnauthorizedError("Authentication required");
    const { limit } = listQuerySchema.parse(c.req.query());
    const rows = await container.eventLogs.list(scope, limit);
    return c.json({ events: rows.map(toEventDto) });
  });
  return app;
}
