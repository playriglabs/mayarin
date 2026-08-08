/**
 * HTTP surface.
 *
 * Wiring only — no logic. The session middleware runs for every request so any
 * handler can read the verified session off the context; route groups add
 * `require-auth`/`require-permission`/`csrf` as needed. `onError` is the single
 * point that maps the domain error taxonomy onto HTTP.
 */

import { NotFoundError } from "@mayarin/shared";
import { Hono } from "hono";
import type { Container } from "./container.ts";
import { errorHandler } from "./errors.ts";
import { requireAuth } from "./middleware/require-auth.ts";
import { requirePermission } from "./middleware/require-permission.ts";
import { sessionMiddleware } from "./middleware/session.ts";
import type { AuthVars } from "./middleware/types.ts";
import { adminRoutes } from "./routes/admin.ts";
import { auditRoutes } from "./routes/audit.ts";
import { authRoutes } from "./routes/auth.ts";
import { healthRoutes } from "./routes/health.ts";
import { paymentRoutes } from "./routes/payments.ts";

export function createApp(container: Container): Hono<{ Variables: AuthVars }> {
  const app = new Hono<{ Variables: AuthVars }>();

  app.onError(errorHandler);
  app.notFound(() => {
    throw new NotFoundError("Route not found");
  });

  // Stamps `session`/`scope` on the context when a valid session cookie is
  // present; a no-op for anonymous requests.
  app.use("*", sessionMiddleware(container.sessions));

  app.route("/", healthRoutes());
  app.route("/auth", authRoutes(container));

  // Authenticated merchant reads (own merchant only — no cross-merchant view).
  app.use("/payments/*", requireAuth(), requirePermission("payments:read"));
  app.route("/payments", paymentRoutes(container));

  // The compliance audit trail (#16). Same permission as payments: it is a
  // deeper view of the same records, not a wider one.
  app.use("/audit/*", requireAuth(), requirePermission("payments:read"));
  app.route("/audit", auditRoutes(container));

  // Admin surface within the caller's merchant: managing users, etc.
  app.use("/admin/*", requireAuth(), requirePermission("admin:access"));
  app.route("/admin", adminRoutes(container));

  return app;
}
