# Demo marketplace

A merchant marketplace that shows the SDK integration end to end (#137). The
page lists products from the catalog. Each product has a **Checkout** button
that mints a `catalog` payment link through `@mayarin/sdk` and redirects the
browser to the hosted checkout.

The demo is a living reference. It shows the code a merchant storefront writes
against a running API. It is deliberately plain: one page, one button, no
design system.

## The flow

1. The page loads and calls `GET /api/products` on the thin server. The server
   calls `commerce.products.list(merchantId)` with the secret key.
2. A click on **Checkout** posts `{ productId, quantity }` to `/api/checkout`.
   The server calls `commerce.paymentLinks.create({ kind: "catalog", ... })`.
3. The browser goes to the link's `url`. The hosted checkout owns the payer
   flow from there. The demo stops at the redirect.

## Why a thin server

A storefront never ships its secret key to the browser. The two calls that
need one run inside the Vite dev server as middleware (see
`server/index.ts` and `vite.config.ts`). Vite gives the browser only
`VITE_`-prefixed variables, so the secret stays out of the bundle. The build
step checks this claim: `verify-bundle.ts` fails the build if the secret
reaches `dist`.

The browser SDK (`@mayarin/sdk/browser`) with a publishable key (#113) is the
other integration shape. The embed (`packages/embed`) demonstrates that one.

## Run it

1. Start the database and the API:

   ```bash
   bun run db:up
   bun run dev:all
   ```

2. Seed the demo merchant and products:

   ```bash
   cd apps/demo
   bun run seed
   ```

   If `.env` names no merchant, the seed creates one through
   `bun run seed:merchant` and writes the merchant id and the secret key back
   into `apps/demo/.env`. Products are upserted by SKU, so repeated runs
   change nothing.

3. Start the demo:

   ```bash
   bun run dev
   ```

   Open http://localhost:5173 and click **Checkout** on a product.

## Configuration

All variables live in `apps/demo/.env`. The seed writes them on first run.

| Variable                   | Default                 | Meaning                                    |
| -------------------------- | ----------------------- | ------------------------------------------ |
| `MAYARIN_API_URL`          | `http://localhost:3000` | Base URL of the payment API                |
| `MAYARIN_SECRET_KEY`       | —                       | `sk_` key. Required. Server-side only.     |
| `MAYARIN_MERCHANT_ID`      | —                       | Merchant the catalog belongs to. Required. |
| `MAYARIN_MERCHANT_NAME`    | `Toko Demo`             | Merchant snapshot on the payment link      |
| `MAYARIN_MERCHANT_CITY`    | `Jakarta`               | Merchant snapshot on the payment link      |
| `MAYARIN_MERCHANT_COUNTRY` | `ID`                    | Two-letter country code                    |

If the secret key or the merchant id is missing, the dev server refuses to
boot and names the missing variable.
