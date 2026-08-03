[← Documentation index](./README.md)

# Liquidity & Routing

Turning any supported digital asset into the settlement asset the merchant
chose, at a price that reflects the size of the payment.

Phase 1 locked a rate at `PRICE_LOCKED` through the `RateProvider` port, backed
by `StaticRateProvider` reading a configured `EXCHANGE_RATES` table. That table
was the last Phase 1 stand-in: it priced every pair at a fixed rate, ignored the
size of the payment (no slippage), and had no seam for real price discovery.

Phase 2C replaces it with a **Liquidity Router**: a `RateProvider` that prices a
quote through a pluggable **price source**, so the static table becomes one
source among many and a DEX or aggregator can be wired in (Phase 4) without
touching the clearing engine.

---

## The port the engine already knows

`RateProvider.quote(from, to, amount)` (`packages/core/clearing/src/rate.ts`) is
the contract. The `LiquidityRouter` implements exactly that interface, so the
clearing engine, the `#lockPrice` and `#lockDeposit` calls, and `lockRate` do
not change. Swapping `StaticRateProvider` for `LiquidityRouter` was a one-line
change in the composition root.

Same-asset quotes are the router's job, not the source's: one whole unit of X is
one whole unit of X regardless of source, so the router returns the identity
rate (`10^decimals(to)` minor units of `to` per whole unit of `from`) and never
calls the source. When the payer sends the same asset the merchant settles in,
the router has nothing to convert and that path skips a quote entirely.

---

## A second port for the rate source

`PriceSource` (`packages/core/clearing/src/liquidity.ts`) is the seam a future
DEX/aggregator implements. The router holds a source and delegates cross-asset
quotes to it. Both ports live in `packages/core/clearing` alongside
`StaticRateProvider` — the precedent that a pure rate implementation may live in
core. A source that needs the network (viem, an HTTP aggregator) would live in
`packages/providers` and implement `PriceSource`, keeping the network boundary
out of core, exactly as the EVM chain client does for `ChainClient`.

Two sources ship now:

- **`TablePriceSource`** wraps the existing `EXCHANGE_RATES` record keyed
  `"from/to"`. Behavior is unchanged for fiat→stablecoin pairs — the same
  configured rate, now reached through the router. This is the wired default.
- **`ConstantProductPriceSource`** is a pure Uniswap-v2 `x·y=k` AMM. Given pool
  reserves in BigInt minor units and a fee in basis points, it prices a swap of
  `amount` with integer math and returns a size-aware rate: a larger swap moves
  the price more. No network, no signing.

---

## Money is never a float — even in AMM math

`ConstantProductPriceSource` prices in integer minor units. The constant-product
invariant is evaluated over BigInt pool reserves; the output amount is integer
division, rounding in favour of the pool (the truncated remainder stays in the
pool, so the source never overstates what a swap yields). The returned
`minorUnitsPerWholeUnit` is derived from the input/output so the engine's
existing `convert` math — which already reasons in minor-units-per-whole-unit —
stays exact. No `number`, no `Math`, no rounding error reaches a balance.

A quote is `minorUnitsPerWholeUnit`: minor units of `to` per whole unit of
`from`. This already encodes the decimal difference (USDC at 6 dp vs IDRX at 2
dp), so the router and sources never assume two assets share a unit.

---

## What does not change

- The clearing engine, `#lockPrice`, `#lockDeposit`, and `lockRate`.
- The `RateProvider` / `RateQuote` shapes.
- The ledger. The router prices; it posts nothing.
- The stablecoin registry. The router does not query it yet; multi-hop routing
  across admitted stablecoins is a later extension that will.

`StaticRateProvider` remains in the package as the identity/table fallback but
is no longer the wired default.

---

## Smart Routing — Phase 4

The router prices a single hop `from → to`. Phase 4's smart routing optimizes
over liquidity, settlement, retries and treasury on top of it:

- Select the best liquidity source across `Uniswap`, `0x API`, `1inch`, `LI.FI`.
- Compose multi-hop paths `A → bridge → C` across the registry's admitted
  stablecoins; the `PriceSource` surface does not preclude it.
- Execute the swap on-chain — the router only _prices_ today; an actual swap
  that realises the locked rate is Phase 4.
- Retry failed settlements and optimize treasury allocation.

---

## Related

- [Clearing Engine](./clearing-engine.md) — the `PRICE_LOCKED` step and the two
  rate locks.
- [Stablecoin Registry](./stablecoin.md) — the admissible set the router will
  eventually route across.
- [Money](./money.md) — exact amounts and the decimal model every quote honours.
- [Architecture](./architecture.md)

[← Documentation index](./README.md)
