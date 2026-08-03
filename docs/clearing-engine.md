[← Documentation index](./README.md)

---

# Clearing Engine

The core of Mayarin.

Every payment passes through the clearing engine.

State Machine

```
CREATED

↓

QR_PARSED

↓

PRICE_LOCKED

↓

PAYMENT_PENDING

↓

ASSET_RECEIVED

↓

CLEARING

↓

SETTLING

↓

SETTLED

↓

SUCCESS
```

Any non-terminal state can also move to `FAILED`, which records why.

Every transaction is:

- **Idempotent** — each step is keyed by `${transactionId}:${state}`, so ledger
  postings and provider calls can be replayed without duplicating value.
- **Resumable** — the persisted state is the only input a step needs. Side
  effects run _before_ the state is persisted, so a crash in between means the
  resumed step repeats a no-op and then records the state.
- **Auditable** — every transition appends an event in the same database
  transaction as the state change.

Where the engine waits

| State             | Waiting for                 | Woken by                                        |
| ----------------- | --------------------------- | ----------------------------------------------- |
| `PAYMENT_PENDING` | the payer's asset to arrive | `recordAssetReceived` (Phase 2: wallet watcher) |
| `SETTLING`        | the payment rail to confirm | provider webhook, or `resume`                   |

---

## Related

- [Payment Intent](./payment-intent.md)
- [Double Entry Ledger](./ledger.md)
- [Settlement](./settlement.md)

[← Documentation index](./README.md)
