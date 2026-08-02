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
      "name": "Warung Kopi Mayarr",
      "city": "Jakarta"
    },
    "amount": { "amount": "5000000", "asset": "IDR", "formatted": "50000.00" },
    "settlementAsset": "IDRX",
    "expiresAt": "2026-01-01T00:15:00.000Z"
  }
}
```

Money crosses the wire as exact minor units (`amount`) plus a rendered decimal
(`formatted`). Clients that calculate use the former; clients that display use
the latter.

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
      "formatted": "50000.00"
    },
    "fee": { "amount": "25000", "asset": "IDRX", "formatted": "250.00" },
    "netAmount": {
      "amount": "4975000",
      "asset": "IDRX",
      "formatted": "49750.00"
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

## Settlement Webhook

```
POST /webhooks/:provider
```

One route for every rail — the provider is resolved through the adapter
registry, so adding a payment rail does not add a route. The raw body is passed
to the adapter untouched, so signatures are verified over exactly the bytes that
were signed.

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
