[← Documentation index](./README.md)

---

# REST API

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

Endpoint management is admin-token guarded until the authenticated
merchant-config surface (#95) exists. One active endpoint per merchant; a URL
must be HTTPS and must not resolve to a private-network address:

```
POST /admin/webhooks/endpoints                  { merchantId, url } → endpoint + secret (shown once)
GET  /admin/webhooks/endpoints?merchantId=…     list, secrets masked
POST /admin/webhooks/endpoints/:id/rotate       new secret; the previous one stays verifiable
POST /admin/webhooks/endpoints/:id/deactivate
GET  /admin/webhooks/deliveries?merchantId=…    recent deliveries, newest first, DEAD included
POST /admin/webhooks/deliveries/:id/replay      re-queue one delivery; same body, same Webhook-Id
POST /admin/webhooks/tick                       force one dispatch pass
```

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
| `NOT_FOUND`                                                                            | 404    |
| `CONFLICT`, `IDEMPOTENCY_CONFLICT`, `INVALID_STATE_TRANSITION`, `CONCURRENCY_CONFLICT` | 409    |
| `LEDGER_IMBALANCE`, `CONFIGURATION_ERROR`, `INTERNAL_ERROR`                            | 500    |
| `PROVIDER_ERROR`                                                                       | 502    |

---

## Related

- [Payment Intent](./payment-intent.md)
- [Clearing Engine](./clearing-engine.md)
- [Development](./development.md)

[← Documentation index](./README.md)
