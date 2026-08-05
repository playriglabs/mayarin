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

### Three assets, two rate locks

A payment intent carries three assets, not two: the `sourceAmount` the merchant
quoted, the `settlementAsset` the merchant is paid, and — when the payer pays
on-chain — the payer's asset on its chain (`payment: { asset, chain }`). At
`PRICE_LOCKED` the engine quotes twice off the same `sourceAmount`, locking both
rates in the same step so neither the payer's quote nor the merchant's payout can
drift mid-payment:

```
sourceAmount ──quote→settlement──> settlementAmount, fee, netAmount
             └─quote→payment─────> deposit.amount
```

When the payer sends the asset the merchant settles in, the two quotes coincide
and the Liquidity Router has nothing to convert. See [Chain Layer](./chain.md)
for the deposit addresses and confirmation policy that turn the second quote into
a received amount.

### On-chain execution _(Phase 3, primary path)_

The two-lock model above is the shipped deposit-matching path. The on-chain path
simplifies it: the hard lock is the **merchant's settlement amount** (`minOut`),
and the customer's payer-asset amount becomes a **display estimate**, not a
custody lock — `PaymentRouter.sol` swaps whatever the customer sends. Atomicity
plus a hard revert on `minOut` miss removes the treasury FX risk the two-lock
model carries between lock and receipt. The state machine above is unchanged;
the difference is where execution happens (contract vs. off-chain) and which
lock is hard. The path is a discriminator on the payment intent
(`ExecutionPath`: `deposit-match` | `on-chain-contract`), persisted on the
clearing transaction and set from the `EXECUTION_PATH` config default; the
contract variant is a throwing stub at the lock step until Phase 3 implements
it, so a contract-path payment fails cleanly without moving value.

---

## Related

- [Payment Intent](./payment-intent.md)
- [Chain Layer](./chain.md)
- [Double Entry Ledger](./ledger.md)
- [Settlement](./settlement.md)

[← Documentation index](./README.md)
