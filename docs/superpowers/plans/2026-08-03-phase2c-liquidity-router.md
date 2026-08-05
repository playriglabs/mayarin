# Phase 2C — Liquidity Router: implementation plan

> **Historical design record — 2026-08-03.** This documents Phase 2 as shipped.
> The product has since pivoted to crypto-commerce infrastructure. The
> `LiquidityRouter`'s same-asset identity stays; its cross-asset delegation
> moves to the Phase 3 **Execution Engine**, and swap execution moves on-chain
> to `PaymentRouter.sol`. The router only prices. See [Roadmap](../../roadmap.md).

> Design: `docs/superpowers/specs/2026-08-03-phase2c-liquidity-router-design.md`.
> Rhythm: TDD. Write a failing test, watch it fail, implement, run
> `bun run typecheck && bun test`, commit. One task per commit.

## Task 1 — `PriceSource` port and `PriceQuote`

In `packages/core/clearing/src/liquidity.ts` (new file), define `PriceQuote`
(`from`, `to`, `minorUnitsPerWholeUnit`, `source`, optional `expiresAt`) and the
`PriceSource` port (`price(from, to, amount): Promise<PriceQuote>`). Re-export
from `src/index.ts`. Add `test/liquidity.test.ts` with a type/shape test using a
hand-rolled `PriceSource` stub — the port has no logic to assert on, so the test
pins the `PriceQuote` shape and the `price` call signature.

Commit: `feat(clearing): add the PriceSource port and quote shape`

## Task 2 — `TablePriceSource`

In `liquidity.ts`, add `TablePriceSource implements PriceSource` constructed from
`Readonly<Record<string, bigint>>` keyed `"from/to"` (the shape
`config.exchangeRates` already produces) plus a `source` label defaulting to
`"table"`. `price` looks up `rateKey(from, to)`; a missing cross-asset pair
throws `ConfigurationError` (matching `StaticRateProvider`). Same-asset pairs are
the router's job — the table answers cross-asset only, so a same-asset call to
the source throws. Tests in `test/liquidity.test.ts`: a configured cross-asset
pair returns the configured `minorUnitsPerWholeUnit`; a missing pair throws; the
`source` label is carried through.

Commit: `feat(clearing): add the table price source`

## Task 3 — `ConstantProductPriceSource`

In `liquidity.ts`, add `ConstantProductPriceSource implements PriceSource`. A
pool is keyed `(from, to)` with whole-unit reserves `reserveFrom` /
`reserveTo` (BigInt minor units) and a fee in basis points taken from the input
before the swap. `price` computes the Uniswap-v2 invariant with integer math:

- `amountInMinor = amount.minorUnits`
- `amountInAfterFee = amountInMinor * (10000 - feeBps) / 10000`
- `amountOutMinor = (amountInAfterFee * reserveTo) / (reserveFrom + amountInAfterFee)`

Integer division, rounding in favour of the pool (the truncated remainder stays
in the pool). Derive `minorUnitsPerWholeUnit = (amountOutMinor * 10^decimalsFrom)
/ wholeUnitsIn` where `wholeUnitsIn = amountInMinor / 10^decimalsFrom`, so the
engine's existing `convert` math stays exact. Label `source: "constant-product"`.
A pool for the reverse direction is a separate configured reserve pair; the
source does not infer symmetry, and a missing `(from, to)` pool throws
`ConfigurationError`. Tests: a known reserve pair matches a hand-computed output
for two sizes (small vs large — the larger moves the price more, proving
size-awareness); the fee reduces output; a missing reverse pool throws.

Commit: `feat(clearing): add the constant-product price source`

## Task 4 — `LiquidityRouter`

In `liquidity.ts`, add `LiquidityRouter implements RateProvider` constructed from
`{ source: PriceSource }`. `quote`:

- same-asset: return identity `minorUnitsPerWholeUnit = 10 ** assetDecimals(to)`,
  `source: "identity"`, no source call;
- cross-asset: delegate to `source.price(from, to, amount)` and lift the
  `PriceQuote` into a `RateQuote` (the shapes already match: `from`, `to`,
  `minorUnitsPerWholeUnit`, `source`, optional `expiresAt`).

Tests in `test/liquidity.test.ts`: same-asset returns identity and never calls
the source (use a stub that throws if called); cross-asset delegates and passes
`amount` through; an unsupported cross-asset pair surfaces the source's
`ConfigurationError`.

Commit: `feat(clearing): add the liquidity router`

## Task 5 — Wire the router into the composition root and harness

In `apps/api/src/container.ts`: build
`rates = new LiquidityRouter({ source: new TablePriceSource(config.exchangeRates) })`
and inject as `rates` (replacing `new StaticRateProvider(config.exchangeRates)`).
Mirror in `apps/api/test/harness.ts`. `StaticRateProvider` stays in the package
as the identity/table fallback but is no longer the wired default. Run the full
suite; the clearing engine and deposit tests must pass unchanged because
`LiquidityRouter` quotes through the same table `StaticRateProvider` did.

Commit: `feat(api): wire the liquidity router as the rate provider`

## Task 6 — Documentation

Update `docs/roadmap.md` (mark Liquidity Router shipped, leave Settlement Engine
`·`), `docs/architecture.md` (note `LiquidityRouter` as the wired `RateProvider`
and `PriceSource` as the seam a future DEX/aggregator implements), and
`docs/liquidity-routing.md` (the planned page — write it in the house style:
header/footer index link, `## Related`, prose on _why_: the static table was the
last Phase 1 stand-in, the router makes the table one source among many,
size-aware slippage now, swap execution stays Phase 4). Flip the
`liquidity-routing.md` row in `docs/README.md` from _(planned)_ to shipped. Run
`bun run check`. Commit:

`docs: document the liquidity router`

## Notes

- 2C is domain- and wiring-only: **no Drizzle table**, no migration, no network.
  The router prices; it posts nothing and signs nothing.
- Do not touch the clearing engine, `#lockPrice`, `#lockDeposit`, `lockRate`, or
  the `RateProvider` / `RateQuote` shapes. `LiquidityRouter` implements the
  existing port.
- Do not add on-chain swap execution; that is Phase 4.
- Do not add multi-hop routing across the registry's admitted stablecoins; that
  is a later extension. The `PriceSource` surface does not preclude it.
- `StaticRateProvider` stays in the package; only the wired default changes.
