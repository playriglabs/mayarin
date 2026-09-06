# Developer feedback — Uniswap

Notes taken while building cross-asset payments on Uniswap v3, for the
[Uniswap Foundation tracks at ETHOnline 2026](https://ethglobal.com/events/ethonline2026/prizes).
Everything here was hit in this repository, not read in a docs page, and every
number was measured on Base Sepolia rather than estimated.

What we built: an autonomous agent signs **one** EIP-3009 authorization in an
asset it holds, and the merchant is paid the exact amount they invoiced in the
asset they settle in. `exactOutputSingle` is what makes that sentence true —
the merchant's number is the fixed one, and the payer's is derived from it.

Where to read the code is at the bottom.

---

## 1. `quoteExactOutputSingle` is `nonpayable`, and every caller has to know why

QuoterV2 declares both quote functions as state-mutating. They mutate no
committed state — the revert-and-decode trick is internal — but the ABI says
`nonpayable`, so a typed client generates a _write_ and refuses to read it.

Our ABI declares it `view` locally so viem routes it through `eth_call`:

```ts
// QuoterV2 declares the function nonpayable, but it mutates no committed
// state — declaring it `view` here routes the read through `eth_call`, the
// standard way to consume the quoter off-chain.
```

This is folklore. It is the first thing every integrator does and it is not in
the quoter's own documentation page. One sentence there — _"declare these
`view` in your ABI; they are simulated, never sent"_ — would save every team
the same twenty minutes. **The docs should say it, or QuoterV2 should ship an
ABI that says it.**

## 2. The two directions do not name their fields symmetrically

```solidity
struct QuoteExactInputSingleParams  { address tokenIn; address tokenOut; uint256 amountIn; uint24 fee; uint160 sqrtPriceLimitX96; }
struct QuoteExactOutputSingleParams { address tokenIn; address tokenOut; uint256 amount;   uint24 fee; uint160 sqrtPriceLimitX96; }
```

Exact-input calls the amount `amountIn`. Exact-output calls it `amount`, and it
means `amountOut`. Two structs that differ in one field's _name_ and that
field's _meaning_, while their token fields keep the same names, is a shape
where a copy-paste compiles, runs, returns a plausible number, and prices the
wrong side of the trade. A struct named `amountOut` would be free and would
make the mistake impossible.

`SwapRouter02.exactOutputSingle` gets this right — `amountOut` and
`amountInMaximum` — which makes the quoter's naming look like an oversight
rather than a convention.

## 3. `sqrtPriceLimitX96: 0` means "no limit", and nothing says so

Zero is not a price. It reads as "limit the price to zero", and a careful
integrator will not pass it without evidence. We pass `0` in both the quote and
the swap, and the reasoning had to be reconstructed from the pool contract
rather than read:

```ts
// No price limit: `amountInMaximum` already bounds the payer's spend,
```

For an exact-output swap the _real_ bound is `amountInMaximum`, and
`sqrtPriceLimitX96` is a second, redundant one. Saying that outright — **"for
exact-output, bound the trade with `amountInMaximum`; pass `0` here unless you
specifically want a price ceiling"** — would answer the question the parameter
raises.

## 4. `SwapRouter02` silently dropped `deadline`

`ISwapRouter.exactOutputSingle` takes `deadline`. `SwapRouter02`'s does not.
Both are called `exactOutputSingle`, both are "the Uniswap v3 router", and the
struct with the extra field simply reverts against the deployment without it.

We hit this and recorded it in the code:

```ts
// `SwapRouter02` dropped the `deadline` field its predecessor carried
```

The deployments page lists an address per chain. It does not say **which
router** is at that address, and the two have incompatible ABIs for
identically-named functions. Naming the contract version beside the address
would remove an entire class of failure.

## 5. What `exactOutputSingle` does with the unspent input decides your architecture

An exact-output swap consumes _at most_ `amountInMaximum`, and typically less.
`SwapRouter02` leaves the difference **with the caller** — it does not return it
to whoever funded the trade.

That single behaviour forced a design decision two layers up. Our contract path
has a router that measures its own balance delta and returns the residue to the
payer inside the same transaction. Our agent path cannot: `SwapRouter02` is
called by us on the payer's behalf, so the change lands in our account and has
to be booked as a liability owed back to them (`PAYER_SURPLUS` in our chart of
accounts).

This is the most consequential fact in the whole integration and it appears
nowhere in the exact-output documentation. **A sentence saying where the
unspent input ends up would be worth more than any other change on this list.**

## 6. A one-unit probe is not a price on a thin pool — measured

This is the finding the whole feature exists for, and it is worth writing down
with numbers.

The Base Sepolia EURC/USDC pool at the 0.05% tier, on 6 September 2026:

| Question                                                            | Answer                                             |
| ------------------------------------------------------------------- | -------------------------------------------------- |
| What does **one** EURC buy? (exact-input probe)                     | ~0.818 USDC                                        |
| What does delivering **exactly 0.020000 USDC** cost? (exact-output) | 0.028351 EURC — an implied **0.707** USDC per EURC |
| Real-world EUR/USD that day                                         | ~1.08                                              |

Pricing forwards and scaling up would have asked the payer for ~24,500 EURC for
a swap that needed 28,208. Under `exact`, the payer signs **once** and cannot be
asked for more — so that payment does not fail gracefully, it fails after their
money has already moved. We have the earlier incident in this repository: a
`minOut` derived from a one-unit probe reverted `STF` after the payer had paid
and their deposit had been swept.

Exact-output is not an optimisation here. It is the difference between a
correct payment and a lost one, and **the docs frame it as a convenience** —
"specify the output amount you want" — rather than as the correctness property
it is for anyone building an invoice.

## 7. "CCA" appears in the prize text and cannot be looked up

The ETHOnline prize description names CCA as a component of the Uniswap stack.
We could not identify it from public documentation, the developer docs, or the
contracts repository. If it is a scored component, teams cannot target it. A
link in the prize text would fix this.

---

## What actually ran

An agent with no account and no API key paid a gated endpoint, holding EURC
while the merchant settles USDC. Base Sepolia, block `46451061`:

```
authorization  0x254b93ce…   payer    → operator     28351 EURC
swap           0xb1436735…   operator → pool         28208 EURC
                             pool     → merchant     20000 USDC
surplus                      143 EURC, booked to the payer
```

The merchant received exactly their invoice. The payer was charged exactly what
they signed for. The 143 EURC the pool did not need is recorded as owed back to
them rather than absorbed.

## Where to read the code

| What                                               | File                                                                  |
| -------------------------------------------------- | --------------------------------------------------------------------- |
| The exact-output quote against QuoterV2            | `packages/providers/swap-uniswap/src/adapter.ts` — `quoteExactOutput` |
| The rate arithmetic, pure and BigInt-only          | `packages/providers/swap-uniswap/src/quoter.ts` — `scaleSwapRate`     |
| Encoding `exactOutputSingle` for `SwapRouter02`    | `packages/providers/swap-uniswap/src/route.ts`                        |
| The port both directions satisfy                   | `packages/core/execution/src/venue.ts`                                |
| Where the invoice becomes the payer's amount       | `packages/core/quote/src/engine.ts` — `#swapLeg`                      |
| Approve, swap, read the receipt back               | `packages/providers/evm/src/cross-asset-settler.ts`                   |
| The payer's change, as a liability                 | `packages/core/ledger/src/accounts.ts` — `PAYER_SURPLUS`              |
| The end-to-end run that produced the numbers above | `scripts/e2e-x402.ts`                                                 |
