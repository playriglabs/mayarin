[← Back to the documentation index](./README.md)

# Pitch Deck

The slide-by-slide spec for the Mayarin pitch. This file is the source of the
deck's text. The rendered deck at `mayarin.xyz/pitch-deck`
(`apps/landing/src/pages/pitch-deck/`) mirrors it slide for slide; when the copy
changes, change it here first. RFC #168 is the design record.

**Time box: 7 minutes.** Seven core slides, timed below to 6:20, leave 40
seconds of slack for the live wallet and chain. The 2:10 demo is part of slide
4, not an optional extra. Three backup slides sit after the core deck for
questions and are not presented.

The rendered deck carries a presenter timer for rehearsal and the stage: `T`
starts or pauses it, `R` resets it. It shows elapsed time against the plan
through the current slide and turns red when the pitch runs behind.

---

## Claim discipline

Every claim in this file carries one status: **Live**, **Provider-backed**,
**Next**, **Accepted risk**, or **Later**. The status shapes the words on the
slide. It never appears on the slide as a badge, an emoji, or the word
"shipped".

| Status          | How it reads on a slide                   |
| --------------- | ----------------------------------------- |
| Live            | Present tense, with the proof point       |
| Provider-backed | Present tense, names the provider         |
| Next            | "Next" or a phase name, never a promise   |
| Accepted risk   | Stated plainly on the risk slide          |
| On Roadmap      | "On Roadmap"; never on the traction slide |

Two hard rules:

- A number without a source does not go on a slide.
- The traction slide carries nothing that is not live today.

The status of every claim is recorded once, in the claim ledger (backup C) and
in the speaker notes below.

---

## Vocabulary for an international room

The first audience is a hackathon jury in Singapore. The deck frames Mayarin as
Southeast Asian infrastructure rather than an Indonesia-only product. Terms
that are specific to the live Indonesian proof get one plain phrase on first
use, and amounts use the international format:

| On the slide                                       | Not          | Why                                              |
| -------------------------------------------------- | ------------ | ------------------------------------------------ |
| `IDR 36,000` (about S$3)                           | `Rp 36.000`  | A dot reads as a decimal point outside Indonesia |
| coffee shop                                        | warung       | Everyone knows a coffee shop                     |
| Indonesian rupiah (IDR), first use                 | rupiah       | Names the currency and its code once             |
| Safe smart-account wallet, first use               | Safe         | "Safe" alone reads as an adjective               |
| a passkey (Face ID or Touch ID)                    | a passkey    | Says what the merchant actually does             |
| Base Sepolia, Base's public testnet                | Base Sepolia | Says it is a testnet, once                       |
| QRIS — Indonesia's national QR standard, like SGQR | QRIS         | Notes only; gives the Singapore counterpart      |

---

## Slide format

Each slide has four parts. **Headline** is the one sentence the audience keeps.
**Copy** is three to five bullets in pitch voice, with no code identifiers
unless the identifier is the point. **Visual** is what is on the slide besides
text. **Notes** carry the technical depth, the sources, and the claim status.

---

## Core deck

### 1 — Title · 0:20

**Headline:** Merchants can accept crypto without becoming crypto companies.

**Copy:**

- Price in local currency. Let customers pay with a supported crypto asset.
  Settle in the merchant's chosen stablecoin.

**Visual:** reversed wordmark over the hairline grid field (beams travelling
the grid lines), pronunciation _/maɪˈjɑːrɪn/_, `mayarin.xyz`. The headline and
the wordmark fade in; nothing else moves.

**Notes:** opening line: "Accepting crypto is easy. Settling it correctly is
hard." Name origin only if asked: Indonesian _bayar_ (to pay) + Latin _maior_
(greater), `docs/vision.md`.

### 2 — The settlement gap · 0:40

**Headline:** The customer holds any crypto assets. The price is in any local fiat currency. The merchant only
wants USDC.

**Copy:**

- The customer should not hunt for the one asset a merchant accepts.
- The merchant should not manage keys, exchange rates, swaps, gas, and
  reconciliation after every sale.
- A checkout is not complete when crypto arrives. It is complete when the
  merchant receives the correct settlement and can prove it.

**Visual:** four compact friction cards: merchant becomes a treasury desk;
customer holds the wrong token; developer rebuilds the payment state machine;
operations drift from chain truth.

**Notes:** keep this concrete. Do not define stablecoins or explain blockchain.
The mismatch between customer asset, store price, and merchant settlement is
the problem. Stablecoins are the rail, not the product.

### 3 — One clearing layer · 0:35

**Headline:** One clearing layer closes all three gaps.

**Copy:**

