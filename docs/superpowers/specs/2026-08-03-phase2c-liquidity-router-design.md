# Phase 2C — Liquidity Router

> **Historical design record — 2026-08-03.** This documents Phase 2 as shipped.
> The product has since pivoted to crypto-commerce infrastructure. The
> `LiquidityRouter`'s same-asset identity stays; its cross-asset delegation
> moves to the Phase 3 **Execution Engine**, and swap execution moves on-chain
> to `PaymentRouter.sol`. The router only prices. See [Roadmap](../../roadmap.md).

> Status: design record. Builds on the Phase 2A chain layer and the Phase 2B
> stablecoin registry.

## Goal

Phase 1 and 2A lock a rate at `PRICE_LOCKED` through the `RateProvider` port,
implemented today by `StaticRateProvider` reading the configured `EXCHANGE_RATES`
table. That table is the last Phase 1 stand-in: it prices every pair at a fixed
configured rate, ignores the size of the payment (no slippage), and has no seam
for real price discovery.

Phase 2C introduces a **Liquidity Router**: a `RateProvider` that prices a
quote through a pluggable **price source**, so the static table becomes one
source among many and a DEX or aggregator can be wired in (Phase 4) without
touching the clearing engine. It ships with two sources — the table, and a
constant-product AMM — so the router handles size-aware slippage now, not later.

## Scope and non-goals

In scope:

- A `PriceSource` port: `price(from, to, amount)` → a `PriceQuote` carrying
  `minorUnitsPerWholeUnit`, a `source` label, and an optional `expiresAt`.
- A `TablePriceSource` wrapping the existing `EXCHANGE_RATES` (behavior
  unchanged for fiat→stablecoin pairs).
- A `ConstantProductPriceSource` — pure Uniswap-v2 `x·y=k` math that prices a
  swap of `amount` given pool reserves, returning a size-aware rate with
  slippage. No network, no signing.
- A `LiquidityRouter` implementing `RateProvider`: same-asset identity, else
  delegate to a `PriceSource`.
- Wiring the router as the `rates` injection in the composition root and the
  test harness.

Non-goals (deferred):

- On-chain swap execution. The router only _prices_; it never moves value. The
  Settlement Engine (2D) credits a merchant balance from the locked rate; an
  actual DEX swap that realises the rate is Phase 4.
- Multi-hop routing. The router prices a single hop `from → to`. Composing
  `A → B → C` across the registry's admitted stablecoins is a later extension;
  the port surface (`PriceSource`) does not preclude it.
- Live oracle / aggregator integration. Phase 4.

## Design decisions

### 1. The port the engine already knows is the contract

`RateProvider.quote(from, to, amount)` (`packages/core/clearing/src/rate.ts`) is
the seam. The `LiquidityRouter` implements exactly that interface, so the
clearing engine, the `#lockPrice` and `#lockDeposit` calls, and `lockRate` do not
change. Swapping `StaticRateProvider` for `LiquidityRouter` is a one-line change
in the composition root.

### 2. A second port for the rate source

