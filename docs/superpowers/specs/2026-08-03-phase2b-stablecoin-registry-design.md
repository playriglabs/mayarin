# Phase 2B — Stablecoin Registry

> **Historical design record — 2026-08-03.** This documents Phase 2 as shipped.
> The product has since pivoted to crypto-commerce infrastructure. The stablecoin
> registry remains load-bearing and unchanged in direction. See
> [Roadmap](../../roadmap.md).

> Status: design record. Sibling to the Phase 2A chain-layer spec; sourced from
> the seams mapped in `docs/superpowers/specs/2026-08-03-phase2-chain-layer-design.md`
> and the live codebase.

## Goal

Phase 2A made a payment wait for the payer's stablecoin to arrive on a per-intent
deposit address. But Mayarin still settles in a **single** asset
(`config.settlementAsset`, default `IDRX`), and the on-chain identities of the
stablecoins it watches live in free-form `CHAIN_ASSETS` env JSON with no notion
of an admissible set. A merchant cannot ask to be paid in USDC; nothing validates
that a requested settlement asset is supported; the watcher, router and
settlement adapter each have to re-derive what the deployment supports.

Phase 2B introduces a **Stablecoin Registry**: the single source of truth for
which stablecoins this deployment admits, and where each one lives on-chain. It
unblocks the Liquidity Router (2C, which needs to know what it can route _into_)
and the Settlement Engine (2D, which needs to know what it can pay a merchant
in). It does not, itself, move value.

## Scope and non-goals

In scope:

- A `StablecoinRegistry` port and a pure in-memory implementation.
- The `Stablecoin` / `StablecoinOnChain` value types.
- A new `SETTLEMENT_ASSETS` config, composed with the existing `CHAIN_ASSETS`
  into the registry at boot, with validation.
- Payment-intent validation: a chosen `settlementAsset` must be admitted; a
  payer's `payment: { asset, chain }` must be an on-chain deposit asset.
- Rewiring the composition root so the registry feeds the watcher pairs, the
  intent service, and (later) the router and settlement adapter.

Non-goals (deferred to 2C / 2D / Phase 4):

- Pricing or conversion. The registry says _what_ is admissible, not _what it
  costs_. That is the Liquidity Router (2C).
- Paying a merchant. Crediting a stablecoin balance is the Settlement Engine
  (2D).
- On-chain signing, sweeping, or custody. Phase 2 stays watch-only; on-chain
  payout is Phase 4 (`Direct EVM`).
- Non-stablecoin assets (ETH, BTC). The registry is stablecoins only; native
  crypto assets are Phase 4.

## Design decisions

### 1. A port in core, a pure impl, config at the root

The registry is a domain concept, so the port lives in a new
`packages/core/stablecoin` package, by analogy with `packages/core/chain`. The
implementation is an `InMemoryStablecoinRegistry` constructed from plain
`Stablecoin[]` — it has no I/O and no persistence, so it lives in the same core
package (like the scriptable fake chain lives in `packages/core/chain`). The
_only_ thing outside core is config parsing: `apps/api/src/config.ts` turns two
env vars into `Stablecoin[]`, and `apps/api/src/container.ts` builds the registry
from them. Nothing in `core` reads env.

### 2. Two config inputs, one registry, additive

The registry is built from two inputs, both already shaped by Phase 2A:

- `CHAIN_ASSETS` (existing) — `chain → asset → contract address`. Every asset
  that appears here is on-chain, therefore deposit-able, therefore an admissible
  settlement asset too.
- `SETTLEMENT_ASSETS` (new) — a JSON array of `AssetCode`, the admissible
  settlement set. This is where ledger-only stablecoins (e.g. `IDRX`, if a
  deployment credits it internally rather than holding it on-chain) are declared,
  since they have no `CHAIN_ASSETS` entry.

The admissible settlement set is the union: `SETTLEMENT_ASSETS ∪ assets(CHAIN_ASSETS)`.
A stablecoin with an on-chain identity is a deposit asset on the chains it lists;
one without is ledger-only and may settle a payment but cannot be the payer's leg.
`config.settlementAsset` (existing) remains the **default** settlement asset and
must be a member of the union.

This is additive: `CHAIN_ASSETS` keeps its Phase 2A meaning (on-chain
identities the watcher needs) and gains a sibling. No existing config is
removed, so a Phase 2A deployment still boots.

### 3. The registry owns the watcher pairs

Today `ChainConfig.pairs` is derived from `CHAIN_ASSETS` and the watcher ticks
over `chain.pairs`. After 2B, the pairs come from the registry: every
`Stablecoin.onChain` entry is a `(chain, asset)` the watcher must observe. This
removes the duplication between "what the watcher watches" and "what the
registry knows" — they become the same enumeration, and adding a stablecoin on a
new chain is a config edit, not a code change in two places.

### 4. Validation at the seam, not deep in the engine

