/**
 * HTTP surface.
 *
 * Wiring only — no logic. The session middleware runs for every request so any
 * handler can read the verified session off the context; route groups add
 * `require-auth`/`require-permission`/`csrf` as needed. `onError` is the single
 * point that maps the domain error taxonomy onto HTTP.
 */

import { rateLimit } from "@mayarin/http";
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
import { analyticsRoutes } from "./routes/analytics.ts";
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
  app.route("/", healthRoutes());

  const v1 = new Hono<{ Variables: AuthVars }>();

  v1.use(
    "/auth/login",
    rateLimit({
      limit: container.config.loginRateLimitRequests,
      windowMs: container.config.loginRateLimitWindowSeconds * 1_000,
      clientIpSource: container.config.rateLimitClientIpSource,
      maxClients: container.config.rateLimitMaxClients,
    }),
  );

  v1.use(
    "*",
    rateLimit({
      limit: container.config.rateLimitRequests,
      windowMs: container.config.rateLimitWindowSeconds * 1_000,
      clientIpSource: container.config.rateLimitClientIpSource,
      maxClients: container.config.rateLimitMaxClients,
    }),
  );

  // Stamps `session`/`scope` on the context when a valid session cookie is
  // present; a no-op for anonymous requests.
  v1.use("*", sessionMiddleware(container.sessions));
  // Bearer-token (API key) auth: if no session verified, an `Authorization:
  // Bearer` header is hashed and looked up. A no-op for a session or anonymous
  // request.
  v1.use("*", apiKeyMiddleware(container.apiKeys));

  v1.route("/auth", authRoutes(container));

  // Authenticated merchant reads (own merchant only — no cross-merchant view).
  v1.use("/payments/*", requireAuth(), requirePermission("payments:read"));
  v1.route("/payments", paymentRoutes(container));

  v1.use("/analytics", requireAuth(), requirePermission("payments:read"));
  v1.route("/analytics", analyticsRoutes(container));

  // The compliance audit trail (#16). Same permission as payments: it is a
  // deeper view of the same records, not a wider one.
  v1.use("/audit/*", requireAuth(), requirePermission("payments:read"));
  v1.route("/audit", auditRoutes(container));

  // What the merchant was actually paid (#15). Same permission as payments, and
  // for the same reason: it is the payout side of records the caller can
  // already read, not a new set of them.
  v1.use("/settlements", requireAuth(), requirePermission("payments:read"));
  v1.use("/settlements/*", requireAuth(), requirePermission("payments:read"));
  v1.route("/settlements", settlementRoutes(container));

  // The merchant event timeline — clearing, settlement, and webhook events in
  // one derived read. Same permission as payments: it is the same records read
  // another way, not a new set of them.
  v1.use("/event-logs", requireAuth(), requirePermission("payments:read"));
  v1.use("/event-logs/*", requireAuth(), requirePermission("payments:read"));
  v1.route("/event-logs", eventLogRoutes(container));

  // The commerce view of a merchant's payments — line items and the customer,
  // rather than the clearing rail. Same permission as payments: it is the same
  // records read another way, not a new set of them.
  v1.use("/orders", requireAuth(), requirePermission("payments:read"));
  v1.use("/orders/*", requireAuth(), requirePermission("payments:read"));
  v1.route("/orders", orderRoutes(container));

  // Products and payment links (#15). Its own permission: minting a link
  // decides what a buyer is charged and never where the money lands, so a
  // cashier can sell all day without being able to redirect the payout.
  v1.use("/catalog/*", requireAuth(), requirePermission("catalog:manage"));
  v1.route("/catalog", catalogRoutes(container));

  v1.use("/payment-links", requireAuth(), requirePermission("catalog:manage"));
  v1.use("/payment-links/*", requireAuth(), requirePermission("catalog:manage"));
  v1.route("/payment-links", paymentLinkRoutes(container));

  // The merchant's customer directory. Same permission as the catalog: a
  // customer is a commerce record the merchant manages, like a product, and
  // never decides where the money lands.
  v1.use("/customers", requireAuth(), requirePermission("catalog:manage"));
  v1.use("/customers/*", requireAuth(), requirePermission("catalog:manage"));
  v1.route("/customers", customerRoutes(container));

  // Merchant settlement configuration (#95). Its own permission rather than
  // `admin:access`: this surface decides where the merchant's money is paid,
  // and reading payments or managing users is no reason to redirect them.
  v1.use("/settings/*", requireAuth(), requirePermission("settings:manage"));
  v1.use("/settings", requireAuth(), requirePermission("settings:manage"));
  v1.route("/settings", settingsRoutes(container));

  // Merchant API keys — bearer-token access with per-key permissions. Same
  // permission as settlement settings: a key decides what an integration can
  // reach within this merchant, the same perimeter settings governs.
  v1.use("/api-keys", requireAuth(), requirePermission("settings:manage"));
  v1.use("/api-keys/*", requireAuth(), requirePermission("settings:manage"));
  v1.route("/api-keys", apiKeyRoutes(container));

  // Webhook endpoints and delivery inspection (#13). Same permission as
  // settlement settings: both are merchant configuration, and both carry an
  // action that changes where payment detail is sent.
  v1.use("/webhooks/*", requireAuth(), requirePermission("settings:manage"));
  v1.route("/webhooks", webhookRoutes(container));

  // Merchant wallets (#11). Same permission as settlement settings: this is
  // what decides where the merchant's money can be paid at all.
  v1.use("/wallets/*", requireAuth(), requirePermission("settings:manage"));
  v1.use("/wallets", requireAuth(), requirePermission("settings:manage"));
  v1.route("/wallets", walletRoutes(container));

  // Admin surface within the caller's merchant: managing users, etc.
  v1.use("/admin/*", requireAuth(), requirePermission("admin:access"));
  v1.route("/admin", adminRoutes(container));

  app.route("/v1", v1);

  return app;
}
