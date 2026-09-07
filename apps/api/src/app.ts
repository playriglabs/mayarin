/**
 * HTTP surface.
 *
 * Thin by design: routes validate input, call an application service, and shape
 * a response. No payment logic lives here.
 */

import { rateLimit } from "@mayarin/http";
import { NotFoundError } from "@mayarin/shared";
import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Container } from "./container.ts";
import { errorHandler } from "./errors.ts";
import { adminRoutes } from "./routes/admin.ts";
import { cartRoutes, catalogRoutes } from "./routes/catalog.ts";
import { checkoutPageRoutes } from "./routes/checkout-page.ts";
import { healthRoutes } from "./routes/health.ts";
import { invoicePageRoutes } from "./routes/invoice-page.ts";
import { invoiceRoutes } from "./routes/invoices.ts";
import { mcpRoutes } from "./routes/mcp.ts";
import { paymentIntentRoutes } from "./routes/payment-intents.ts";
import { paymentLinkRoutes } from "./routes/payment-links.ts";
import { paymentRoutes } from "./routes/payments.ts";
import { quoteRoutes } from "./routes/quotes.ts";
import { webhookRoutes } from "./routes/webhooks.ts";
import { x402Routes } from "./routes/x402.ts";
import { x402ResourceRoutes } from "./routes/x402-resources.ts";
import { checkoutUiRoutes } from "./services/checkout-shell.ts";

export function createApp(container: Container): Hono {
  const app = new Hono();

  app.onError(errorHandler);
  app.notFound(() => {
    throw new NotFoundError("Route not found");
  });

  // Everything outside `/v1` — the health probe, the buyer-facing checkout and
  // invoice pages, the QR, the status stream, the checkout UI's assets — is
  // public and read-only, and something other than a top-level browser
  // navigation does fetch it: the docs playground calls these from the docs
  // origin, and a merchant page may embed the QR. Without CORS headers those
  // reads fail the origin check, which protects nothing here — no cookie rides
  // along and there is no key to leak.
  //
  // Registered as a guard rather than per-mount so a route added at the root
  // later is covered by default. `/v1` is excluded because it runs its own,
  // wider CORS below; letting this one answer a `/v1` preflight would advertise
  // GET/OPTIONS only and break every write from a browser.
  const publicCors = cors({
    origin: "*",
    allowHeaders: ["Content-Type"],
    allowMethods: ["GET", "OPTIONS"],
  });
  app.use("*", (c, next) => (c.req.path.startsWith("/v1") ? next() : publicCors(c, next)));

  app.route("/", healthRoutes(container));

  // The developer/merchant API lives under `/v1` (#138). The path is the
  // breaking axis — a `/v2` is a new URL, opt-in, side by side. The
  // `Mayarin-Version` header stays as the date rev within v1. Root paths 404.
  const v1 = new Hono();
  // Any origin, because the publishable surface (#113) is called from
  // merchants' own storefront pages. This hides nothing: auth is bearer-based
  // with no cookies, so CORS was never the wall — the key is. A browser
  // holding only a publishable key reaches only what that key grants.
  v1.use(
    cors({
      origin: "*",
      allowHeaders: ["Authorization", "Content-Type", "Idempotency-Key", "Mayarin-Version"],
      allowMethods: ["GET", "POST", "PATCH", "OPTIONS"],
      exposeHeaders: ["RateLimit-Limit", "RateLimit-Remaining", "RateLimit-Reset", "Retry-After"],
    }),
  );
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
  v1.route("/payment-intents", paymentIntentRoutes(container));
  v1.route("/payments", paymentRoutes(container));
  // Indicative pricing, for a counter showing a payer what each accepted asset
  // would take. Locks nothing and records nothing (#15).
  v1.route("/quotes", quoteRoutes(container));
  v1.route("/webhooks", webhookRoutes(container));
  // x402 resources, merchant-scoped (#208). The unversioned `/x402` surface is
  // for agents and facilitators; this one is for the merchant who owns them.
  v1.route("/x402/resources", x402ResourceRoutes(container));
  // The commerce layer (#10). Mounted unconditionally and depended on by
  // nothing above it: every route already registered works without it.
  v1.route("/catalog", catalogRoutes(container));
  v1.route("/carts", cartRoutes(container));
  v1.route("/payment-links", paymentLinkRoutes(container));
  // Invoices (#112): the commerce layer plus a buyer, a due date and a number.
  v1.route("/invoices", invoiceRoutes(container));

  const adminToken = container.config.adminToken;
  if (adminToken !== undefined) {
    v1.route("/admin", adminRoutes(container, adminToken));
  }
  app.route("/v1", v1);

  // Buyer-facing pages stay unversioned forever: a printed QR and a shared
  // link encode these paths, so a `/v2` must never move them (#138). The pages
  // are the checkout UI SPA (#151); its hashed assets mount here, matching the
  // bundle's Vite `base`. They are covered by the public CORS guard above.
  app.route("/checkout-ui", checkoutUiRoutes(container));
  app.route("/invoices", invoicePageRoutes(container));
  app.route("/checkout", checkoutPageRoutes(container));

  // x402 is unversioned for the same reason the pages are, and a stronger one:
  // a `PaymentRequired` names the resource by URL, so a `/v2` that moved these
  // would invalidate every price an agent is already holding. Covered by the
  // public CORS guard above — an agent that has never met Mayarin is the point,
  // and a price is not a secret.
  app.route("/x402", x402Routes(container));
  // The MCP server, beside the rail it is served over rather than under /v1:
  // an agent finds it by URL, and a version prefix that moved would invalidate
  // every `PaymentRequired` already handed out.
  app.route("/x402/mcp", mcpRoutes(container));

  return app;
}
