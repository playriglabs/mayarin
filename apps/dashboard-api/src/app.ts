/**
 * HTTP surface.
 *
 * Wiring only — no logic. The session middleware runs for every request so any
 * handler can read the verified session off the context; route groups add
 * `require-auth`/`require-permission`/`csrf` as needed. `onError` is the single
 * point that maps the domain error taxonomy onto HTTP.
 */

import {
  allowedHosts,
  apiSecurityHeaders,
  originSecret,
  rateLimit,
  securityEvents,
  slowRequests,
} from "@mayarin/http";
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
import { disputeRoutes } from "./routes/disputes.ts";
import { eventLogRoutes } from "./routes/event-logs.ts";
import { fxRoutes } from "./routes/fx.ts";
import { healthRoutes } from "./routes/health.ts";
import { invoiceRoutes } from "./routes/invoices.ts";
import { merchantDisputeRoutes } from "./routes/merchant-disputes.ts";
import { notificationRoutes } from "./routes/notifications.ts";
import { orderRoutes } from "./routes/orders.ts";
import { paymentLinkRoutes } from "./routes/payment-links.ts";
import { paymentRoutes } from "./routes/payments.ts";
import { payoutRoutes } from "./routes/payouts.ts";
import { settingsRoutes } from "./routes/settings.ts";
import { settlementRoutes } from "./routes/settlements.ts";
import { subscriptionRoutes } from "./routes/subscriptions.ts";
import { walletRoutes } from "./routes/wallets.ts";
import { webhookRoutes } from "./routes/webhooks.ts";
import { x402ResourceRoutes } from "./routes/x402-resources.ts";

