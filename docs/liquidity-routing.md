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
source among many and a DEX or aggregator can be wired in (Phase 3) without
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

## On-Chain Execution — Phase 3

The router prices a single hop `from → to`; it only _prices_ today. Phase 3
moves execution on-chain:

- `PaymentRouter.sol` receives the customer's asset, swaps via an approved DEX
  router, and settles to the merchant's wallet atomically — see
  [Architecture](./architecture.md).
- The **Execution Engine** is an off-chain planner: it selects the venue
  (`Uniswap`, `0x API`), fetches the executable quote that becomes `minOut`, and
  builds the calldata the contract executes. Swap logic is not duplicated
  off-chain.
- The executable `minOut` comes from the DEX quote; a **Price Oracle** (Pyth,
  Chainlink) is a deviation guard, not the fill price. Do not trust the oracle
  for the fill; trust the DEX, guard with the oracle.
- The `LiquidityRouter`'s same-asset identity stays; its cross-asset delegation
  moves to the Execution Engine. Multi-hop paths (`A → bridge → C`) across the
  registry's admitted stablecoins are a later extension the `PriceSource`
  surface does not preclude.

---

## Related

- [Clearing Engine](./clearing-engine.md) — the `PRICE_LOCKED` step and the two
  rate locks.
- [Stablecoin Registry](./stablecoin.md) — the admissible set the router will
  eventually route across.
- [Money](./money.md) — exact amounts and the decimal model every quote honours.
- [Architecture](./architecture.md)

[← Documentation index](./README.md)
