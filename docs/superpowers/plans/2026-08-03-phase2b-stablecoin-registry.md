# Phase 2B — Stablecoin Registry: implementation plan

> **Historical design record — 2026-08-03.** This documents Phase 2 as shipped.
> The product has since pivoted to crypto-commerce infrastructure with on-chain
> execution (Phase 3, `PaymentRouter.sol`) as the primary path. The stablecoin
> registry remains load-bearing and unchanged in direction. See
> [Roadmap](../../roadmap.md).

> Design: `docs/superpowers/specs/2026-08-03-phase2b-stablecoin-registry-design.md`.
> Rhythm: TDD. Write a failing test, watch it fail, implement, run
> `bun run typecheck && bun test`, commit. One task per commit.

## Task 1 — `packages/core/stablecoin` skeleton: types and predicates

Create `packages/core/stablecoin` with `package.json` (`@mayarin/stablecoin`,
deps `@mayarin/chain`, `@mayarin/shared`), `tsconfig`, `src/index.ts` barrel.
In `src/types.ts` define `StablecoinOnChain`, `Stablecoin`,
`StablecoinRegistry` (port), and pure helpers: `isLedgerOnly(s)`,
`depositPairs(registry)`-shaped enumeration helper as a pure function over
`Stablecoin[]` (e.g. `pairsOf(stablecoins): {chain, asset}[]`). Add `test/types.test.ts`
covering the helpers and the type shapes (a `Stablecoin` with empty `onChain` is
ledger-only; `pairsOf` flattens `onChain`).

Commit: `feat(stablecoin): add the registry port and value types`

## Task 2 — `InMemoryStablecoinRegistry`

In `packages/core/stablecoin/src/memory.ts`, implement `InMemoryStablecoinRegistry`
constructed from `readonly Stablecoin[]`. Implement `list`, `find`,
`isSettlementAsset`, `isDepositAsset`, `address`. Lowercase addresses on
construction. `test/memory.test.ts`: a registry with IDRX (ledger-only), USDC on
base-sepolia, USDT on base-sepolia + base — covers all five methods, including
`isDepositAsset` false for IDRX and for USDC on a chain it is not deployed on,
and `address` returning `undefined` for ledger-only.

Commit: `feat(stablecoin): add the in-memory registry`

## Task 3 — Config: `SETTLEMENT_ASSETS` and `resolveStablecoins`

In `apps/api/src/config.ts`: add `settlementAssets: jsonObject<string[]>("SETTLEMENT_ASSETS", "[]")`
to the schema; add `StablecoinConfig` (the resolved `Stablecoin[]`) and
`resolveStablecoins(data): Stablecoin[]` that throws `ConfigurationError` whose
**message includes the joined issues** (matching the Phase 2A `resolveChain`
pattern). Validation: every `SETTLEMENT_ASSETS` and every `CHAIN_ASSETS` asset
is a known `AssetCode` with `kind === "stablecoin"`; `config.settlementAsset` is
in the union `SETTLEMENT_ASSETS ∪ assets(CHAIN_ASSETS)`; the union is non-empty.
Build `Stablecoin[]` with `onChain` derived from `CHAIN_ASSETS`. Add
`config.stablecoins` to `Config`. `apps/api/test/config.test.ts`: add tests for a
valid registry, a non-stablecoin in `SETTLEMENT_ASSETS` (e.g. `ETH`) rejected, an
unknown asset rejected, `settlementAsset` outside the union rejected, and the
empty-union case.

Commit: `feat(api): resolve the stablecoin registry from config`

## Task 4 — PaymentIntent admissibility validation

Inject `StablecoinRegistry` into `PaymentIntentService` (new constructor
parameter; the composition root passes the registry). At intent creation, reject
with `ValidationError` when `settlementAsset` is not admitted
(`!isSettlementAsset`), and when `payment` is present but
`!isDepositAsset(payment.asset, payment.chain)`. Update
`packages/core/payment-intent` tests and `apps/api/test/harness.ts` (build a
registry from the existing test assets). Add focused tests: reject USDC
settlement when the registry only admits IDRX; reject a payer leg of USDC on a
chain it is not deployed on; accept IDRX (ledger-only) as a settlement asset.

Commit: `feat(payment-intent): validate assets against the stablecoin registry`

## Task 5 — Composition root and watcher pairs

In `apps/api/src/container.ts`: build `registry: StablecoinRegistry` from
`config.stablecoins`; inject into `PaymentIntentService`; derive the
`EvmChainClient` `tokens` map and the watcher `pairs` from `registry.list()`
instead of `chain.pairs`. Update `apps/api/src/index.ts` and
`apps/api/src/routes/admin.ts` to iterate registry pairs for the watcher tick.
Update `apps/api/test/harness.ts` and any test that asserted on `chain.pairs`.
Run the full suite; the Phase 2A watcher tests must still pass because the
registry produces the same pairs the old `chain.pairs` did.

Commit: `feat(api): wire the stablecoin registry into the composition root`

## Task 6 — Documentation

Update `docs/roadmap.md` (mark the Stablecoin Settlement / registry work as
in progress or shipped as appropriate, leaving Liquidity Router and Settlement
Engine `·`), `docs/architecture.md` (add `core/stablecoin` to the package tree,
note the registry as the single source of admissible stablecoins), and
`docs/development.md` (document `SETTLEMENT_ASSETS`). Add a short
`docs/stablecoin.md` page in the house style (header/footer index link, `##
Related`, prose on _why_: ledger-only vs on-chain, the union with `CHAIN_ASSETS`,
why validation is at the intent seam). Run `bun run check` (the `.remember/*`
prettier warnings are gitignored and pre-existing). Commit:
`docs: document the stablecoin registry`

## Notes

- 2B is config- and domain-only: **no Drizzle table**, no migration. The registry
  is built at boot and held in memory.
- Do not remove `CHAIN_ASSETS`; 2B is additive. The registry composes it with
  `SETTLEMENT_ASSETS`.
- Do not touch `StaticRateProvider` or the `RateProvider` port; that is 2C.
- Do not add a settlement adapter; that is 2D.
