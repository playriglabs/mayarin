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
type SettlementMode = "external" | "internal";

interface SettlementAdapter {
  /** Registry key, also the `:provider` segment of the webhook route. */
  readonly name: string;
  /** Whether value leaves Mayarin (`external`) or stays as a merchant balance (`internal`). */
  readonly mode: SettlementMode;

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

### External vs internal

`mode` tells the clearing engine which `SETTLED` posting to make:

- **`external`** — the rail takes value _out_ of Mayarin (a direct on-chain
  transfer to the merchant's wallet). Once the rail confirms delivery, the
  engine credits the in-flight value back to `TREASURY`. The mock rail and a
  direct-EVM payout are both external.
- **`internal`** — the rail keeps value _in_ Mayarin as a merchant balance. The
  engine credits the in-flight value to `MERCHANT_HOLDING` (a liability), which
  the merchant can withdraw on-chain. The stablecoin adapter is internal.

The engine branches on `adapter.mode`, not on a concrete class — `mode` is a
port-level fact, so recognizing it never couples the engine to an adapter
implementation.

### Stablecoin adapter — watch-only payout

The `StablecoinSettlementAdapter` (`packages/providers/stablecoin`) is the
internal rail. It holds no `LedgerService` and signs nothing: it records the
settlement idempotently and reports `SUCCEEDED` synchronously, because an
internal ledger credit is deterministic. The engine posts the
`MERCHANT_HOLDING` credit. No private key is loaded and no on-chain transaction
is signed — the merchant's stablecoin balance is an accounting entry until
Phase 4 signs a withdrawal. This is the same watch-only posture as the chain
layer: Mayarin watches, it does not sign.

A real on-chain payout to the merchant's wallet is Phase 3 and uses the same
`SettlementAdapter` port with `mode: "external"` — a direct-EVM transfer is just
another external rail. The on-chain path supersedes the off-chain adapters for
supported assets: `PaymentRouter.sol` settles directly to the merchant's managed
wallet, and the off-chain adapters remain as the fallback deposit-matching
path's settlement.

Possible adapters

```
Mock (external)

Stablecoin (internal)

Direct EVM (external)

Future Providers
```

A rail does not have to be a bank. The on-chain path settles through the same
port: an EVM transfer to a merchant wallet is "hand value to a rail, get a
provider reference back", so the clearing engine never learns which one it is.

Business logic never depends on provider implementations.

---

---

## Out of MVP

Fiat payment rails (QRIS, bank transfer, PayNow, PromptPay, DuitNow, PIX, UPI,
SEPA, ACH) and a stablecoin → fiat off-ramp are intentionally **out of the MVP**.
The MVP serves merchants who can hold and use stablecoins. A fiat off-ramp is a
later, explicit phase with its own custody and regulatory perimeter — not an
assumption baked into the settlement port.

---

## Related

- [Clearing Engine](./clearing-engine.md)
- [REST API](./api.md)

[← Documentation index](./README.md)