- The merchant prices in the currency they understand.
- The customer pays with a supported asset through a wallet or a plain transfer.
- Mayarin quotes, converts, settles, and records the payment; the merchant
  receives the stablecoin they selected.

**Visual:** three connected columns: merchant → Mayarin → customer. The merchant
side says local price and chosen settlement; Mayarin says quote, lock, convert,
settle, record; the customer side says supported crypto. A short boundary strip
says Mayarin is not an exchange, bank, fiat rail, or fiat off-ramp.

**Notes:** speaker line: "Mayarin is the merchant-grade clearing layer behind the
checkout." Provider names and architecture belong after proof or in Q&A.
Stable means a fiat-denominated unit, not risk-free: issuer, reserve,
redemption, and depeg risks remain and are stated in backup B.

Institutional evidence, all from primary sources:

- [Visa launched USDC settlement for US issuers and acquirers](https://corporate.visa.com/en/sites/visa-perspectives/newsroom/visa-launches-stablecoin-settlement-in-the-united-states.html)
  on 16 December 2025. Visa reported more than USD 3.5 billion in annualised
  stablecoin settlement volume as of 30 November 2025 and describes seven-day
  availability and programmable treasury operations.
- [DBS Token Services](https://www.dbs.com/newsroom/DBS_rolls_out_blockchain_powered_banking_for_institutions_with_DBS_Token_Services_marks_new_milestone_in_financial_services),
  announced 18 October 2024, integrates tokenisation and smart contracts with
  DBS transaction banking for instant, 24/7 real-time settlement.
- [MAS finalised Singapore's stablecoin regulatory framework](https://www.sgpc.gov.sg/api/file/getfile/Media%20Release_MAS%20Finalises%20Stablecoin%20Regulatory%20Framework.pdf?path=%2Fsgpcmedia%2Fmedia_releases%2Fmas%2Fpress_release%2FP-20230815-2%2Fattachment%2FMedia+Release_MAS+Finalises+Stablecoin+Regulatory+Framework.pdf)
  on 15 August 2023 for single-currency stablecoins pegged to SGD or a G10
  currency and issued in Singapore.
- [Open Standard announced Open USD](https://www.onepay.com/newsroom/introducing-open-usd)
  on 30 June 2026. Its announcement says more than 140 businesses signed up to
  use it; the official site says OUSD is pre-launch as of August 2026. Present
  this as directional evidence, never as live settlement volume.

These signals are context for Q&A, not part of the timed core deck. The live
demo on slide 4 validates Mayarin. `PURPOSE.md §2`, `docs/vision.md`.

### 4 — Live payment demo · 2:10

**Headline:** IDR 36,000 priced. Testnet ETH paid. USDC settled. Chain and
ledger agree.

**Copy:**

- A coffee shop in Jakarta creates a payment for IDR 36,000 — about S$3.
- Mayarin locks the quote and issues a per-payment address for testnet ETH.
- The payer transfers the exact amount; the watcher confirms and matches it.
- The executor calls `PaymentRouter`, swaps through Uniswap, and settles net
  USDC to the merchant-controlled wallet.
- The confirmed settlement event updates the ledger, dashboard, and webhook.

**Visual:** the deposit-path proof arrives one step at a time: customer transfer
→ deposit match → PaymentRouter and swap → merchant wallet → chain event,
balanced ledger, and webhook. It ends on two clearly labelled Basescan links:
`Payer transfer` and `Settlement`.

**Demo choreography:** begin on this slide, then switch to a prepared live IDR
36,000 checkout. Choose ETH, then scan the per-payment address into a pre-funded
phone wallet. While the chain confirms, keep the checkout's visible status
timeline on screen. Move to the merchant dashboard after it reaches paid; show
the clearing amounts, USDC settlement, webhook delivery, and the two proof
links. Return directly to slide 5. Keep a completed intent and a 45–60 second
recording ready; never wait silently.

**Notes:** **[DEMO MOMENT — HAND OVER TO CITRA]** Rizky introduces the IDR
36,000 example in one sentence, then Citra follows
`docs/hackathon-demo-runbook.md` and switches to the prepared checkout. This
proof is the **deposit path**, not the single-call contract path.
It consists of a payer transfer and a separate executor settlement, and the
executor holds the payer asset briefly between them. Say that plainly if asked.
The real Base Sepolia payment is from 2026-08-19, intent
`pi_01M0D8X65WSYV0T5FQRQVXV5M7`: payer transfer
[`0xe031f84f…`](https://sepolia.basescan.org/tx/0xe031f84f710834cbbf1516f0dfad12c543933da7772799795235e93d21b7525e),
settlement transaction
[`0x41a87c05…`](https://sepolia.basescan.org/tx/0x41a87c05e673ed17b80ef5009813b932db74e095d4cdfca2c5dfdda49bee83c1).
Payer sent 0.012953540 testnet ETH. Settlement output was 2.019586 testnet USDC;
fee was 0.012118 USDC and merchant net was 2.007468 USDC. Do not feature the ETH
amount: the Base Sepolia pool is execution proof, not a mainnet price market.
IDR 36,000 is about S$3 at roughly 12,000 IDR per SGD (August 2026). Base
Sepolia is Base's public testnet. `docs/liquidity-routing.md`,
`docs/architecture.md`, `docs/chain.md`. **[DEMO MOMENT — RETURN TO DECK, SLIDE
5]** Close with: "Correct amount, merchant control, and a provable outcome."

### 5 — The guarantees · 0:55

**Headline:** Correct amount. Merchant control. Provable outcome.

**Copy:**

- **Correct amount.** A signed settlement minimum and deadline bound the quote;
  `PaymentRouter` hard-reverts below the lock.
- **Merchant control.** Settlement can only reach an admitted merchant wallet;
  the primary contract path receives, swaps, and settles atomically with zero
  resting balance.
- **Provable outcome.** Confirmed chain events produce balanced double-entry
  postings, reconciliation, and signed merchant webhooks.

**Visual:** three proof tiles, one per guarantee. The words that matter — hard
revert, merchant wallet, and `MATCHED` — are the accent anchors.

**Notes:** do not let the atomic contract-path guarantee rewrite the deposit-path
demo. Both paths are live and converge on the same clearing and accounting
model; only the contract path is single-call and non-custodial throughout. The
deposit path's brief operator custody is stated in backup B. `WalletGuard`
accepts audited external payout instructions, verifies managed-wallet fallbacks,
and refuses unsafe treasury overlap. Money is exact integer minor units; an
unbalanced posting throws. Every clearing step is idempotent and resumable.
`docs/chain.md`, `docs/wallet.md`, `docs/money.md`, `docs/ledger.md`.

### 6 — Who Mayarin is for · 1:00

**Headline:** Merchant platforms first. Payment infrastructure next.

**Copy:**

- **Primary users.** Merchant platforms and marketplaces that price locally and
  settle in stablecoins.
- **Expansion path.** Payment processors, wallets, and stablecoin platforms
  first; creators, freelancers, and agencies next.
- **Our goal.** A controlled Southeast Asian merchant pilot measured by
  settlement reliability, reconciliation, and integration speed.

**Visual:** three progressive audience columns: `Start here · merchant
platforms`, `Expand through · payment infrastructure`, and `Serve next ·
cross-border sellers`. Each carries one matching outline glyph — storefront,
routing network, and cross-border invoice — in the deck's accent green. All
audience and goal headings use the sans family. A full-width, vertically stacked
goal strip closes on `Controlled merchant pilot` and the three measures:
reliability, reconciliation, integration speed.

**Notes:** this slide narrows the landing page's eight use cases into a focused
beachhead and expansion path; it does not claim every use case is already
integrated. Merchant platforms and marketplaces are the primary design-partner
target. Payment processors, wallets, and stablecoin platforms are distribution
partners; creators, freelancers, and agencies are the next self-serve audience.
The controlled pilot is the next evidence, not a live traction claim.
`apps/landing/src/sections/use-cases.tsx`, `docs/roadmap.md`.

### 7 — Team and the ask · 0:40

**Headline:** Built end to end by a small team. Ready for a controlled merchant
pilot.

**Copy:**

- **Rizky — R&D and Core Contributor.** Ex-Kite.
- **Rizki Citra — Core Contributor.** Software Engineer at Kolosal AI.
- **Ask.** Design-partner merchants, ecosystem partners, and rigorous custody
  review.

**Visual:** two compact monochrome team profiles above the closing outcome:
`Price locally. Pay globally. Settle predictably.` The final line is
`Next · controlled mainnet pilot`.

**Notes:** introduce the people once; do not read employer history or profile
links aloud. Close on the ask. Compliance is cheap, not absent: disabled
screening reports `NOT_SCREENED`, never `CLEAR`; reconciliation reports
`MATCHED`, `MISMATCHED`, or `NO_ON_CHAIN_RECORD`. Agent Pay remains later until
the identity, limits, approval, and revocation controls in `PURPOSE.md §21` are
implemented.

---

## Backup slides

### A — System architecture

**Headline:** One orchestration layer. Two execution paths. One settlement
outcome.

**Copy:** none. Let the architecture carry the answer.

**Visual:** merchant intent and customer asset choice enter the Mayarin API.
The API coordinates the quote engine and two live execution paths: an atomic
`PaymentRouter` path, or a watched transfer that enters the same idempotent,
resumable clearing engine. Clearing produces balanced ledger entries before the
merchant's stablecoin settlement is complete.

**Notes:** use only for technical or architecture questions; it is not part of
the timed seven-slide pitch. The primary contract path performs atomic swap and
settlement. The deposit path watches and matches a plain transfer before the
executor sweeps it through `PaymentRouter`. Both converge on the same clearing,
accounting, and reconciliation model. `docs/architecture.md`, `docs/chain.md`,
`docs/clearing-engine.md`.

### B — Risks we carry

**Headline:** What we guarantee, and what we do not.

**Copy:**

- We guarantee an amount of the settlement stablecoin, not its fiat value
  after a depeg.
- On the deposit path, our executor holds payer funds briefly while sweeping.
  The contract path avoids this.
- Signing keys, oracles, DEX liquidity, RPCs, and issuers are external
  dependencies. We bound them; we do not remove them.
- The deposit forwarder passed static analysis but has not had an adversarial
  review. Mainnet hardening is a defined programme.

**Visual:** two columns — "bounded by design" and "accepted for now".

**Notes:** `docs/threat-model.md`, `PURPOSE.md §19`. Depeg guard is RFC #71.
Key compromise is reduced by KMS/Turnkey signing, timelocked rotation, multisig
governance, router pause, Safe allowlists. Mainnet hardening is RFC #143.
Investors read this slide as a maturity signal.

### C — Claim ledger

| Claim                                             | Status          | Source                       |
| ------------------------------------------------- | --------------- | ---------------------------- |
| Atomic receive → swap → settle in one transaction | Live            | `docs/chain.md`              |
| Contract holds no balance between payments        | Live            | `docs/chain.md`              |
| Both execution paths settle on Base Sepolia       | Live            | `docs/chain.md`              |
| Merchant always a signer on their Safe            | Live            | `docs/wallet.md`             |
| Payouts only to verified merchant wallets         | Live            | `docs/wallet.md`             |
| Passkey key that Mayarin cannot use               | Provider-backed | `docs/wallet.md`             |
| Oracles, DEX venues, wallet provider behind ports | Provider-backed | `docs/architecture.md`       |
| Exact money, no floats                            | Live            | `docs/money.md`              |
| Double-entry ledger reconciled against the chain  | Live            | `docs/ledger.md`, compliance |
| Commerce surface, dashboard, SDK, webhooks, SSE   | Live            | `docs/roadmap.md`            |
| WooCommerce plugin, embeddable checkout           | Live            | `docs/woocommerce.md`, embed |
| On-chain fee and refund split policy              | Next (#12)      | `docs/roadmap.md`            |
| Gas-free merchant withdrawal                      | Next (#9)       | `docs/roadmap.md`            |
| Passkey browser ceremony in the dashboard         | Next            | `docs/roadmap.md`            |
| More assets, venues, EVM chains, Solana, TRON     | Next (Phase 5)  | `docs/roadmap.md`            |
| Cross-chain settlement                            | Later           | `docs/roadmap.md`            |
| Fiat off-ramp                                     | Later           | `docs/roadmap.md`            |
| Agent Pay                                         | Later           | `PURPOSE.md §21`             |
| Stablecoin depeg                                  | Accepted risk   | `docs/threat-model.md`       |
| Deposit-path operator custody                     | Accepted risk   | `docs/threat-model.md`       |
| Deposit forwarder without adversarial review      | Accepted risk   | RFC #143                     |

Base Sepolia (`docs/chain.md`): `PaymentRouter`
`0xEe7c5B5a9eeAf667A6EFb217A8a77534C873f7a9`, `TimelockController`
`0x0c006FC14063e3F78271312B975231e4BD6e8B00`, `DepositForwarderFactory`
`0x598F64551456BCa2536386ED54A24412E3e32fCe`.

---

## Audience framing

| Audience            | Lead with                                                 | Trim                                   |
| ------------------- | --------------------------------------------------------- | -------------------------------------- |
| **Hackathon judge** | 4, 5, 6 — live payment, guarantees, working product.      | Keep team and problem to their clocks. |
| **Investor**        | 3, 6, 7 — beachhead, distribution, model, pilot ask.      | Keep 4 to the outcome and proof link.  |
| **Technical judge** | 4, 5, backup A/B — execution, architecture, threat model. | Keep 1–3 to one breath each.           |

---

## Related

- [Vision & Rationale](./vision.md)
- [Architecture](./architecture.md)
- [Roadmap](./roadmap.md)
- [Threat Model](./threat-model.md)
- [Chain Layer](./chain.md)
