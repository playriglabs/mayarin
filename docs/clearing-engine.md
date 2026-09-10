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

| State             | Waiting for                 | Woken by                                           |
| ----------------- | --------------------------- | -------------------------------------------------- |
| `PAYMENT_PENDING` | the payer's asset to arrive | `recordAssetReceived` — the wallet watcher         |
|                   | a `PaymentCompleted` log    | `recordPaymentCompleted` — the settlement indexer  |
|                   | a facilitator to broadcast  | the x402 settle step, after reading the chain back |
| `SETTLING`        | the payment rail to confirm | provider webhook, or `resume`                      |

A webhook is a **signal, not truth**: it wakes the engine, which then asks the
adapter for the authoritative status, so a spoofed or replayed webhook cannot
settle a payment on its own.

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
(`ExecutionPath`: `deposit-match` | `on-chain-contract` | `x402`), persisted on
the clearing transaction and set from the `EXECUTION_PATH` config default.

The engine walks the contract path through a port (#61). A
`ContractPaymentPlanner`, injected like the deposit layer, prices both legs,
locks, and signs the EIP-712 order at `PRICE_LOCKED`; the signed fields
(`intentId`, `minOut`, `fee`, `deadline`, signature) persist on the
transaction. The route and the router calldata are **not** part of the lock —
a route goes stale faster than a price, so the checkout API builds it per
attempt at submit time.

Rules specific to the contract path:

- **`ASSET_RECEIPT_MODE` never applies.** The contract funds atomically:
  receive, swap and settle happen in one transaction. `auto` receipt
  confirmation is ignored on this path; only `recordPaymentCompleted` — the
  seam the indexer (#8) calls when it ingests `PaymentCompleted` — advances a
  waiting payment.
- **No settlement adapter.** The contract paid the merchant Safe on-chain.
  `SETTLING` records the transaction hash as the provider reference and the
  ledger books the settlement as an external delivery.
- **Expiry fails, never re-quotes.** Past the lock deadline plus a grace for
  indexing lag (default 60 s), the engine fails the payment with
  `QUOTE_EXPIRED`. A new price needs the payer's consent, so the flow starts
  over with a fresh quote. The contract enforces the same deadline on-chain,
  so a payment failed here cannot settle later.

### x402 execution _(for programs)_

The third path. A program signs one EIP-3009 authorization and a facilitator
broadcasts it. The state machine is again unchanged; three things differ, and
each one is a branch in `engine.ts`:

- **No deposit address is derived.** The payment is identified by the
  authorization nonce, not by where the money landed. `usesDepositAddress` is
  false, so `#lockDeposit` allocates nothing.
- **`ASSET_RECEIPT_MODE=auto` never applies.** `awaitsFacilitatorSettlement` is
  true, and only the settle step — having read the transaction back off the chain
  and matched token, recipient and full amount — advances the payment. A
  facilitator's `success` is a claim.
- **The fee is zero on this rail.** `exact` sends the full amount directly to
  `payTo` — the authorization names one recipient and one amount, so there is no
  fee leg in the transfer. Applying the deposit fee here would invent revenue
  nobody received, so the engine takes `zero` instead.

Both predicates are named rather than spelled `!== "on-chain-contract"`. That
phrasing was correct with two paths and silently wrong with three — it is the
reason the predicates exist.

A cross-asset x402 payment is two on-chain movements (authorization, then an
exact-output swap), planned and persisted before the payer's money moves, so a
run killed between them resumes into the swap rather than re-taking the
authorization. `resumeStuck` covers it, and there is a test that kills an intent
after the broadcast to prove it.

See [Agent Payments](./x402.md) for the protocol, the resource registry, the
replay key, and the rail choice.

---

## Related

- [Payment Intent](./payment-intent.md)
- [Chain Layer](./chain.md)
- [Agent Payments (x402)](./x402.md)
- [Double Entry Ledger](./ledger.md)
- [Settlement](./settlement.md)

[← Documentation index](./README.md)
