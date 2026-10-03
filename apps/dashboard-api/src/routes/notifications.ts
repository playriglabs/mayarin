/**
 * Notification routes — the bell in the dashboard header.
 *
 * `GET /` is one page of the feed (`limit`, an offset `cursor`, a `category`
 * filter) with the unread count across all of it; `POST /read` marks everything in it seen for the
 * signed-in account. An API key has no account to mark, so it reads the feed
 * with everything unread and cannot mark it.
 */

import { UnauthorizedError } from "@mayarin/shared";
import { Hono } from "hono";
import { z } from "zod";
import type { Container } from "../container.ts";
import { NOTIFICATION_CATEGORIES, toNotificationDto } from "../dto/notifications.ts";
import { csrfMiddleware } from "../middleware/csrf.ts";
import type { AuthVars } from "../middleware/types.ts";
import type { NotificationReader } from "../services/notification-service.ts";

const feedQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(50).default(10),
  cursor: z.string().min(1).optional(),
  category: z.enum(NOTIFICATION_CATEGORIES).optional(),
});

export function notificationRoutes(container: Container): Hono<{ Variables: AuthVars }> {
  const app = new Hono<{ Variables: AuthVars }>();

  app.get("/", async (c) => {
    const scope = c.get("scope");
    if (scope === undefined) throw new UnauthorizedError("Authentication required");
    const query = feedQuerySchema.parse(c.req.query());
    const feed = await container.notifications.feed(scope, readerOf(c.get("session")), {
      limit: query.limit,
      ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
      ...(query.category === undefined ? {} : { category: query.category }),
    });
    return c.json({
      notifications: feed.notifications.map(toNotificationDto),
      unread: feed.unread,
      nextCursor: feed.nextCursor,
    });
  });

  app.post("/read", csrfMiddleware(), async (c) => {
    const reader = readerOf(c.get("session"));
    if (reader === undefined) throw new UnauthorizedError("Sign in to mark notifications read");
    await container.notifications.markAllRead(reader);
    return c.body(null, 204);
  });

  return app;
}

function readerOf(session: AuthVars["session"]): NotificationReader | undefined {
  return session === undefined
    ? undefined
    : { userId: session.user.id, sessionId: session.session.id };
}
