# Parahyangan Supply — demo storefront

A Bandung apparel store that shows the SDK integration end to end (#137). The
page lists garments from the catalog, each named after a street in Bandung.
Each product has a **Beli** button that mints a `catalog` payment link through
`@mayarin/sdk` and redirects the browser to the hosted checkout.

The demo is a living reference: the use case is a real storefront, but the
code stays small enough to read in one sitting. The design follows the
`ui-ux-pro-max` recommendation for fashion e-commerce — editorial black on
near-white, Playfair Display and Inter, one accent color.

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

1. Start the database:

   ```bash
   bun run db:up
   ```

2. On the first run, seed the demo merchant and products. The seed creates
   products through the API, so the API must run:

   ```bash
   bun run dev                      # terminal 1: the API alone
   cd apps/demo && bun run seed     # terminal 2
   ```

   If `.env` names no merchant, the seed creates one through
   `bun run seed:merchant` and writes the merchant id and the secret key back
   into `apps/demo/.env`. Products are upserted by SKU, so repeated runs
   change nothing. Stop terminal 1 after the seed.

3. Start the API and the demo together, from the repo root:

   ```bash
   bun run dev:demo
   ```

   Open http://localhost:5173 and click **Checkout** on a product.

## Configuration

All variables live in `apps/demo/.env`. The seed writes them on first run.

| Variable                   | Default                 | Meaning                                    |
| -------------------------- | ----------------------- | ------------------------------------------ |
| `MAYARIN_API_URL`          | `http://localhost:3000` | Base URL of the payment API                |
| `MAYARIN_SECRET_KEY`       | —                       | `sk_` key. Required. Server-side only.     |
| `MAYARIN_MERCHANT_ID`      | —                       | Merchant the catalog belongs to. Required. |
| `MAYARIN_MERCHANT_NAME`    | `Parahyangan Supply`    | Merchant snapshot on the payment link      |
| `MAYARIN_MERCHANT_CITY`    | `Bandung`               | Merchant snapshot on the payment link      |
| `MAYARIN_MERCHANT_COUNTRY` | `ID`                    | Two-letter country code                    |

If the secret key or the merchant id is missing, the dev server refuses to
boot and names the missing variable.
