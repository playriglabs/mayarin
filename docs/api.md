[← Documentation index](./README.md)

# REST API

The public merchant REST API is documented at **<https://docs.mayarin.xyz>** as
an interactive OpenAPI 3.1 reference generated from the route schemas. It is the
canonical contract: endpoint shapes, request/response schemas, errors,
authentication, and a playground against a non-production server.

This file is the internal contributor record for the surfaces that are
intentionally **not** part of the public portal — the dashboard API and the
design notes that do not belong in a generated reference. Do not duplicate the
generated contract here; update `apps/docs` instead.

See:

- [API reference (generated)](https://docs.mayarin.xyz/api-reference) — public
  `/v1` operations, schemas, and playground.
- [Versioning](https://docs.mayarin.xyz/concepts/versioning) — the `/v1` path
  boundary and the `Mayarin-Version` date revision.
- [Authentication](https://docs.mayarin.xyz/guides/authentication) — `sk_` and
  `pk_` bearer keys.
- [Errors](https://docs.mayarin.xyz/errors) — the error envelope and codes.

## Base URL and versioning (contributor summary)

The developer/merchant API lives under `/v1` (#138). Two version axes exist and
do not replace each other: the path (`/v1`) is the breaking boundary, and
`Mayarin-Version` is the date rev within v1, pinned by the SDK
(`packages/sdk/src/version.ts`).

Unversioned routes stay at the root forever — a printed QR and a shared link
encode them, so a version bump must never move them:

- `GET /checkout/:id` and sub-routes — the hosted checkout page
  (`GET /checkout/pay/:intentId`, `GET /checkout/events/:intentId`,
  `GET /checkout/qr`).
- `GET /invoices/:id/view` — the hosted invoice page.
- `GET /health` — the deployment probe.

A buyer page has no version.

**How a buyer page renders (#151).** The pages are one SPA
(`apps/checkout-ui`). Each page route reads the built shell, injects a
`window.__BOOTSTRAP__` payload, and answers with the result — the page paints
from data it already has, with no fetch of its own. The API serves the hashed
bundle at `GET /checkout-ui/assets/*`, from its own image. `CHECKOUT_UI_DIST`
overrides where the built shell is read from; the default is the workspace
path `apps/checkout-ui/dist`.

`/v1` answers cross-origin browser requests (permissive CORS). Auth is
bearer-based with no cookies, so the key was always the wall.

## Dashboard API (`apps/dashboard-api`)

A second surface, on its own port, for the merchant signed into the dashboard.
Its session and merchant routes are also mounted under `/v1`; `/health` remains
at the root for infrastructure probes. In development the browser calls
`/api/v1/*`, which the dashboard dev proxy forwards to this service.
Everything in the public reference authenticates per request and takes the
merchant as an argument, which is right for an SDK consumer holding their own
credentials and wrong for a browser. Here the merchant is **the session's**: no
route accepts a merchant id, so there is nothing to tamper with, and a
cross-merchant id resolves to the same 404 an absent one does.

Session cookie plus a double-submit CSRF token on every mutating call. Each
group names the permission that opens it.

| Route                                                                        | Permission        | What it is                                                      |
| ---------------------------------------------------------------------------- | ----------------- | --------------------------------------------------------------- |
| `POST /auth/login`, `/logout`, `GET /me`                                     | —                 | Session lifecycle                                               |
| `GET /payments`, `/payments/:id`                                             | `payments:read`   | The merchant's own intents, with clearing and timeline          |
| `GET /analytics`                                                             | `payments:read`   | Merchant analytics, derived from the payments read              |
| `GET /audit`, `/audit/:id`                                                   | `payments:read`   | Compliance record with ledger ↔ chain reconciliation            |
| `GET /settlements`                                                           | `payments:read`   | What clearing booked, plus what the chain reported              |
| `GET /event-logs`, `/event-logs/events`                                      | `payments:read`   | Clearing, settlement and webhook events in one timeline         |
| `GET /orders`, `/orders/:id`                                                 | `payments:read`   | The commerce view of a payment — lines, customer, status        |
| `GET/POST/PATCH /catalog/products[/:id]`                                     | `catalog:manage`  | Products, priced per currency                                   |
| `GET/POST /payment-links`, `/:id/disable`, `/:id/charge`, `/:id/quote`       | `catalog:manage`  | Link templates, counter sale, and indicative pricing            |
| `GET/POST /invoices`, `/:id/issue`, `/:id/void`, `/:id/send`                 | `catalog:manage`  | Numbered invoices and their lifecycle                           |
| `GET/POST/PATCH/DELETE /customers[/:id]`                                     | `catalog:manage`  | Merchant-managed directory, linked to orders                    |
| `GET/POST /x402-resources`, `/:id/list`, `/:id/unlist`, `DELETE /:id`        | `catalog:manage`  | The merchant's own agent-payable endpoints                      |
| `GET/PATCH /settings`, `GET /settings/history`                               | `settings:manage` | Settlement config, merchant profile, change trail               |
| `GET/POST /wallets`, `/:id/challenge`, `/:id/verify`, `/managed`, `/passkey` | `settings:manage` | Payout addresses and proof of control                           |
| `GET /wallets/balance`, `GET /wallets/withdrawals`, `POST /wallets/withdraw` | `settings:manage` | Balance, successful withdrawal history, and moving out          |
| `GET/POST /webhooks/endpoints`, `/deliveries`                                | `settings:manage` | Endpoints, secret rotation, delivery inspection                 |
| `GET/POST/DELETE /api-keys[/:id]`                                            | `settings:manage` | Bearer access to this API, permissions a subset of the caller's |
| `GET/POST /admin/users`                                                      | `admin:access`    | Accounts within the caller's own merchant                       |

A dashboard **API key** is bearer-token access to this surface, with per-key
permissions that can only be a subset of the merchant's own. The secret is shown
once at creation; listings carry a prefix. A bearer request is exempt from CSRF —
it is not auto-sent cross-origin — and reaches exactly the surfaces its
permissions allow.

`catalog:manage` is its own permission rather than folded into `settings:manage`:
minting a link decides what a buyer is charged and never where the money lands, so
a cashier can sell all day without being able to redirect the payout.

A payment link's `url` points at the **payment API**, not at this one — the buyer
opening it is what mints an intent, and that happens where the clearing engine
lives. It is served with the link rather than assembled in the browser, which
would get it wrong in exactly the deployment where the two apps are not on the
same host (`CHECKOUT_BASE_URL`, defaulting to `PUBLIC_BASE_URL`).

### Two codes, and why they differ

A payment link's `url` is a **web page**. Rendered as a QR it opens the hosted
checkout in a browser — right for something sent to a customer, wrong held up at
a counter, where a phone wallet scanning it does nothing useful.

What a wallet pays is an **EIP-681 URI**, and that names a deposit address, which
belongs to one payment rather than to the link. Addresses are allocated at price
lock and every sale gets its own — that is what lets the watcher tell one payer's
transfer from another's. So a counter sale is: `POST /payment-links/:id/charge`
mints one payment and prices it, then `GET /payments/:id/deposit` returns the
address, the exact amount and the URI to encode.

```
USDC   ethereum:0x036c…f7e@84532/transfer?address=0xa5d8…afb&uint256=12500000
ETH    ethereum:0xf268…e05@84532?value=4166666666666663
```

The two forms are not interchangeable — for a token the URI target is the token
contract and the recipient is an argument. `charge` pins `executionPath` to
`deposit-match`: the contract path asks the payer to sign a transaction and
allocates no address, so it produces nothing to scan.

`POST /payment-links/:id/quote` prices a sale in every asset the merchant
accepts, before one is started, so a customer can choose what to pay with. It is
**indicative**: nothing is reserved, and the figure a payer is charged is the one
locked at confirm a moment later. An asset the rate provider cannot price comes
back as an unavailable line rather than failing the request.

Both routes reach the payment API server-side (`PAYMENT_API_URL`). The dashboard
mints no payments of its own: doing so would mean a second copy of the clearing
engine, the rate sources and the token registry, and a duplicate of "what must a
payer send" is a duplicate that drifts.

A link freezes a merchant snapshot, which carries `city` and `countryCode`. Both
live on the merchant record and are edited through `PATCH /settings`;
`POST /payment-links` refuses while either is unset rather than freezing a blank
into every payment the link takes. `GET /settings` reports `canCreateLinks` so the
dashboard can say which field is missing before a form is filled in.

## The x402 surface

Two mounts, and they are not the same thing.

- **`/x402/*` on the payment API, unversioned.** The buyer-facing half: discovery
  (`GET /x402/resources`, `/x402/payables`), the `402` terms, the facilitator's
  `verify` and `settle`, and the MCP server at `POST /x402/mcp`. Unversioned for
  the same reason the hosted checkout is — an agent that discovered a resource
  must be able to pay it later.
- **`/v1/x402/resources` on the payment API, merchant-authed**, and
  `/v1/x402-resources` on the dashboard API. The merchant-owned half: register,
  list and unlist your own endpoints. Gated on `catalog:manage` for the same
  reason a payment link is — it decides what a payer is charged, never where the
  money lands.

The whole surface answers `404` when `X402_ENABLED` is off, rather than
half-working. See [Agent Payments](./x402.md).

## Related

- [Payment Intent](./payment-intent.md)
- [Clearing Engine](./clearing-engine.md)
- [Agent Payments (x402)](./x402.md)
- [Development](./development.md)

[← Documentation index](./README.md)
