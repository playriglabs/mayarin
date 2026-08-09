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
import { invoicePageRoutes } from "./routes/invoice-page.ts";
import { invoiceRoutes } from "./routes/invoices.ts";
import { paymentIntentRoutes } from "./routes/payment-intents.ts";
import { paymentLinkRoutes } from "./routes/payment-links.ts";
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
  // The commerce layer (#10). Mounted unconditionally and depended on by
  // nothing above it: every route already registered works without it.
  app.route("/catalog", catalogRoutes(container));
  app.route("/carts", cartRoutes(container));
  app.route("/payment-links", paymentLinkRoutes(container));
  // Invoices (#112): the commerce layer plus a buyer, a due date and a number.
  app.route("/invoices", invoiceRoutes(container));
  // The hosted page shares the /invoices prefix, so it mounts after the API
  // routes: Hono matches in registration order and `/:id/view` is narrower.
  app.route("/invoices", invoicePageRoutes(container));
  app.route("/checkout", checkoutPageRoutes(container));

  const adminToken = container.config.adminToken;
  if (adminToken !== undefined) {
    app.route("/admin", adminRoutes(container, adminToken));
  }

  return app;
}
