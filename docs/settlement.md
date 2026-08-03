[← Documentation index](./README.md)

# Settlement

Managing settlement balances, and the provider abstraction every payment rail
plugs into.

---

## Settlement Engine

Responsible for managing settlement balances.

Responsibilities

- Treasury
- Stable asset inventory
- Settlement balance
- Fee accounting
- Rebalancing

```
Settlement Asset

↓

Settlement Engine

↓

Settlement Adapter
```

---

---

## Settlement Adapter

Provider abstraction.

```ts
interface SettlementAdapter {
  /** Registry key, also the `:provider` segment of the webhook route. */
  readonly name: string;

  settle(request: SettlementRequest): Promise<SettlementResult>;

  status(providerReference: string): Promise<SettlementStatus>;

  refund(request: RefundRequest): Promise<RefundResult>;

  webhook(context: WebhookContext): Promise<SettlementWebhookEvent | null>;
}
```

Adapters receive a `SettlementRequest` — merchant, amount in the settlement
asset, Mayarin's reference, an idempotency key — rather than a `PaymentIntent`.
A provider package therefore never depends on Mayarin's aggregates, and the intent
shape can evolve without touching every integration.

Every call returns a result rather than `void`: without the provider reference
there is nothing to poll `status` with, nothing to reconcile a webhook against,
and no way to prove a payout happened.

A webhook is treated as a _signal_, not as truth. It wakes the clearing engine,
which then asks the adapter for the authoritative status — so a spoofed or
replayed webhook cannot settle a payment on its own.

Possible adapters

```
Mock

QRIS

Bank Transfer

PayNow

PromptPay

DuitNow

Future Providers
```

Business logic never depends on provider implementations.

---

---

## Future Payment Rails

- QRIS
- Bank Transfer
- PayNow
- PromptPay
- DuitNow
- PIX
- UPI
- SEPA
- ACH

---

## Related

- [Clearing Engine](./clearing-engine.md)
- [REST API](./api.md)

[← Documentation index](./README.md)
