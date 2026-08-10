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
import { apiKeyMiddleware } from "./middleware/api-key.ts";
import { requireAuth } from "./middleware/require-auth.ts";
import { requirePermission } from "./middleware/require-permission.ts";
import { sessionMiddleware } from "./middleware/session.ts";
import type { AuthVars } from "./middleware/types.ts";
import { adminRoutes } from "./routes/admin.ts";
import { apiKeyRoutes } from "./routes/api-keys.ts";
import { auditRoutes } from "./routes/audit.ts";
import { authRoutes } from "./routes/auth.ts";
import { catalogRoutes } from "./routes/catalog.ts";
import { customerRoutes } from "./routes/customers.ts";
import { eventLogRoutes } from "./routes/event-logs.ts";
import { healthRoutes } from "./routes/health.ts";
import { orderRoutes } from "./routes/orders.ts";
import { paymentLinkRoutes } from "./routes/payment-links.ts";
import { paymentRoutes } from "./routes/payments.ts";
import { settingsRoutes } from "./routes/settings.ts";
import { settlementRoutes } from "./routes/settlements.ts";
import { walletRoutes } from "./routes/wallets.ts";
import { webhookRoutes } from "./routes/webhooks.ts";

export function createApp(container: Container): Hono<{ Variables: AuthVars }> {
  const app = new Hono<{ Variables: AuthVars }>();

  app.onError(errorHandler);
  app.notFound(() => {
    throw new NotFoundError("Route not found");
  });

  // Stamps `session`/`scope` on the context when a valid session cookie is
  // present; a no-op for anonymous requests.
  app.use("*", sessionMiddleware(container.sessions));
  // Bearer-token (API key) auth: if no session verified, an `Authorization:
  // Bearer` header is hashed and looked up. A no-op for a session or anonymous
  // request.
  app.use("*", apiKeyMiddleware(container.apiKeys));

  app.route("/", healthRoutes());
  app.route("/auth", authRoutes(container));

  // Authenticated merchant reads (own merchant only — no cross-merchant view).
  app.use("/payments/*", requireAuth(), requirePermission("payments:read"));
  app.route("/payments", paymentRoutes(container));

  // The compliance audit trail (#16). Same permission as payments: it is a
  // deeper view of the same records, not a wider one.
  app.use("/audit/*", requireAuth(), requirePermission("payments:read"));
  app.route("/audit", auditRoutes(container));

  // What the merchant was actually paid (#15). Same permission as payments, and
  // for the same reason: it is the payout side of records the caller can
  // already read, not a new set of them.
  app.use("/settlements", requireAuth(), requirePermission("payments:read"));
  app.use("/settlements/*", requireAuth(), requirePermission("payments:read"));
  app.route("/settlements", settlementRoutes(container));

  // The merchant event timeline — clearing, settlement, and webhook events in
  // one derived read. Same permission as payments: it is the same records read
  // another way, not a new set of them.
  app.use("/event-logs", requireAuth(), requirePermission("payments:read"));
  app.use("/event-logs/*", requireAuth(), requirePermission("payments:read"));
  app.route("/event-logs", eventLogRoutes(container));

  // The commerce view of a merchant's payments — line items and the customer,
  // rather than the clearing rail. Same permission as payments: it is the same
  // records read another way, not a new set of them.
  app.use("/orders", requireAuth(), requirePermission("payments:read"));
  app.use("/orders/*", requireAuth(), requirePermission("payments:read"));
  app.route("/orders", orderRoutes(container));

  // Products and payment links (#15). Its own permission: minting a link
  // decides what a buyer is charged and never where the money lands, so a
  // cashier can sell all day without being able to redirect the payout.
  app.use("/catalog/*", requireAuth(), requirePermission("catalog:manage"));
  app.route("/catalog", catalogRoutes(container));

  app.use("/payment-links", requireAuth(), requirePermission("catalog:manage"));
  app.use("/payment-links/*", requireAuth(), requirePermission("catalog:manage"));
  app.route("/payment-links", paymentLinkRoutes(container));

  // The merchant's customer directory. Same permission as the catalog: a
  // customer is a commerce record the merchant manages, like a product, and
  // never decides where the money lands.
  app.use("/customers", requireAuth(), requirePermission("catalog:manage"));
  app.use("/customers/*", requireAuth(), requirePermission("catalog:manage"));
  app.route("/customers", customerRoutes(container));

  // Merchant settlement configuration (#95). Its own permission rather than
  // `admin:access`: this surface decides where the merchant's money is paid,
  // and reading payments or managing users is no reason to redirect them.
  app.use("/settings/*", requireAuth(), requirePermission("settings:manage"));
  app.use("/settings", requireAuth(), requirePermission("settings:manage"));
  app.route("/settings", settingsRoutes(container));

  // Merchant API keys — bearer-token access with per-key permissions. Same
  // permission as settlement settings: a key decides what an integration can
  // reach within this merchant, the same perimeter settings governs.
  app.use("/api-keys", requireAuth(), requirePermission("settings:manage"));
  app.use("/api-keys/*", requireAuth(), requirePermission("settings:manage"));
  app.route("/api-keys", apiKeyRoutes(container));

  // Webhook endpoints and delivery inspection (#13). Same permission as
  // settlement settings: both are merchant configuration, and both carry an
  // action that changes where payment detail is sent.
  app.use("/webhooks/*", requireAuth(), requirePermission("settings:manage"));
  app.route("/webhooks", webhookRoutes(container));

  // Merchant wallets (#11). Same permission as settlement settings: this is
  // what decides where the merchant's money can be paid at all.
  app.use("/wallets/*", requireAuth(), requirePermission("settings:manage"));
  app.use("/wallets", requireAuth(), requirePermission("settings:manage"));
  app.route("/wallets", walletRoutes(container));

  // Admin surface within the caller's merchant: managing users, etc.
  app.use("/admin/*", requireAuth(), requirePermission("admin:access"));
  app.route("/admin", adminRoutes(container));

  return app;
}
