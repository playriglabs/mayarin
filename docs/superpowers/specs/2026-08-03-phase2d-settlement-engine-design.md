# Phase 2D — Settlement Engine

> **Historical design record — 2026-08-03.** This documents Phase 2 as shipped.
> The product has since pivoted to crypto-commerce infrastructure. On-chain
> settlement to the merchant's managed wallet (Phase 3, `PaymentRouter.sol`) is
> the primary path; the off-chain `SettlementAdapter` port remains as the
> fallback deposit-matching path's settlement. See [Roadmap](../../roadmap.md).

> Status: design record. Builds on the Phase 2A chain layer, the Phase 2B
> stablecoin registry, and the Phase 2C liquidity router.

## Goal

Phase 1 settles a payment through a `SettlementAdapter` — today only the mock
rail — and the ledger's `settledPosting` returns the in-flight value to
`TREASURY` once the rail confirms delivery. The merchant is paid _externally_ by
the rail; Mayarin never holds a merchant balance.

Phase 2D adds a **stablecoin settlement engine**: a `StablecoinSettlementAdapter`
that settles a payment _internally_ by crediting the merchant a stablecoin
balance Mayarin holds on their behalf — a ledger liability, withdrawable
on-chain in Phase 4. This is the watch-only payout: no private key is loaded, no
on-chain transaction is signed. A real on-chain payout (direct EVM transfer to
the merchant's wallet) is Phase 4 and uses the same `SettlementAdapter` port
with `mode: "external"`.

## Scope and non-goals

In scope:

- A `mode` discriminator on the `SettlementAdapter` port: `"external"` (value
  leaves to a rail; treasury is made whole) vs `"internal"` (value stays in
  Mayarin as a merchant balance).
- A `MERCHANT_HOLDING` ledger account kind (liability): stablecoin balances
  credited to merchants, withdrawable on-chain in Phase 4.
- An `internalSettledPosting`: `Dr SETTLEMENT_IN_FLIGHT, Cr MERCHANT_HOLDING`
  for the net payout, replacing the treasury credit for internal settlements.
- The clearing engine branches on `adapter.mode` at the `SETTLED` step.
- A `StablecoinSettlementAdapter` (`packages/providers/stablecoin`):
  synchronous, idempotent, no network, no ledger — it reports `SUCCEEDED` and
  the engine posts the credit.
- Composition-root wiring: register the `stablecoin` adapter; let an intent opt
  in with `provider: "stablecoin"`.
- Documentation.

Non-goals (deferred):

- On-chain payout. Signing a transfer to the merchant's wallet is Phase 4. 2D
  credits an internal balance; a Phase 4 `DirectEvmSettlementAdapter`
  (`mode: "external"`) realises it on-chain.
- Orphaned/overpaid deposit recovery as a value movement. Sweeping an orphaned
  deposit back out of a per-intent deposit address requires an on-chain
  signature, which is Phase 4. 2D does not move orphaned value; the chain
  layer's existing "orphaned-after-confirmed" flag remains a treasury signal,
  and the sweep is a Phase 4 treasury operation.
- Per-merchant balance queries. `MERCHANT_HOLDING:ASSET` is an aggregate
  liability, exactly as `MERCHANT_PAYABLE:ASSET` is today. A merchant's
  individual holding is derived from their clearing transactions; a
  merchant-facing balance view is Phase 5 (dashboard, skipped here).
- Automatic provider selection. The intent creator chooses `provider`; 2D
  registers the adapter and validates it, it does not route by settlement asset.

## Design decisions

### 1. A `mode` on the port, not an instanceof check

The clearing engine must post a different `SETTLED` entry for an internal
settlement than for an external rail. The engine learns _which_ through a
`mode: SettlementMode` field on `SettlementAdapter`, not by recognizing a
concrete class — that would couple the engine to an adapter and break the
ports-and-adapters boundary the whole layout protects. `mode` is a port-level
fact: "does this rail take value out of Mayarin, or keep it as a merchant
balance?" The mock rail is `"external"`; the stablecoin credit is `"internal"`;
a future direct-EVM payout is `"external"`.

### 2. The engine posts; the adapter reports

The existing division is preserved: the adapter reports settlement state
(`settle` / `status`), the engine moves value. The `StablecoinSettlementAdapter`
holds no `LedgerService` and posts nothing — it records the settlement
idempotently and returns `SUCCEEDED` synchronously, because an internal ledger
credit is deterministic. The engine's `#confirmSettlement` SUCCEEDED branch
chooses the posting by `adapter.mode`. This keeps ledger access in the engine
(the only place it already is) and keeps the adapter a pure state-reporter.

### 3. One new account kind, one new posting

`MERCHANT_HOLDING` (liability) is the only new account kind. The internal
settled posting is the mirror of the existing external one:

```
external SETTLED   Dr SETTLEMENT_IN_FLIGHT   Cr TREASURY          (net)
internal SETTLED   Dr SETTLEMENT_IN_FLIGHT   Cr MERCHANT_HOLDING  (net)
```

Both reuse the `${transactionId}:SETTLED` idempotency key — exactly one runs per
transaction, so a resume replays the same posting as a no-op. Net effect of an
internal settlement: `TREASURY` (asset) up by the settlement amount from
`ASSET_RECEIVED`, `MERCHANT_HOLDING` (liability) up by the net, `FEE_REVENUE`
up by the fee. Balanced: settlement amount = net + fee.

### 4. Watch-only upheld

No `@mayarin/chain` import, no viem, no private key in 2D. The
`StablecoinSettlementAdapter` is pure and synchronous. The merchant's stablecoin
balance is an accounting entry until Phase 4 signs a withdrawal. This is the
same posture as the chain layer: Mayarin watches, it does not sign.

### 5. The stablecoin registry validates, the engine does not learn it

The adapter does not re-check the registry; admissibility was enforced at intent
creation (2B). The engine does not learn about the registry. The settlement
asset on the `SettlementRequest.amount` is the asset the merchant chose; the
engine posts `MERCHANT_HOLDING:ASSET` from it directly.

## Data model

```ts
// packages/core/settlement/src/types.ts
export type SettlementMode = "external" | "internal";

export interface SettlementAdapter {
  readonly name: string;
  readonly mode: SettlementMode;
  settle(request: SettlementRequest): Promise<SettlementResult>;
  status(providerReference: string): Promise<SettlementStatus>;
  refund(request: RefundRequest): Promise<RefundResult>;
  webhook(context: WebhookContext): Promise<SettlementWebhookEvent | null>;
}
```

```ts
// packages/core/ledger/src/accounts.ts
MERCHANT_HOLDING: {
  type: "LIABILITY",
  name: "Merchant holding",
  description: "Stablecoin balances credited to merchants, withdrawable on-chain in Phase 4.",
}
```

```ts
// packages/core/clearing/src/postings.ts
export function internalSettledPosting(
  transaction: ClearingTransaction,
): DraftTransaction {
  // Dr SETTLEMENT_IN_FLIGHT (net), Cr MERCHANT_HOLDING (net)
  // idempotency key: postingIdempotencyKey(transaction, "SETTLED")
}
```

```ts
// packages/providers/stablecoin/src/adapter.ts
export class StablecoinSettlementAdapter implements SettlementAdapter {
  readonly name = "stablecoin";
  readonly mode = "internal" as const;
  // in-memory, idempotent by idempotencyKey, synchronous SUCCEEDED
}
```

## Engine change

`ClearingEngine.#confirmSettlement`, SUCCEEDED branch:

```ts
const adapter = this.#adapters.get(transaction.provider);
const posting =
  adapter.mode === "internal"
    ? internalSettledPosting(transaction)
    : settledPosting(transaction);
await this.#ledger.post(posting);
```

No other engine change. `#settle`, `#lockPrice`, the state machine, and the
external flow are untouched.

## Wiring

`apps/api/src/container.ts` registers a `StablecoinSettlementAdapter` alongside
the mock, keyed `"stablecoin"`. An intent that wants an internal stablecoin
credit is created with `provider: "stablecoin"` and an admitted `settlementAsset`
(USDC/USDT/IDRX). The default provider stays `"mock"` so existing deployments
and tests boot unchanged. The test harness mirrors the registration so route
tests can exercise the internal flow.

## What does not change

- The clearing state machine and every other posting.
- The `SettlementAdapter` contract surface (`settle`/`status`/`refund`/`webhook`)
  — only `mode` is added.
- The ledger balance invariant; the new posting balances like the old one.
- The stablecoin registry and the liquidity router.
- The chain layer's watch-only posture.

## Relationship to 2A, 2B, 2C

- **2A** delivered per-intent deposit addresses and the watcher. A payer's
  stablecoin arrives at a deposit address and drives `ASSET_RECEIVED`; 2D then
  credits the merchant an internal balance of (possibly different) settlement
  asset. The on-chain sweep of an orphaned deposit stays Phase 4.
- **2B** delivered the admissible set. The settlement asset on an internal
  settlement is admitted by construction (validated at intent creation), so the
  engine and adapter trust it.
- **2C** delivered the rate. The `settlementAmount` locked at `PRICE_LOCKED` is
  what 2D credits the merchant (net of fee), regardless of which `RateProvider`
  priced it.

## Related

- `docs/settlement.md` — the settlement adapter port and the SETTLING→SETTLED
  step.
- `docs/ledger.md` — the chart of accounts and the balance invariant.
- `docs/clearing-engine.md` — the state machine.
- `docs/roadmap.md` — Phase 2 plan.
