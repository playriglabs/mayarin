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
 *   GET    /v1/payments/:id/{invoice,receipt}.pdf  payment documents (#293)
 *   POST   /v1/invoices/:id/checkout         invoice -> intent
 *   GET    /v1/fiat-onramp/{currencies,methods}      local-currency options
 *   POST   /v1/fiat-onramp/rail                      which chain a local payment lands on
 *   GET    /v1/fiat-onramp/:id/funding               the order's funding instructions
 *   POST   /v1/fiat-onramp/:id/order                 place the local-currency order
 *   GET    /v1/payers/:address/protection            buyer protection for a wallet
 *   POST   /v1/payments/:id/escrow/dispute/messages  a payer's dispute message
 *
 * The last six match whole path segments, so an extra segment in the middle does
 * not slip through. Each route behind them checks the payer's token itself.
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

/** Matches a path of exactly these segments; `:name` stands for any one non-empty segment. */
const segments = (pattern: string): ((pathname: string) => boolean) => {
  const wanted = pattern.split("/");
  return (pathname) => {
    const actual = pathname.split("/");
    return (
      actual.length === wanted.length &&
      wanted.every((part, i) => (part.startsWith(":") ? actual[i] !== "" : part === actual[i]))
    );
  };
};

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
  // Local-currency payment (TransFi) and buyer protection.
  { method: "GET", match: segments("/v1/fiat-onramp/currencies") },
  { method: "GET", match: segments("/v1/fiat-onramp/methods") },
  { method: "POST", match: segments("/v1/fiat-onramp/rail") },
  { method: "GET", match: segments("/v1/fiat-onramp/:id/funding") },
  { method: "POST", match: segments("/v1/fiat-onramp/:id/order") },
  { method: "GET", match: segments("/v1/payers/:address/protection") },
  { method: "POST", match: segments("/v1/payments/:id/escrow/dispute/messages") },
];

/**
 * Whether the pay host should forward a request, or answer 404 itself.
 * HEAD matches the GET rules, so an uptime monitor (which sends HEAD) sees the
 * same answer a buyer's browser does.
 */
export function allowed(method: string, pathname: string): boolean {
  const upper = method.toUpperCase();
  const ruleMethod = upper === "HEAD" ? "GET" : upper;
  return RULES.some((rule) => rule.method === ruleMethod && rule.match(pathname));
}
