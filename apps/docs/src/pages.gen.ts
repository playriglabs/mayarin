// deno-fmt-ignore-file
// biome-ignore format: generated types do not need formatting
// prettier-ignore
import type { PathsForPages } from 'waku/router'

// prettier-ignore
type Page =
  | { path: "/api-reference/analytics"; render: "static" }
  | { path: "/api-reference/catalog"; render: "static" }
  | { path: "/api-reference/disputes"; render: "static" }
  | { path: "/api-reference"; render: "static" }
  | { path: "/api-reference/invoices"; render: "static" }
  | { path: "/api-reference/payment-intents"; render: "static" }
  | { path: "/api-reference/payment-links"; render: "static" }
  | { path: "/api-reference/payments"; render: "static" }
  | { path: "/api-reference/quotes"; render: "static" }
  | { path: "/api-reference/risk"; render: "static" }
  | { path: "/api-reference/subscriptions"; render: "static" }
  | { path: "/api-reference/unversioned"; render: "static" }
  | { path: "/api-reference/webhooks"; render: "static" }
  | { path: "/api-reference/x402-resources"; render: "static" }
  | { path: "/api-reference/x402"; render: "static" }
  | { path: "/changelog"; render: "static" }
  | { path: "/concepts/execution-paths"; render: "static" }
  | { path: "/concepts/money"; render: "static" }
  | { path: "/concepts/payment-lifecycle"; render: "static" }
  | { path: "/concepts/rails"; render: "static" }
  | { path: "/concepts/versioning"; render: "static" }
  | { path: "/errors"; render: "static" }
  | { path: "/guides/analytics"; render: "static" }
  | { path: "/guides/api-quickstart"; render: "static" }
  | { path: "/guides/authentication"; render: "static" }
  | { path: "/guides/disputes"; render: "static" }
  | { path: "/guides/escrow"; render: "static" }
  | { path: "/guides/subscriptions"; render: "static" }
  | { path: "/guides/webhooks"; render: "static" }
  | { path: "/guides/woocommerce"; render: "static" }
  | { path: "/guides/x402"; render: "static" }
  | { path: "/"; render: "static" }
  | { path: "/quickstart"; render: "static" }
  | { path: "/sdk/typescript/analytics"; render: "static" }
  | { path: "/sdk/typescript/browser"; render: "static" }
  | { path: "/sdk/typescript/commerce"; render: "static" }
  | { path: "/sdk/typescript/disputes"; render: "static" }
  | { path: "/sdk/typescript"; render: "static" }
  | { path: "/sdk/typescript/payments"; render: "static" }
  | { path: "/sdk/typescript/react"; render: "static" }
  | { path: "/sdk/typescript/reference"; render: "static" }
  | { path: "/sdk/typescript/server"; render: "static" }
  | { path: "/sdk/typescript/webhooks"; render: "static" }
  | { path: "/sdk/typescript/x402"; render: "static" };

// prettier-ignore
declare module "waku/router" {
  interface RouteConfig {
    paths: PathsForPages<Page>;
  }
  interface CreatePagesConfig {
    pages: Page;
  }
}
