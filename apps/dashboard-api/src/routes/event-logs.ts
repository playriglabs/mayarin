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
import { refreshStream } from "./refresh-stream.ts";

const listQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(200).optional(),
  q: z.string().trim().min(1).optional(),
  status: z.enum(["info", "success", "warning", "error"]).optional(),
  sort: z.enum(["created", "-created"]).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  cursor: z.string().min(1).optional(),
});

export function eventLogRoutes(container: Container): Hono<{ Variables: AuthVars }> {
  const app = new Hono<{ Variables: AuthVars }>();
  app.get("/events", async (c) => {
    const scope = c.get("scope");
    if (scope === undefined) throw new UnauthorizedError("Authentication required");

    return refreshStream(c, "event-logs");
  });
  app.get("/", async (c) => {
    const scope = c.get("scope");
    if (scope === undefined) throw new UnauthorizedError("Authentication required");
    const query = listQuerySchema.parse(c.req.query());
    const page = await container.eventLogs.list(scope, {
      ...(query.limit === undefined ? {} : { limit: query.limit }),
      ...(query.q === undefined ? {} : { q: query.q }),
      ...(query.status === undefined ? {} : { status: query.status }),
      ...(query.sort === undefined ? {} : { sort: query.sort }),
      ...(query.from === undefined ? {} : { from: query.from }),
      ...(query.to === undefined ? {} : { to: query.to }),
      ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
    });
    return c.json({ events: page.items.map(toEventDto), nextCursor: page.nextCursor });
  });
  return app;
}
