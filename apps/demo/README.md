# Parahyangan Supply — reference storefront

A Bandung apparel store that shows the SDK integration end to end (#137).
Garments are named after streets in Bandung and grouped by category. A product
opens a detail view with a quantity stepper; **Buy now** and the cart both lead
to a shipping step, which checks the order out through `@mayarin/sdk` and
redirects the browser to the hosted payment page.

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
2. **Buy now** or the cart parks a draft and opens the shipping step. The
   address is validated in the browser and never leaves it.
3. Continue mints the order id first, then posts `{ orderId, lines }` to
   `/api/checkout`. The server calls `commerce.carts.checkout(...)` with the
   order id as `merchantReference` and the order id as the idempotency key, so
   one order is one Payment Intent however many times Continue is pressed.
4. The order is written to `localStorage` with the intent id, and the browser
   goes to `/checkout/pay/<intentId>` on the API. The hosted checkout owns the
   payer flow from there and returns to `/checkout/success/<intentId>`.

An order is the storefront's record and a Payment Intent is Mayarin's. The two
are joined by one id in each direction — `merchantReference` on the intent, the
intent id on the order — so nothing about the buyer's address is ever sent to
the clearing layer.

## Purchase history and receipts

The "Purchase history" route lists what this device ordered: one card per
order, with the items, the total, where it ships, and a link back to its
payment. Status belongs to the whole order.

An order flips to `paid` when a payment the store has verified comes back —
either through the signed webhook or through the success page's poll of
`GET /api/payment-status/<intentId>`, which re-reads the intent over the
merchant surface rather than trusting the redirect. A production storefront
learns outcomes the same way; the WooCommerce plugin
(`plugins/woocommerce`) shows that pattern against a real order table.

## Why a thin server

A storefront never ships its secret key to the browser. The calls that need one
run server-side: in development inside the Vite dev server as middleware, in
production inside the Cloudflare Worker. Both run the same handlers —
`server/api.ts` holds the routes as Fetch API handlers, `server/index.ts` is
the connect shim Vite needs and `server/worker.ts` the Worker entry point, so
neither copy can drift from the other. Vite gives the browser only
`VITE_`-prefixed variables, so the secret stays out of the bundle. The build
step checks this claim: `verify-bundle.ts` fails the build if the secret
reaches `dist`.

The webhook signature is verified with `verifyWebhook` from `@mayarin/sdk`,
which owns the scheme — timestamp tolerance, the `v1` signature list, and a
constant-time compare.

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

   Open http://localhost:5173 and click **Buy now** on a product.

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
| `MAYARIN_MERCHANT_NAME`    | `Parahyangan Supply`    | Merchant snapshot on the payment intent    |
| `MAYARIN_MERCHANT_CITY`    | `Bandung`               | Merchant snapshot on the payment intent    |
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