`PriceSource` is the seam a future DEX/aggregator implements. The router holds a
source and delegates cross-asset quotes to it; same-asset quotes never reach the
source (identity is the router's job, since "one whole unit of X is one whole
unit of X" is true regardless of source). Both ports live in
`packages/core/clearing/src/liquidity.ts`, alongside `StaticRateProvider` — the
existing precedent that a pure rate implementation may live in core. A source
that needs the network (viem, an HTTP aggregator) would live in
`packages/providers` and implement `PriceSource`, keeping the network boundary
out of core, exactly as the EVM chain client does for `ChainClient`.

### 3. Money is never a float — even in AMM math

`ConstantProductPriceSource` prices in integer minor units. The constant-product
invariant `x · y = k` is evaluated over BigInt pool reserves (minor units of each
asset). The output amount is `(amountIn · yOut) / (xIn + amountIn)` — integer
division, rounding in favour of the pool (the router never overstates what a
swap yields). The returned `minorUnitsPerWholeUnit` is then derived from
`amountOut / wholeUnitsIn` so the engine's existing `convert` math, which already
reasons in minor-units-per-whole-unit, stays exact. No `number`, no `Math`, no
rounding error reaches a balance.

### 4. Size-aware quotes are the point

`RateProvider.quote` already takes `amount`; `StaticRateProvider` ignores it.
`ConstantProductPriceSource` uses it: a larger swap moves the price more. This
is the substantive change 2C delivers — a quote that reflects the size of the
payment, the property a real liquidity source has and a flat table cannot.

### 5. Decimal safety across assets

A quote is `minorUnitsPerWholeUnit` — minor units of `to` per whole unit of
`from`. This already encodes the decimal difference (USDC at 6 dp vs IDRX at 2
dp): one whole USDC is `10^6` minor USDC, one whole IDRX is `10^2` minor IDRX,
and the rate is expressed in the latter per the former. The router and sources
read decimals from `packages/shared/src/asset.ts` and never assume two assets
share a unit.

## Data model

```ts
// packages/core/clearing/src/liquidity.ts

export interface PriceQuote {
  readonly from: AssetCode;
  readonly to: AssetCode;
  readonly minorUnitsPerWholeUnit: bigint;
  readonly source: string;
  readonly expiresAt?: Date;
}

export interface PriceSource {
  /** Price `amount` of `from` into `to`, or throw if this source cannot. */
  price(from: AssetCode, to: AssetCode, amount: Money): Promise<PriceQuote>;
}

export interface LiquidityRouterOptions {
  readonly source: PriceSource;
  readonly clock?: Clock;
}
```

`LiquidityRouter implements RateProvider`. Same-asset `quote` returns the
identity rate (`10 ** assetDecimals(to)` minor units of `to` per whole unit of
`from`) without consulting the source. Cross-asset `quote` delegates to
`source.price` and lifts the result into a `RateQuote`.

### TablePriceSource

Wraps the existing `Record<string, bigint>` keyed `"from/to"`, the shape
`config.exchangeRates` already produces. Same-asset pairs are the router's job;
the table only answers cross-asset. A missing pair throws `ConfigurationError`,
matching `StaticRateProvider`.

### ConstantProductPriceSource

Constructed from pool reserves per `(from, to)` pair: `xIn` (whole-unit reserve
of `from`), `yOut` (whole-unit reserve of `to`), plus a fee in basis points.
`price` computes the output minor units with integer math, derives
`minorUnitsPerWholeUnit`, and labels `source: "constant-product"`. A pool for the
reverse direction `(to, from)` is a separate configured reserve pair; the source
does not infer symmetry.

## Wiring

`apps/api/src/container.ts` builds a `LiquidityRouter` from a `PriceSource`
(today the `TablePriceSource` from `config.exchangeRates`; an AMM source can be
constructed from additional config in a later step) and injects it as `rates`.
`StaticRateProvider` remains in the package as the identity/table fallback but
is no longer the wired default. The test harness mirrors this.

## What does not change

- The clearing engine, `#lockPrice`, `#lockDeposit`, and `lockRate`.
- The `RateProvider` / `RateQuote` shapes.
- The ledger. The router prices; it posts nothing.
- The stablecoin registry. The router does not (yet) query it; multi-hop routing
  across admitted assets is a later extension that will.

## Relationship to 2B and 2D

- **2B** delivered the admissible set. A later multi-hop router will route
  `A → bridge → C` through admitted stablecoins; the registry is the enumeration
  that makes the path searchable. 2C ships single-hop but does not preclude it.
- **2D** (Settlement Engine) credits a merchant from the `settlementAmount`
  locked at `PRICE_LOCKED`. That amount is already correct regardless of which
  `RateProvider` priced it, so 2D does not depend on 2C — but 2C is what makes
  the locked amount something other than a flat configured number.

## Related

- `docs/clearing-engine.md` — the `PRICE_LOCKED` step and the two rate locks.
- `docs/stablecoin.md` — the admissible set the router will eventually route
  across.
- `docs/roadmap.md` — Phase 2 plan.
