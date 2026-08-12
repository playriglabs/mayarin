[← Documentation index](./README.md)

---

# WooCommerce Plugin

`plugins/woocommerce` is a WooCommerce payment gateway for Mayarin (#113). It
is distribution, not domain: the plugin is a client of the public API. It adds
no endpoint and imports nothing from the monorepo. It lives outside the Bun
workspaces because it is PHP and shares no code with them.

The merchant flow is: install, enter keys, take payments. Prices stay in the
store's own currency. The crypto leg never appears in the merchant's admin.

## Install

1. Zip the plugin directory and upload it in WordPress → Plugins → Add New:

   ```bash
   cd plugins/woocommerce && zip -r mayarin-payments.zip . -x "tests/*"
   ```

2. Activate it, then open WooCommerce → Settings → Payments → Mayarin.

The gateway stays hidden at checkout until a secret key and a merchant ID are
set, and until the store currency is one the API prices (IDR, USD, SGD, THB,
MYR).

## Settings

| Setting                | Meaning                                                                                                               |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------- |
| API base URL           | Origin of the payment API. Default `https://api.mayarin.xyz`.                                                         |
| Secret key             | An `sk_` key from the dashboard. It stays on the server; see [#144](https://github.com/playriglabs/mayarin/pull/144). |
| Merchant ID            | Your merchant id from the dashboard.                                                                                  |
| Webhook signing secret | The secret of the endpoint you register (next section).                                                               |
| Payment asset / chain  | The rail the buyer pays on, e.g. USDC on Base.                                                                        |

The merchant snapshot a checkout requires (name, city, country) comes from the
store's own WordPress and WooCommerce settings, so nothing is configured twice.
A missing store city or country fails checkout with a message that names the
setting to fix.

## Payment flow

`process_payment` sends the same mint→confirm pair the embed sends:

1. `POST /v1/carts/checkout` — one ad-hoc line for the order total (the total
   already carries shipping, taxes and discounts, so one line cannot drift from
   it), the rail from the settings, `executionPath: deposit-match`, and
   `metadata.wc_order_id` for the webhook to match on.
2. `POST /v1/payment-intents/{id}/confirm` — locks the price and allocates the
   deposit address.
3. The buyer is redirected to the hosted payment page,
   `{base}/checkout/pay/{intentId}`.

The intent id lands in order meta `_mayarin_payment_intent_id` and the order
moves to _pending_.

## Webhook

Order status is driven by webhooks (#13), never by the buyer returning to the
store. A buyer who closes the tab still gets their order marked paid.

Register `https://your-store/wp-json/mayarin/v1/webhook` as a webhook endpoint
in the Mayarin dashboard, then paste its signing secret into the gateway
settings.

The receiver verifies the HMAC-SHA256 signature over the raw body — the same
scheme as `packages/core/notifications/src/signature.ts`, including secret
rotation and the 300-second timestamp tolerance. A delivery that fails
verification is refused with 401. Everything else is acknowledged with 200,
because a retry cannot fix an unmatched event.

Deliveries are at-least-once and unordered, so the receiver keeps the highest
`sequence` seen in order meta and discards anything at or below it. The state
mapping:

| Clearing state | Order action                                     |
| -------------- | ------------------------------------------------ |
| `SUCCESS`      | `payment_complete()` — processing or completed   |
| `FAILED`       | Status _failed_                                  |
| anything else  | An order note, so the admin sees the progression |

The receiver also refuses an event whose `paymentIntentId` does not match the
intent the order was minted with.

## Refunds

Refund from the WooCommerce order screen as usual. The plugin calls
`POST /v1/payments/{id}/refunds` with the amount in the store currency; an
API-side cap keeps the total at or under what is refundable. Who may _sign_ a
refund tightens when #12 lands — the plugin's call site does not change.

## Version coupling

A plugin ships to servers nobody controls and runs for years after it is
installed. Every request carries `Mayarin-Version: 2026-08-11` — the same pin
as `@mayarin/sdk`. The API ignores the header today; when it starts refusing
stale versions, the error surfaces as an order note that names the pinned
version and says to update the plugin, instead of a silent failure.

## Testing

PHP appears nowhere else in the repository, so the toolchain is a container —
the same posture as Postgres:

```bash
bun run test:woocommerce   # php -l over every file + tests/run.php, in php:8.3-cli
```

The tests cover the pure functions: signature parsing and verification,
the event→order decision (sequence guard, intent mismatch, state mapping) and
API error rendering. They run without WordPress and without PHPUnit — plain
assertions, zero dependencies. WordPress integration (the gateway and REST
glue) is exercised against a real store, not mocked.

## Deliberate v1 limits

- **The buyer stays on the hosted payment page after paying.** The pay page
  takes no return URL, so there is no redirect back to the store's thank-you
  page. Order status does not depend on it. A `return_url` on the pay page is
  an API finding, not a plugin workaround.
- **One rail per order.** The hosted pay page has no asset picker, so the
  gateway settings choose the asset and chain — the same constraint the
  embed's cart mode documents.
- **The Merchant ID is a setting.** The API has no endpoint that resolves a
  merchant id from an API key, so the merchant copies it from the dashboard.
- **Matching rides on `metadata.wc_order_id`.** The webhook delivery body does
  not carry `merchantReference`, although `NotifiableEvent` defines it — an
  API finding; the metadata channel works today.
- **Distribution is a zip, not the WordPress plugin directory.** The directory
  brings reach and a review process; worth doing once the plugin has survived
  contact with a real store.
