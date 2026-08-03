[← Documentation index](./README.md)

# Stablecoin Registry

The single source of truth for which stablecoins a deployment admits, and where
each one lives on-chain. It does not move value, price it, or pay anyone — it
answers _what is admissible_, so the watcher, the intent service, and (later) the
liquidity router and settlement engine all read from one catalog instead of
re-deriving what the deployment supports.

Phase 1 settled every payment in a single asset (`IDRX`). Phase 2A added the
on-chain identities the watcher needs, in free-form `CHAIN_ASSETS` env JSON, but
with no notion of an admissible set: a merchant could not ask to be paid in USDC,
and nothing validated that a requested settlement asset was actually supported.
The registry closes that gap.

---

## Ledger-only vs on-chain

A `Stablecoin` carries an `onChain` list of `{ chain, address }` identities. It
can be empty:

- **On-chain** — the stablecoin is an ERC-20 on at least one chain. It is a
  _deposit asset_: a payer can send it to a per-intent deposit address, so it can
  be the payer's leg. It is also an admissible settlement asset.
- **Ledger-only** — the stablecoin has no on-chain identity. A deployment credits
  it internally (for example, `IDRX` held as an accounting balance rather than an
  ERC-20). It can settle a payment — the merchant is paid in it — but it cannot be
  the payer's leg, because nothing on-chain can send it.

The distinction is data, not code: a ledger-only stablecoin simply has an empty
`onChain` list, and `isDepositAsset` returns false for it on every chain.

---

## Two config inputs, one registry

The registry is built at boot from the union of two env vars, so adding a
stablecoin is a config edit, not a code change in two places:

- `SETTLEMENT_ASSETS` — a JSON array of `AssetCode`, the admissible settlement
  set. This is where ledger-only stablecoins are declared.
- `CHAIN_ASSETS` — `chain → asset → contract address`, the on-chain identities
  the watcher also reads. Every asset here is on-chain, therefore a deposit
  asset, therefore admissible for settlement too.

The admissible settlement set is `SETTLEMENT_ASSETS ∪ assets(CHAIN_ASSETS)`.
`SETTLEMENT_ASSET` (existing) is the **default** and must be a member of the
union. Both inputs are additive over the Phase 2A config — nothing is removed,
so a Phase 2A deployment still boots.

Every asset in either must be a known stablecoin (`kind === "stablecoin"` in
`packages/shared/src/asset.ts`). Configuring `ETH` as a settlement asset, or
pointing `CHAIN_ASSETS` at an `ETH` contract, fails to start — the same boot-time
validation posture as `EXCHANGE_RATES` and the chain layer. Native crypto is
Phase 4.

---

## Validation at the intent seam

Admissibility is checked once, in `PaymentIntentService` at intent creation,
before any state is created:

- a chosen `settlementAsset` must be admitted (`isSettlementAsset`); and
- a payer's `payment: { asset, chain }` must be a deposit asset on that chain
  (`isDepositAsset`).

The clearing engine is unchanged. By the time a transaction exists, its assets
are already known admissible, so the engine never learns about the registry. This
keeps the engine free of catalog knowledge and the registry free of engine
knowledge — a one-way dependency the ports-and-adapters layout depends on.

---

## What the registry feeds

- **The watcher** ticks over `pairsOf(registry.list())` — every `onChain`
  identity is a `(chain, asset)` it must observe. This is the same enumeration
  `CHAIN_ASSETS` drove in Phase 2A; the registry simply owns it now.
- **The EVM client** receives a `chain → asset → address` token map rebuilt from
  the registry, for `eth_getLogs` address filters.
- **The intent service** rejects inadmissible assets at creation.
- **The liquidity router** (Phase 2C) will ask the registry what it can route
  _into_, and use the on-chain addresses where a quote is on-chain.
- **The settlement engine** (Phase 2D) will confirm a payout asset is admitted
  before crediting a merchant balance.

---

## Related

- [Chain Layer](./chain.md)
- [Payment Intent](./payment-intent.md)
- [Architecture](./architecture.md)

[← Documentation index](./README.md)