Settlement-asset admissibility is checked once, in `PaymentIntentService` at
intent creation, where the caller's choice is rejected with a `ValidationError`
before any state is created. Deposit-asset admissibility (the payer's
`payment.asset` on `payment.chain`) is checked in the same place. The clearing
engine is unchanged: by the time a transaction exists, its assets are already
known admissible. This keeps the engine free of registry knowledge.

### 5. Stablecoins only, enforced at boot

Every asset in `SETTLEMENT_ASSETS` and every asset in `CHAIN_ASSETS` must have
`kind === "stablecoin"` in `packages/shared/src/asset.ts`. A deployment that
configures `ETH` as a settlement asset, or points `CHAIN_ASSETS` at an `ETH`
contract, fails to start — the same boot-time validation posture as
`EXCHANGE_RATES` and the Phase 2A chain config. Native crypto is Phase 4.

## Data model

```ts
// packages/core/stablecoin/src/types.ts

export interface StablecoinOnChain {
  readonly chain: ChainId;
  readonly address: `0x${string}`; // ERC-20 contract, lowercase
}

export interface Stablecoin {
  readonly asset: AssetCode; // kind === "stablecoin"
  /** Where this stablecoin lives on-chain. Empty for ledger-only settlement assets. */
  readonly onChain: ReadonlyArray<StablecoinOnChain>;
}

export interface StablecoinRegistry {
  /** Every admitted stablecoin. */
  list(): Promise<readonly Stablecoin[]>;
  /** The stablecoin for an asset, or undefined if not admitted. */
  find(asset: AssetCode): Promise<Stablecoin | undefined>;
  /** True if the asset is registered (admissible as a settlement asset). */
  isSettlementAsset(asset: AssetCode): Promise<boolean>;
  /** True if the asset is registered and deployed on the chain (a deposit asset). */
  isDepositAsset(asset: AssetCode, chain: ChainId): Promise<boolean>;
  /** The contract address for an asset on a chain, or undefined. */
  address(asset: AssetCode, chain: ChainId): Promise<`0x${string}` | undefined>;
}
```

`AssetCode` and `assetDecimals` come from `@mayarin/shared`; the registry does
not duplicate decimals. `ChainId` comes from `@mayarin/chain`.

## Configuration

```bash
# existing, unchanged shape
CHAIN_ASSETS={"base-sepolia":{"USDC":"0x036CbD53842c5426634e7929541eC2318f3dCF7e"}}

# new: admissible settlement set, including ledger-only stablecoins
SETTLEMENT_ASSETS=["IDRX","USDC","USDT"]

# existing: default, must be a member of the union
SETTLEMENT_ASSET=IDRX
```

Boot validation (`resolveStablecoins` in `config.ts`, throwing
`ConfigurationError` with the offending issues joined into the message, matching
the Phase 2A pattern):

- Every `SETTLEMENT_ASSETS` entry is a known `AssetCode` with `kind === "stablecoin"`.
- Every `CHAIN_ASSETS` asset is a known `AssetCode` with `kind === "stablecoin"`.
- `config.settlementAsset` is in the union `SETTLEMENT_ASSETS ∪ assets(CHAIN_ASSETS)`.
- The union is non-empty.

## Wiring

`apps/api/src/container.ts`:

- Builds `registry: StablecoinRegistry` from `config.stablecoins` (the resolved
  `Stablecoin[]`).
- Passes `registry` to `PaymentIntentService` (for admissibility validation) and
  to the watcher construction (pairs from `registry.list()`).
- The `EvmChainClient` still receives `tokens` (chain→asset→address) for
  `eth_getLogs` filters; that map is derived from the same registry, so the
  registry remains the single source.

`apps/api/src/index.ts` and `apps/api/src/routes/admin.ts` iterate the registry
pairs instead of `chain.pairs` for the watcher tick.

## What does not change

- The clearing engine. No new state, no new transition. The second rate lock at
  `PRICE_LOCKED` already quotes to `payment.asset`; admissibility is settled
  upstream.
- The ledger. The registry is a catalog; it posts nothing.
- `CHAIN_ASSETS` shape and the `EvmChainClient` token map.
- The `RateProvider` port. 2B does not touch `StaticRateProvider`; the
  Liquidity Router (2C) will swap the `rates` injection.

## Relationship to 2C and 2D

- **2C (Liquidity Router)** will inject a `LiquidityRouter` as the `rates`
  `RateProvider`. It will call `registry.list()`/`find()` to know the admissible
  `to` assets and, where a quote is on-chain, use the registry's addresses. 2B
  delivers the port 2C depends on.
- **2D (Settlement Engine)** will register a `StablecoinSettlementAdapter` that
  credits a merchant stablecoin balance by ledger posting, using `registry.find`
  to confirm the asset. 2B delivers the admissibility it relies on.

## Related

- `docs/chain.md` — the watcher and deposit addresses this registry feeds.
- `docs/superpowers/specs/2026-08-03-phase2-chain-layer-design.md` — the
  preceding chain-layer design.
- `docs/roadmap.md` — Phase 2 plan.
