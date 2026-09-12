# ETHOnline 2026 — Uniswap

**Project:** Mayarin — a programmable clearing layer for humans, applications and
autonomous agents. **Pool:** Continuity. **Repository:**
<https://github.com/playriglabs/mayarin>

## What Uniswap is used for

**Cross-asset x402.** An agent holding EURC pays a merchant who settles in USDC,
in one signature, and the merchant receives the invoice amount exactly — not
approximately, and never less.

That "exactly" is the whole design. The swap is priced **backwards from the
invoice**: the quote engine asks for an exact-output quote at the merchant's
settlement amount, and the `402` the agent receives states what it must sign to
produce that output. Pricing forwards would hand the merchant whatever the pool
returned and ask somebody to absorb the difference.

## Measured on chain

**Base Sepolia, block `46451061`.** Authorization
[`0x254b93ce…`](https://sepolia.basescan.org/tx/0x254b93cec1a73279e12968938c1c491133c5556b4adb9e71cea070e0abc8affa)
moved 28351 EURC from the payer to the operator; swap
[`0xb1436735…`](https://sepolia.basescan.org/tx/0xb143673599a6b05cd95676f0bbec7ffc35f9f99563bf45c6f26468944eb38a07)
spent 28208 of it and delivered **exactly 20000 USDC** to the merchant. The 143
EURC the pool did not need was accounted for as the payer's change. Intent
`COMPLETED`, clearing `SUCCESS`, fee zero, treasury netting to zero.

**Arc testnet, 6 September, paid by a Circle agent wallet.** Authorization
[`0xf08c141d…`](https://testnet.arcscan.app/tx/0xf08c141d2c11de1ac9abc3ca1b4da201bce901250148bd4436b86b421638beba)
and swap
[`0x9f4bf25b…`](https://testnet.arcscan.app/tx/0x9f4bf25b74fe3cb18087ff4e93eff22b530b48f2e7a41fbd064280f3abfc1e52):
the agent signs **2.046810 EURC**, the merchant is paid **exactly 1.000000 USDC**,
and **0.010236 EURC is the payer's change** — above the dust threshold, so this is
the run where the change is genuinely owed back. Intent
`pi_01M1VAPDVMSSNWGZXE1YFWS4A0` `COMPLETED`, clearing
`clr_01M1VAPDW4PAAVG7XV71Q6P9WT` `SUCCESS`. Evidence:
[`docs/evidence/arc-x402-circle-cross-asset-208.json`](../evidence/arc-x402-circle-cross-asset-208.json).

One payment, three sponsors: an agent wallet on Arc, a rail chosen from The Graph,
and a Uniswap execution in the middle.

The repeatable form is one command:

```bash
bun run scripts/e2e-x402.ts --pay-with EURC
```

## The four decisions worth reading

**Exact-output reached the port as a second method, not a flag.**
`quoteExactOutput` sits beside `quote` on `SwapVenue`; every venue implements it or
refuses it, and `QuoteEngine.#swapLeg` prices at the settlement amount rather than
probing with one unit. LiFi refuses exact-output. 0x turned out to be able to serve
it, so it does.

**The `402` refuses to name the merchant as `payTo` on a cross-asset rail.** The
payer's asset has to land somewhere swappable; paying the merchant directly would
settle a USDC invoice in EURC. `register` enforces that the recipient is the
operator, so the rule cannot be configured away.

**A swap has no nonce, so the hash is durable before anything is trusted.**
`CrossAssetSettler` plans before the payer's money moves, sends, persists the hash,
then confirms. A payment interrupted between its two chain movements resumes off
the `settlement.swap` event: with it the swap has gone out and only needs
confirming, without it the swap still has to be sent. **The authorization is
confirmed first in both branches** — a resume has no facilitator response in front
of it saying the payer's asset landed, and swapping for one that did not would
spend the operator's own balance.

**The change is the payer's, and is posted as a liability.** Surplus goes to
`PAYER_SURPLUS` through a balanced entry — never absorbed, and a liability rather
than an FX result, because it is somebody else's money. Above one cent of a
stablecoin it stays a liability and the receipt event records the address it is
owed to; at or below, returning it costs more than it is worth, so it is taken as
`FEE_REVENUE` and the event says `dust`. A threshold is declared only for assets an
`exact` authorization can be signed in — **an asset with no declared threshold
keeps every amount**, because keeping somebody's money is a decision and silence is
not one.

## Pre-existing, and built in the window

**Pre-existing — merged before the window opened on 4 September 2026.** The
`SwapVenue` port and its Uniswap V3, Uniswap V2, 0x and LiFi adapters; the quote
engine, the liquidity router and the `PriceSource` seam; oracle guards; the
clearing engine and ledger; the commerce surfaces, dashboard, SDK and docs
(Phases 1–3). The x402 protocol spine (#220–#230) merged on 3 September, the day
before the window opened, and is listed here rather than claimed for the event.

**Built during the window, 4–13 September 2026** — under
[#211](https://github.com/playriglabs/mayarin/issues/211) and
[#244](https://github.com/playriglabs/mayarin/issues/244):

| What                                                                 | Where                                            |
| -------------------------------------------------------------------- | ------------------------------------------------ |
| `quoteExactOutput` on the port, and pricing at the settlement amount | `packages/core/quote/`, each venue package       |
| Chain-aware venue selection, including the Arc `uniswap-v2` route    | `packages/providers/swap-uniswap-v2/`            |
| The cross-asset `402`, priced backwards, and the `payTo` refusal     | `packages/core/x402/`                            |
| `CrossAssetSettler` and its EVM adapter                              | `packages/core/x402/`, `packages/providers/evm/` |
| `PAYER_SURPLUS`, the dust policy and the receipt disposition         | `packages/core/ledger/src/accounts.ts`           |
| Resume between the two chain movements (`recoverBroadcasts`)         | `packages/core/x402/`                            |

## Stated plainly: what is not done

- **The refund transaction is not sent.** The threshold is set and the payee's
  address is on the receipt event, so above dust the change is a liability with an
  address attached — but no transaction returns it yet. That is a broadcast with
  its own nonce, resume and idempotency story rather than a posting, and it did not
  make the window.
- **The Arc venue is a V2 fork** (`osr21/arc-swap`), because the V3 adapter has no
  pool on Arc testnet. Base Sepolia runs the V3 path.
- **The testnet pool priced 1 USD at 2.05 EURC**, roughly 2.2× real FX. That is the
  testnet pool rather than a pricing bug, and it is why `QUOTE_DEVIATION_BPS=9900`
  is deliberately loose here. It must be tightened before anything points at
  mainnet.

## Developer feedback

[`FEEDBACK.md`](../../FEEDBACK.md) at the repository root is the written feedback
on building against Uniswap, submitted separately through the Developer Feedback
Form.
