/**
 * HTTP surface.
 *
 * Thin by design: routes validate input, call an application service, and shape
 * a response. No payment logic lives here.
 */

import { NotFoundError } from "@mayarin/shared";
import { Hono } from "hono";
import type { Container } from "./container.ts";
import { errorHandler } from "./errors.ts";
import { adminRoutes } from "./routes/admin.ts";
import { healthRoutes } from "./routes/health.ts";
import { paymentIntentRoutes } from "./routes/payment-intents.ts";
import { paymentRoutes } from "./routes/payments.ts";
import { webhookRoutes } from "./routes/webhooks.ts";

export function createApp(container: Container): Hono {
  const app = new Hono();

  app.onError(errorHandler);
  app.notFound(() => {
    throw new NotFoundError("Route not found");
  });

  app.route("/", healthRoutes(container));
  app.route("/payment-intents", paymentIntentRoutes(container));
  app.route("/payments", paymentRoutes(container));
  app.route("/webhooks", webhookRoutes(container));

  const adminToken = container.config.adminToken;
  if (adminToken !== undefined) {
    app.route("/admin", adminRoutes(container, adminToken));
  }

  return app;
}
