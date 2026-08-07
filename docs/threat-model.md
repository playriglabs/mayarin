[← Documentation index](./README.md)

# Threat Model

Risks the design carries on purpose, and the ones it does not yet answer. A
risk belongs here when it survives the code — when no invariant, guard or test
removes it, so the only thing standing between it and a loss is a decision
someone has to make.

---

## Stablecoin depeg — **unguarded**

**The merchant is guaranteed an exact number in the settlement stablecoin, not
an exact number in rupiah.** That is the whole of the exposure, and it is a
direct consequence of the property that makes the contract path safe. `minOut`
is a hard lock denominated in the settlement asset; `PaymentRouter` reverts if
the fill misses it. Nothing anywhere re-checks what that settlement asset is
worth in the currency the merchant actually priced in.

Two distinct windows, and they are not the same problem.

**Between lock and fill** (seconds to minutes, bounded by the order
`deadline`). The fiat leg turns IDR into the settlement asset before the swap
leg is priced. For a pair the deployment declares `pegged` — `IDR/IDRX` — that
conversion is a decimal rescale, by construction, with **no price read at
all**: see `packages/core/quote/src/fx.ts`. This is correct arithmetic for a
peg that holds, and it is precisely why a broken peg is invisible here. There
is no rate to be stale, so `assertFresh` has nothing to check, and the
deviation guard (`packages/core/clearing/src/oracle.ts`) does not apply either
— it compares a venue price against an oracle reference, and this leg has an
oracle and no venue. The `fx.ts` comment states the boundary honestly:
_whether a stablecoin actually holds its peg is a judgement about an issuer,
not something this package can decide from an asset code._ True — and it means
nothing downstream makes that judgement either.

**After settlement** (unbounded). The merchant holds the stablecoin until they
move it. Mayarin has discharged its obligation at that point, so this is
inventory risk rather than clearing risk, but it is the merchant's exposure
created by Mayarin's choice of settlement asset, and the merchant did not pick
it.

### Why the existing guards do not cover it

| Guard                                           | What it checks                            | Why depeg escapes                                    |
| ----------------------------------------------- | ----------------------------------------- | ---------------------------------------------------- |
| Deviation guard (`oracle.ts`)                   | venue price against oracle reference      | the fiat leg has no venue price to compare           |
| `assertFresh`                                   | oracle observation age                    | a pegged pair reads no oracle at all                 |
| `minOut` hard revert (`PaymentRouter._execute`) | fill against the locked settlement amount | `minOut` _is_ denominated in the depegging asset     |
| Two-leg pricing                                 | FX leg and swap leg priced separately     | neither leg prices the settlement asset against fiat |

A depeg does not make any of these fail. It makes all of them succeed while
the merchant receives less value than they asked for.

### Open — not decided

- **Price the peg instead of assuming it.** Read the settlement stablecoin
  against its reference fiat and refuse to lock beyond a deviation threshold.
  This turns an unpriced rescale into a guarded read, at the cost of a network
  dependency on the one path that currently has none — and it makes a payment
  fail during exactly the market conditions where a merchant most wants to keep
  taking payments.
- **Where the threshold lives.** A deployment-wide constant is the simple
  answer. Per merchant is the honest one, since tolerance for holding a
  wobbling stablecoin is a merchant's business judgement, and that is the same
  seam as per-merchant settlement assets (#21).
- **Who absorbs a depeg inside the lock window.** Today: the merchant, silently.
  The alternatives are to fail the payment or for Mayarin to make up the
  difference — and the second reintroduces the treasury FX book that the hard
  revert exists to avoid. State the answer explicitly rather than inheriting one.
- **Issuer risk is not market risk.** A deviation threshold catches a wobble.
  It does not catch an issuer freezing an address or halting redemption. That
  is a stablecoin registry admission question (`docs/stablecoin.md`), not a
  pricing question.

Until one of these lands, this is a documented, accepted risk — not a covered
one. The merchant's guarantee is nominal in the stablecoin, and the docs should
not imply otherwise.

---

## Related

- [Stablecoin Registry](./stablecoin.md)
- [Liquidity & Routing](./liquidity-routing.md)
- [Clearing Engine](./clearing-engine.md)
- [Roadmap](./roadmap.md)

[← Documentation index](./README.md)
