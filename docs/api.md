[← Documentation index](./README.md)

---

# REST API

## Authentication

The payment API has two kinds of caller, and the routes split along that line.

**Buyer routes are open.** A buyer holds an unguessable id, not an account. The
hosted checkout and invoice pages, `POST /payment-links/:id/checkout`,
`POST /invoices/:id/checkout`, `POST /payment-intents/:id/confirm`,
`POST /quotes`, and the `GET` routes for one resource by id stay keyless.

**Merchant routes require an API key.** Mint one on the dashboard
(`POST /api-keys`). Send the secret as a bearer token on every request:

```http
Authorization: Bearer mak_...
```

| Route                                                          | Needs                                     |
| -------------------------------------------------------------- | ----------------------------------------- |
| `POST /payment-intents`                                        | a valid key                               |
| `POST /carts/checkout`                                         | a valid key, for the named merchant       |
| `POST /payments/:id/refunds`                                   | a valid key (a tenant check waits on #12) |
| `POST/PATCH /catalog/products[/:id]`                           | `catalog:manage`, for the named merchant  |
| `POST /payment-links`, `POST /payment-links/:id/disable`       | `catalog:manage`, for the named merchant  |
| `POST/PATCH /invoices[/:id]`, `/:id/issue`, `/:id/void`        | `catalog:manage`, for the named merchant  |
| `GET /catalog/products`, `GET /payment-links`, `GET /invoices` | a valid key, for the named merchant       |

On a list route, an omitted `merchantId` means the key's own merchant.

The refusal shape encodes what the caller was allowed to know. A missing key
and an unknown one get the same `401` — a revoked secret does not learn that it
once existed. A body that names another merchant gets a `403`, because the
caller named that merchant themselves. A path id that belongs to another
merchant gets the same `404` an absent id does.

## Create Payment Intent

```
POST /payment-intents
```

Accepts either a scanned QR payload or explicit merchant details. A dynamic QR
is authoritative for both merchant identity and amount; a supplied amount that
disagrees is rejected rather than silently overriding the merchant's quote.

An `Idempotency-Key` header makes creation replay-safe: the same request returns
the original intent, the same key with different parameters is a `409`.

`executionPath` selects how the `payment` rail is executed, **per payer rather
than per deployment**. A marketplace checkout where the payer connects a wallet
takes `on-chain-contract` and needs `payment.payerAddress`, which becomes the
signed order's `refundTo`. A payer who scans a QR or pastes an address into an
exchange withdrawal can only take `deposit-match`. Omitted, the deployment
default stands; the resolved value comes back on the intent, and is `null` for a
fiat-only intent that has no rail to execute.

`settlementAsset` defaults to the merchant's own configured asset before the
deployment default — an explicit request still wins over both.

```http
POST /payment-intents
Authorization: Bearer mak_...
Idempotency-Key: order-4711

{ "qr": "00020101021226670014ID.CO.QRIS.WWW..." }
```

```json
{
  "paymentIntent": {
    "id": "pi_01KZ0XNA7SYPQF8QP6K8PZ7TJH",
    "status": "CREATED",
    "merchant": {
      "id": "ID1020017611473",
      "name": "Warung Kopi Mayarin",
      "city": "Jakarta"
    },
    "amount": {
      "amount": "5000000",
      "asset": "IDR",
      "formatted": "50000.00",
      "display": "Rp 50.000,00"
    },
    "settlementAsset": "IDRX",
    "expiresAt": "2026-01-01T00:15:00.000Z"
  }
}
```

Money crosses the wire in three forms. `amount` is exact minor units — the only
one to calculate with. `formatted` is a machine-readable decimal, always
dot-separated and ungrouped. `display` is localized for a human reader and must
never be parsed: Indonesia writes fifty thousand rupiah as `Rp 50.000,00`, where
the dot groups thousands and the comma marks the decimal.

## Confirm Payment

```
POST /payment-intents/:id/confirm
```

Confirms the intent and hands it to the clearing engine. Safe to retry:
confirming a payment that is already clearing returns its current position
rather than starting a second one.

```json
{
  "paymentIntent": { "id": "pi_01KZ...", "status": "COMPLETED" },
  "clearing": {
    "state": "SUCCESS",
    "settlementAmount": {
      "amount": "5000000",
      "asset": "IDRX",
      "formatted": "50000.00",
      "display": "50.000,00 IDRX"
    },
    "fee": {
      "amount": "25000",
      "asset": "IDRX",
      "formatted": "250.00",
      "display": "250,00 IDRX"
    },
    "netAmount": {
      "amount": "4975000",
      "asset": "IDRX",
      "formatted": "49750.00",
      "display": "49.750,00 IDRX"
    },
    "providerReference": "stl_01KZ..."
  },
  "timeline": [{ "sequence": 1, "state": "CREATED", "occurredAt": "..." }]
}
```

## Transaction Status

```
GET /payments/:id
```

Accepts either a payment intent id (`pi_…`) or a clearing transaction id
(`clr_…`). Returns what was owed, how far along paying it is, and the ordered
timeline of how it got there.

On the deposit-match path the response carries a `deposit` object with the
per-intent address, the expected amount, confirmations so far, and `uri` — an
**EIP-681 payment URI** to render as a QR:

```
native   ethereum:0xRECIPIENT@84532?value=1050000000000000
ERC-20   ethereum:0xTOKEN@84532/transfer?address=0xRECIPIENT&uint256=3000000
```

The two forms are not interchangeable. For an ERC-20 the URI target is the
**token** contract and the recipient is an argument; the native form names the
recipient directly. `uri` is `null` rather than a guess when the asset has no
on-chain identity to name — a wrong URI moves the payer's funds somewhere
unrecoverable, so no URI is the safer answer.

This is what makes the deposit path work with **every** wallet and every
custodial exchange withdrawal without a per-wallet integration: a wallet that
scans a QR does exactly one thing with it — a plain transfer. Payers whose
wallet cannot scan can copy the `address` and `amount` instead.

## Contract-Path Submit Payload

```
GET /payments/:id/contract-call
```

The on-chain-contract path's checkout payload (#61), for a payment waiting at
`PAYMENT_PENDING`. Accepts either id, like the status route. Returns the
signed EIP-712 order, the deployed `PaymentRouter` address and chain, and a
**fresh executable route** — fetched per call, never cached, because a route
goes stale much faster than a price. For a native payer the response includes
`transaction`, a ready `payEth` call `{to, data, value}`. An ERC-20 payer
assembles `payERC20` client-side: only their wallet can sign the Permit2
authorisation. A `404` means the contract path is not enabled on this
deployment; a `410` means the quote lock expired — request a new payment.

## Settlement Webhook

```
POST /webhooks/:provider
```

One route for every rail — the provider is resolved through the adapter
registry, so adding a payment rail does not add a route. The raw body is passed
to the adapter untouched, so signatures are verified over exactly the bytes that
were signed.

## Outbound Webhooks (RFC #13)

Enabled with `WEBHOOKS_ENABLED=true`. Deliveries derive from the clearing
event log: every state transition becomes one signed POST per configured
endpoint. The payload carries ids and the new state, never amounts — a
webhook is a signal, and a receiver that needs the record asks the API.

Each delivery carries three headers. `Webhook-Id` is the clearing event id
and is the receiver's idempotency key: a retry repeats the same id and the
same bytes. `Webhook-Signature` is `t=<unix>,v1=<hex>` — HMAC-SHA256 over
`timestamp.body` with the endpoint secret, one `v1` entry per active secret
during a rotation. Verify with `verifyWebhook` from `@mayarin/notifications`
(the SDK ships the same function). Failed deliveries retry on a backoff
schedule and park as `DEAD` after the last attempt.

The payload's `data` also carries the payment's `sequence`, the intent's
`metadata`, and `merchantReference` when the merchant supplied one — so a
receiver matches an event to their own order without keeping a map from
Mayarin's ids to theirs. Delivery is at-least-once and unordered: a receiver keeps the
highest sequence seen per payment and discards anything below it, and
deduplicates on `Webhook-Id` — exactly-once over a network is not on offer.

Merchants manage their own endpoints and inspect their own deliveries through
the dashboard API, behind a session and the `settings:manage` permission. Every
route reads the merchant from the session — none takes a merchant id, so one
merchant cannot read or replay another's deliveries. One active endpoint per
merchant; a URL must be HTTPS and must not resolve to a private-network address:

```
GET  /webhooks/endpoints                  list, secrets masked
POST /webhooks/endpoints                  { url } → endpoint + secret (shown once)
POST /webhooks/endpoints/:id/rotate       new secret; the previous one stays verifiable
POST /webhooks/endpoints/:id/deactivate
GET  /webhooks/deliveries?limit=…         recent deliveries, newest first, DEAD included
POST /webhooks/deliveries/:id/replay      re-queue one delivery; same body, same Webhook-Id
```

A delivery carries what the receiver answered — status code and error — because
a dead-lettered delivery a merchant cannot see is a payment they silently miss.

The same surface exists on the payment API behind `ADMIN_TOKEN`, for operators
supporting a merchant who cannot reach their own dashboard:

```
POST /admin/webhooks/endpoints                  { merchantId, url } → endpoint + secret (shown once)
GET  /admin/webhooks/endpoints?merchantId=…     list, secrets masked
POST /admin/webhooks/endpoints/:id/rotate       new secret; the previous one stays verifiable
POST /admin/webhooks/endpoints/:id/deactivate
GET  /admin/webhooks/deliveries?merchantId=…    recent deliveries, newest first, DEAD included
POST /admin/webhooks/deliveries/:id/replay      re-queue one delivery; same body, same Webhook-Id
POST /admin/webhooks/tick                       force one dispatch pass
```

## Live payment status

```
GET /checkout/events/:intentId    text/event-stream
```

Server-Sent Events rather than a WebSocket: payment status is one-way,
`EventSource` reconnects on its own, and a plain HTTP response survives proxies
that refuse an upgrade.

Public, like the checkout page it serves — an intent id is an unguessable ULID,
the same posture `GET /payments/:id` takes. Holding the link lets you watch that
one payment and nothing else.

The first frame carries the current status, so a page that connects after a
change does not wait for the next one. Later frames are a nudge (`event:
payment`) rather than the state itself: the client re-reads the payment, so
there is one source of truth and no payment detail travels through the channel.
The stream closes once the payment is terminal.

Behind it, a state change is announced with `NOTIFY` **on commit** and every API
process `LISTEN`s — so a payer connected to one instance sees a payment settled
by another. A rolled-back write announces nothing.

The hosted checkout falls back to polling when a stream cannot be opened, when
the process is at its watched-payment ceiling, or when a proxy buffers the
response. A payer who cannot stream must still be able to pay.

## Health

```
GET /health
```

## Errors

Every failure returns the same envelope. `code` is the stable contract; the
message is for humans.

```json
{
  "error": {
    "code": "IDEMPOTENCY_CONFLICT",
    "message": "Idempotency key \"order-4711\" was already used with different parameters",
    "details": { "existingIntentId": "pi_01KZ..." }
  }
}
```

| Code                                                                                   | Status |
| -------------------------------------------------------------------------------------- | ------ |
| `VALIDATION_ERROR`, `QR_PARSE_ERROR`                                                   | 400    |
| `UNAUTHORIZED`                                                                         | 401    |
| `FORBIDDEN`                                                                            | 403    |
| `NOT_FOUND`                                                                            | 404    |
| `CONFLICT`, `IDEMPOTENCY_CONFLICT`, `INVALID_STATE_TRANSITION`, `CONCURRENCY_CONFLICT` | 409    |
| `LEDGER_IMBALANCE`, `CONFIGURATION_ERROR`, `INTERNAL_ERROR`                            | 500    |
| `PROVIDER_ERROR`                                                                       | 502    |

---

## Dashboard API (`apps/dashboard-api`)

A second surface, on its own port, for the merchant signed into the dashboard.
Everything above authenticates per request and takes the merchant as an argument,
which is right for an SDK consumer holding their own credentials and wrong for a
browser. Here the merchant is **the session's**: no route accepts a merchant id,
so there is nothing to tamper with, and a cross-merchant id resolves to the same
404 an absent one does.

Session cookie plus a double-submit CSRF token on every mutating call. Each group
names the permission that opens it.

| Route                                                                        | Permission        | What it is                                              |
| ---------------------------------------------------------------------------- | ----------------- | ------------------------------------------------------- |
| `POST /auth/login`, `/logout`, `GET /me`                                     | —                 | Session lifecycle                                       |
| `GET /payments`, `/payments/:id`                                             | `payments:read`   | The merchant's own intents, with clearing and timeline  |
| `GET /audit`, `/audit/:id`                                                   | `payments:read`   | Compliance record with ledger ↔ chain reconciliation    |
| `GET /settlements`                                                           | `payments:read`   | What clearing booked, plus what the chain reported      |
| `GET/POST/PATCH /catalog/products[/:id]`                                     | `catalog:manage`  | Products, priced per currency                           |
| `GET/POST /payment-links`, `/:id/disable`                                    | `catalog:manage`  | Link templates, each carrying its hosted-checkout `url` |
| `GET/PATCH /settings`, `GET /settings/history`                               | `settings:manage` | Settlement config, merchant profile, change trail       |
| `GET/POST /wallets`, `/:id/challenge`, `/:id/verify`, `/managed`, `/passkey` | `settings:manage` | Payout addresses and proof of control                   |
| `GET /wallets/balance`, `POST /wallets/withdraw`                             | `settings:manage` | On-chain settlement balance, and moving it out          |
| `GET/POST /webhooks/endpoints`, `/deliveries`                                | `settings:manage` | Endpoints, secret rotation, delivery inspection         |
| `GET/POST /admin/users`                                                      | `admin:access`    | Accounts within the caller's own merchant               |

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

## Related

- [Payment Intent](./payment-intent.md)
- [Clearing Engine](./clearing-engine.md)
- [Development](./development.md)

[← Documentation index](./README.md)
