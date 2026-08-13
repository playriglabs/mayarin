# Parahyangan Supply — reference storefront

A Bandung apparel store that shows the SDK integration end to end (#137).
Garments are named after streets in Bandung and grouped by category. A product
opens a detail view with a quantity stepper; **Beli sekarang** mints a
`catalog` payment link through `@mayarin/sdk` and redirects the browser to the
hosted checkout.

The app is a living reference: the use case is a real storefront, and the code
stays small enough to read in one sitting. The identity is built in — a
Tangkuban Perahu logo mark, illustrated product imagery (one colorway per
garment, `src/product-art.tsx`), and an editorial design per the
`ui-ux-pro-max` recommendation for fashion e-commerce: black on near-white,
Playfair Display and Inter, one accent color.

## The flow

1. The page loads and calls `GET /api/products` on the thin server. The server
   calls `commerce.products.list(merchantId)` with the secret key. Category
   filters, garment shape, and colorway come from `metadata` on each product.
2. **Beli sekarang** posts `{ productId, quantity }` to `/api/checkout`. The
   server calls `commerce.paymentLinks.create({ kind: "catalog", ... })` and
   returns the link's `id` and `url`.
3. The storefront records the purchase in `localStorage`, then the browser
   goes to the link's `url`. The hosted checkout owns the payer flow from
   there.

## Purchase history and receipts

The "Riwayat" section lists what this device checked out, with a link back to
each hosted payment page. The API has no per-payment receipt URL for catalog
links yet: the payment intent is created on the hosted checkout after the
redirect, so the storefront never sees its id. A production storefront learns
payment outcomes through webhooks — the WooCommerce plugin
(`plugins/woocommerce`) shows that pattern. Hosted invoice URLs exist in the
separate invoice domain (#112) for real invoices with numbering and due
dates.

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

1. Put the deployed API URL, existing merchant id, and secret key in
   `apps/demo/.env`, then seed its products. The seed never creates merchant
   accounts:

   ```bash
   cd apps/demo && bun run seed
   ```

   Products are upserted by SKU, so repeated runs change nothing.

2. Start the demo from the repo root. It uses `MAYARIN_API_URL` from
   `apps/demo/.env`:

   ```bash
   bun run dev:demo
   ```

   Open http://localhost:5173 and click **Checkout** on a product.

To run only the demo against the `MAYARIN_API_URL` configured in
`apps/demo/.env`, run this from `apps/demo`:

```bash
bun run dev:demo
```

## Configuration

All variables live in `apps/demo/.env`. Add the existing merchant credentials
before running the product seed.

| Variable                   | Default                 | Meaning                                    |
| -------------------------- | ----------------------- | ------------------------------------------ |
| `MAYARIN_API_URL`          | `http://localhost:3000` | Base URL of the payment API                |
| `MAYARIN_SECRET_KEY`       | —                       | `sk_` key. Required. Server-side only.     |
| `MAYARIN_MERCHANT_ID`      | —                       | Merchant the catalog belongs to. Required. |
| `MAYARIN_MERCHANT_NAME`    | `Parahyangan Supply`    | Merchant snapshot on the payment link      |
| `MAYARIN_MERCHANT_CITY`    | `Bandung`               | Merchant snapshot on the payment link      |
| `MAYARIN_MERCHANT_COUNTRY` | `ID`                    | Two-letter country code                    |
| `DEMO_PUBLIC_URL`          | `http://localhost:5173` | Public demo origin used for success URLs.  |
| `MAYARIN_WEBHOOK_SECRET`   | —                       | Signing secret for the merchant webhook.   |

If the secret key or the merchant id is missing, the dev server refuses to
boot and names the missing variable.

## Payment success webhook

Register the merchant webhook endpoint as:

```text
https://<public-demo-origin>/api/webhooks/mayarin
```

Put the endpoint's one-time signing secret in `MAYARIN_WEBHOOK_SECRET` and set
`DEMO_PUBLIC_URL` to the same public demo origin. A local `localhost` server
cannot receive Railway webhooks directly; use an HTTPS tunnel or deploy the
demo. After a payment reaches `SUCCESS`, the payer is returned to:

```text
/checkout/success/<paymentIntentId>
```
