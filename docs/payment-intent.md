[← Documentation index](./README.md)

---

# Payment Intent

Creates immutable payment requests. Transitions return a new value with an
incremented version; nothing is mutated in place.

```ts
{
  id: "pi_01KZ0XNA7SYPQF8QP6K8PZ7TJH",
  status: "CREATED",
  merchant: { id: "ID1020017611473", name: "Warung Kopi Mayarin", city: "Jakarta", countryCode: "ID" },
  amount: { amount: 5_000_000n, asset: "IDR" },
  settlementAsset: "USDC",
  provider: "mock",
  expiresAt: "2026-01-01T00:15:00.000Z",
  version: 1
}
```

Lifecycle

```
CREATED
     │
     ▼
CONFIRMED
     │
     ▼
PROCESSING
     │
     ▼
COMPLETED

CREATED / CONFIRMED / PROCESSING ──▶ FAILED
CREATED / CONFIRMED ──────────────▶ EXPIRED
```

`FAILED` and `EXPIRED` are the terminal outcomes the happy path can end in.
Without them, an intent whose clearing was declined would have nowhere to go.

---

## Related

- [Money](./money.md)
- [Clearing Engine](./clearing-engine.md)
- [REST API](./api.md)

[← Documentation index](./README.md)