export function createApp(container: Container): Hono<{ Variables: AuthVars }> {
  const app = new Hono<{ Variables: AuthVars }>();

  app.use("*", originSecret({ secret: container.config.originAuthSecret }));
  app.use("*", allowedHosts({ hosts: container.config.allowedHosts }));
  // Any request over a second, so "it is slow" can be traced to a route.
  app.use("*", slowRequests({ service: "dashboard-api" }));
  app.onError(errorHandler);
  app.notFound(() => {
    throw new NotFoundError("Route not found");
  });
  app.route("/", healthRoutes());

  const v1 = new Hono<{ Variables: AuthVars }>();
  v1.use("*", apiSecurityHeaders());
  v1.use(
    "*",
    securityEvents({
      service: "dashboard-api",
      identify: (c) => {
        const session = c.get("session") as AuthVars["session"];
        const scope = c.get("scope") as AuthVars["scope"];
        return {
          ...(session === undefined ? {} : { actor: session.user.id }),
          ...(scope === undefined ? {} : { tenant: scope.merchantId }),
        };
      },
    }),
  );

  // Registration and the two code endpoints share the login limiter's budget:
  // each is an unauthenticated write that sends mail or guesses a credential,
  // and the general limit is far too generous for any of them.
  for (const path of [
    "/auth/login",
    "/auth/login/mfa",
    "/auth/mfa/verify",
    "/auth/mfa/disable",
    "/auth/register",
    "/auth/verify-email",
    "/auth/resend-verification",
  ]) {
    v1.use(
      path,
      rateLimit({
        limit: container.config.loginRateLimitRequests,
        windowMs: container.config.loginRateLimitWindowSeconds * 1_000,
        clientIpSource: container.config.rateLimitClientIpSource,
        blockDurationMs: container.config.rateLimitBlockSeconds * 1_000,
        maxClients: container.config.rateLimitMaxClients,
      }),
    );
  }

  v1.use(
    "*",
    rateLimit({
      limit: container.config.rateLimitRequests,
      windowMs: container.config.rateLimitWindowSeconds * 1_000,
      clientIpSource: container.config.rateLimitClientIpSource,
      blockDurationMs: container.config.rateLimitBlockSeconds * 1_000,
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
  v1.route("/fx", fxRoutes(container));

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

  // The bell. Same permission as payments: most of it is payments, and the
  // configuration notices in it are filtered to settings managers.
  v1.use("/notifications", requireAuth(), requirePermission("payments:read"));
  v1.use("/notifications/*", requireAuth(), requirePermission("payments:read"));
  v1.route("/notifications", notificationRoutes(container));

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

  // x402 resources (#208): what the merchant sells to an agent, priced like a
  // product. Same permission as the catalogue, because it is one — and the
  // payout address is never taken from the request.
  v1.use("/x402-resources", requireAuth(), requirePermission("catalog:manage"));
  v1.use("/x402-resources/*", requireAuth(), requirePermission("catalog:manage"));
  v1.route("/x402-resources", x402ResourceRoutes(container));

  v1.use("/payment-links", requireAuth(), requirePermission("catalog:manage"));
  v1.use("/payment-links/*", requireAuth(), requirePermission("catalog:manage"));
  v1.route("/payment-links", paymentLinkRoutes(container));

  // Numbered, buyer-facing invoices. Creating and issuing decides what a buyer
  // is charged, so it shares the catalog management permission.
  v1.use("/invoices", requireAuth(), requirePermission("catalog:manage"));
  v1.use("/invoices/*", requireAuth(), requirePermission("catalog:manage"));
  v1.route("/invoices", invoiceRoutes(container));

  // The merchant's customer directory. Same permission as the catalog: a
  // customer is a commerce record the merchant manages, like a product, and
  // never decides where the money lands.
  // Subscriptions (#296): a schedule of invoices, so the invoices' permission.
  v1.use("/subscriptions", requireAuth(), requirePermission("catalog:manage"));
  v1.use("/subscriptions/*", requireAuth(), requirePermission("catalog:manage"));
  v1.route("/subscriptions", subscriptionRoutes(container));

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
  // A merchant's own disputes (#313): the list that tells them to answer.
  v1.use("/escrow-disputes", requireAuth(), requirePermission("payments:read"));
  v1.use("/escrow-disputes/*", requireAuth(), requirePermission("payments:read"));
  v1.route("/escrow-disputes", merchantDisputeRoutes(container));

  // Mayarin Resolution's dispute console (#313). A platform permission, set by
  // an operator and never grantable by a merchant, because it reads disputes
  // across merchants.
  v1.use("/disputes", requireAuth(), requirePermission("disputes:arbitrate"));
  v1.use("/disputes/*", requireAuth(), requirePermission("disputes:arbitrate"));
  v1.route("/disputes", disputeRoutes(container));

  v1.use("/api-keys", requireAuth(), requirePermission("api-keys:manage"));
  v1.use("/api-keys/*", requireAuth(), requirePermission("api-keys:manage"));
  v1.route("/api-keys", apiKeyRoutes(container));

  // Webhook endpoints and delivery inspection (#13). Same permission as
  // settlement settings: both are merchant configuration, and both carry an
  // action that changes where payment detail is sent.
  v1.use("/webhooks/*", requireAuth(), requirePermission("settings:manage"));
  v1.route("/webhooks", webhookRoutes(container));

  // Merchant wallets (#11). Same permission as settlement settings: this is
  // what decides where the merchant's money can be paid at all.
  v1.use("/wallets/*", requireAuth(), requirePermission("wallets:withdraw"));
  v1.use("/wallets", requireAuth(), requirePermission("wallets:withdraw"));
  v1.route("/wallets", walletRoutes(container));

  // Batch payouts (#295). Same permission as wallets: it moves the merchant's
  // money — though only their own wallet can sign it, never this API.
  v1.use("/payouts/*", requireAuth(), requirePermission("wallets:withdraw"));
  v1.use("/payouts", requireAuth(), requirePermission("wallets:withdraw"));
  v1.route("/payouts", payoutRoutes(container));

  // Admin surface within the caller's merchant: managing users, etc.
  v1.use("/admin/*", requireAuth(), requirePermission("admin:access"));
  v1.route("/admin", adminRoutes(container));

  app.route("/v1", v1);

  return app;
}
