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
import { cartRoutes, catalogRoutes } from "./routes/catalog.ts";
import { checkoutPageRoutes } from "./routes/checkout-page.ts";
import { healthRoutes } from "./routes/health.ts";
import { paymentIntentRoutes } from "./routes/payment-intents.ts";
import { paymentLinkRoutes } from "./routes/payment-links.ts";
import { paymentRoutes } from "./routes/payments.ts";
import { quoteRoutes } from "./routes/quotes.ts";
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
  // Indicative pricing, for a counter showing a payer what each accepted asset
  // would take. Locks nothing and records nothing (#15).
  app.route("/quotes", quoteRoutes(container));
  app.route("/webhooks", webhookRoutes(container));
  // The commerce layer (#10). Mounted unconditionally and depended on by
  // nothing above it: every route already registered works without it.
  app.route("/catalog", catalogRoutes(container));
  app.route("/carts", cartRoutes(container));
  app.route("/payment-links", paymentLinkRoutes(container));
  app.route("/checkout", checkoutPageRoutes(container));

  const adminToken = container.config.adminToken;
  if (adminToken !== undefined) {
    app.route("/admin", adminRoutes(container, adminToken));
  }

  return app;
}
