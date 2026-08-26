/**
 * The buyer-facing path allowlist for `pay-testnet.mayarin.xyz` (RFC #163).
 *
 * The checkout SPA is served by `core-api` and issues relative, same-origin
 * calls — so the pay host must forward exactly the paths a buyer page can reach
 * and nothing else. The full `/v1/*` API surface (admin, operator, merchant,
 * webhooks) stays reachable only on `api-testnet.mayarin.xyz`.
 *
 * Derived from the SPA's actual fetches (`apps/checkout-ui/src/features/link`,
 * `features/pay`, `features/invoice`) plus the server-rendered buyer pages
 * (`apps/api/src/routes/checkout-page.ts`, `invoice-page.ts`):
 *
 *   GET    /checkout/*                       link, pay, qr, events (SSE)
 *   GET    /checkout-ui/*                    hashed SPA assets + favicon
 *   GET    /invoices/:id/view                invoice buyer page
 *   POST   /v1/quotes                        price estimate
 *   POST   /v1/payment-links/:id/checkout    mint intent
 *   POST   /v1/payment-intents/:id/confirm   lock price
 *   GET    /v1/payments/:id                  status poll (bootstrap statusUrl)
 *   POST   /v1/invoices/:id/checkout         invoice -> intent
 *
 * Pure so it can be unit-tested without a Worker runtime.
 */

interface Rule {
  readonly method: string;
  readonly match: (pathname: string) => boolean;
}

const prefix =
  (p: string): ((pathname: string) => boolean) =>
  (pathname) =>
    pathname === p || pathname.startsWith(`${p}/`);

const prefixWithSuffix =
  (p: string, suffix: string): ((pathname: string) => boolean) =>
  (pathname) =>
    pathname.startsWith(`${p}/`) && pathname.endsWith(suffix);

const exact =
  (p: string): ((pathname: string) => boolean) =>
  (pathname) =>
    pathname === p;

const RULES: readonly Rule[] = [
  // Buyer pages and their assets.
  { method: "GET", match: prefix("/checkout") },
  { method: "GET", match: prefix("/checkout-ui") },
  { method: "GET", match: prefixWithSuffix("/invoices", "/view") },
  // SPA API calls.
  { method: "POST", match: exact("/v1/quotes") },
  { method: "POST", match: prefixWithSuffix("/v1/payment-links", "/checkout") },
  { method: "POST", match: prefixWithSuffix("/v1/payment-intents", "/confirm") },
  { method: "GET", match: prefix("/v1/payments") },
  { method: "POST", match: prefixWithSuffix("/v1/invoices", "/checkout") },
];

/** Whether the pay host should forward a request, or answer 404 itself. */
export function allowed(method: string, pathname: string): boolean {
  const upper = method.toUpperCase();
  return RULES.some((rule) => rule.method === upper && rule.match(pathname));
}
