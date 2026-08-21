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

---

## Claim discipline

Every claim in this file carries one status: **Live**, **Provider-backed**,
**Next**, **Accepted risk**, or **Later**. The status shapes the words on the
slide. It never appears on the slide as a badge, an emoji, or the word
"shipped".

| Status          | How it reads on a slide                 |
| --------------- | --------------------------------------- |
| Live            | Present tense, with the proof point     |
| Provider-backed | Present tense, names the provider       |
| Next            | "Next" or a phase name, never a promise |
| Accepted risk   | Stated plainly on the risk slide        |
| Later           | "Later"; never on the traction slide    |

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

**Headline:** Price in fiat. Settle in stablecoins. Pay with anything.

**Copy:**

- A merchant prices in local currency. A customer pays with a supported crypto
  asset. The merchant receives their chosen stablecoin.

**Visual:** reversed wordmark over the hairline grid field (beams travelling
the grid lines), pronunciation _/maɪˈjɑːrɪn/_, `mayarin.xyz`. The headline and
the wordmark fade in; nothing else moves.

**Notes:** one breath. Name origin if asked: Indonesian _bayar_ (to pay) +
Latin _maior_ (greater), `docs/vision.md`.

### 2 — The team · 0:30

**Headline:** A small team built the payment stack end to end.

**Copy:**

- **Rizky — R&D and Core Contributor.** Ex-Kite.
- **Rizki Citra — Core Contributor.** Software Engineer at Kolosal AI.

**Visual:** two equal monochrome portraits. The role leads, current or previous
experience supports it, and neither profile becomes a biography. Each card
closes with two compact verification links: the LinkedIn logo precedes the
profile handle, and a globe icon precedes the personal domain.

- Rizky — [LinkedIn /mrizkyy](https://www.linkedin.com/in/mrizkyy/) ·
  [rizzky.xyz](https://rizzky.xyz)
- Rizki Citra — [LinkedIn /rimzzlabs](https://www.linkedin.com/in/rimzzlabs/) ·
  [rimzzlabs.com](https://rimzzlabs.com)

**Notes:** introduce the people once, then let the working product demonstrate
execution. Do not spend time on a chronology of employers or read the profile
links aloud; they are there for verification and post-pitch follow-up.

### 3 — Why stablecoins, why Mayarin · 0:45

**Headline:** Stablecoins solve settlement. Mayarin solves acceptance.

**Copy:**

- A merchant needs a fiat-denominated settlement asset — not the volatility of
  whichever token a customer happens to hold.
- Stablecoins provide an on-chain unit that is always available, programmable,
  and auditable against the ledger.
- **Why now.** Payment networks, banks, and regulators are moving the rail from
  pilots toward production.

**Visual:** an engineering-style settlement thesis, not a logo wall. Three
system properties — stable unit, always on, programmable — sit above a compact
institutional signal strip: Visa / USDC settlement / 2025; DBS / Token Services
/ 2024; Singapore / stablecoin framework / 2023; Open USD (OUSD) / 140+ signed
up pre-launch. Every signal is a one-click link to its primary source; the
external-link icon makes verification discoverable without turning the slide
into a bibliography.

**Notes:** the speaker line is: "Stablecoins are not the product; they are the
settlement rail. Mayarin makes the rail usable at checkout." Stable means a
fiat-denominated unit, not risk-free: issuer, reserve, redemption, and depeg
risks remain and are stated in backup B.

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

These signals validate the rail, not Mayarin. The live demo on slide 4 validates
Mayarin. `PURPOSE.md §2`, `docs/vision.md`.

### 4 — Live payment demo · 2:10

**Headline:** IDR 36,000 priced. ETH paid. USDC received. One auditable
transaction.

**Copy:**

- A coffee shop in Jakarta creates a payment for IDR 36,000 — about S$3.
- Mayarin quotes and locks the price with a time and slippage bound.
- The customer pays ETH from a supported wallet; the live testnet quote is shown
  in checkout.
- The contract swaps ETH to USDC and delivers the net settlement directly to a
  merchant-controlled wallet in the same transaction.
- Ledger, dashboard, and webhooks update from the confirmed on-chain event.

**Visual:** the five-step flow — payer → PaymentRouter → atomic swap → merchant
wallet → indexed event → ledger — arriving one step at a time over the wave
plane (money in motion). Ends on the Basescan link of the settlement
transaction.

**Demo choreography:** start on the storefront with the wallet already connected
and funded. Open the IDR checkout, choose ETH, confirm once, then move to the
merchant dashboard. Show paid status, the USDC settlement, and the verified
transaction. Keep a completed intent and a 45–60 second recording ready; never
wait silently for confirmation.

**Notes:** the proof transaction is a real Base Sepolia payment on 2026-08-19,
intent `pi_01M0D8X65WSYV0T5FQRQVXV5M7`: payer transaction
[`0xe031f84f…`](https://sepolia.basescan.org/tx/0xe031f84f710834cbbf1516f0dfad12c543933da7772799795235e93d21b7525e),
settlement transaction
[`0x41a87c05…`](https://sepolia.basescan.org/tx/0x41a87c05e673ed17b80ef5009813b932db74e095d4cdfca2c5dfdda49bee83c1).
Payer sent 0.012953540 testnet ETH. Settlement 2.019586 testnet USDC, fee
0.012118 USDC, merchant net 2.007468 USDC. Do not speak or feature the ETH
amount: the testnet pool is the price truth and does not track the economic
value of mainnet ETH. IDR 36,000 is about S$3 at roughly 12,000 IDR per
SGD (August 2026). Indonesia writes the amount `Rp 36.000` — dot for thousands —
and the product renders it that way; the slide uses `IDR 36,000` for an
international room. Base Sepolia is Base's public testnet (Base is Coinbase's
Ethereum layer 2). The testnet Uniswap pool is the price truth, so the ETH
amount does not track mainnet prices (`docs/liquidity-routing.md`). The twelve-step flow is in
`PURPOSE.md §7`. Two execution paths are live: contract path (payer →
`PaymentRouter` → atomic swap → merchant Safe) and deposit path (per-payment
deposit address → watcher → executor → `PaymentRouter`), `docs/architecture.md`,
`docs/chain.md`. Every domain module talks to storage, chains, and providers
through ports. The backend orchestrates; the contract executes; the backend
never holds keys to user assets. Live.

### 5 — Why Mayarin · 0:55

**Headline:** Payment-gateway simplicity, without surrendering control.

**Copy:**

- **One transaction, no custody.** Receive, swap, settle in a single call. Hard
  revert if the swap misses the locked minimum. The contract holds no balance
  between payments.
- **Merchant-controlled.** The merchant is always a signer on their Safe
  smart-account wallet and has an independently proven recovery path. Payouts
  can only reach a verified merchant wallet.
- **Provider-agnostic by construction.** Wallets, liquidity venues, oracles,
  and chains sit behind ports. Swap the source, keep the product.
- **Ledger derived from chain truth.** Balanced double-entry postings,
  reconciled against on-chain events. Every step idempotent and resumable.

**Visual:** four tiles; the first animates the atomic call.

**Notes:** all four are live on Base Sepolia. `PaymentRouter` reverts on a
`minOut` miss and keeps a zero resting balance (`docs/chain.md`). `WalletGuard`
refuses a payout to an unverified wallet; a deployment whose `TREASURY_ADDRESS`
is a merchant wallet does not boot (`docs/wallet.md`, `docs/roadmap.md`). Money
is `bigint` minor units plus `AssetCode`; no float touches a payment
(`docs/money.md`). `LedgerImbalanceError` rejects an unbalanced posting
(`docs/ledger.md`). Steps are keyed `${transactionId}:${state}`;
`ClearingEngine.resumeStuck` recovers stalled payments
(`docs/clearing-engine.md`). A webhook wakes the engine and never settles a
payment by itself. The custody boundary for the passkey key rests on Turnkey's
authorization model — provider-backed (`docs/wallet.md`).

### 6 — From product to pilot · 1:00

**Headline:** Built today. Ready for a controlled merchant pilot.

**Copy:**

- **Working proof.** Three verified Base Sepolia contracts and both execution
  paths settling end to end.
- **Distribution already built.** Payment links and printable QR for zero-code
  adoption; hosted and embedded checkout, SDK, API, and WooCommerce for
  developers and merchants.
- **Regional beachhead.** Merchants across Singapore, Malaysia, and Indonesia
  share one need: local pricing with stablecoin settlement. The next evidence
  milestone is a controlled pilot with design-partner merchants.
- **Business model.** A take rate from settlement. The contract fee primitive is
  live; merchant pricing and policy are completed before the pilot.

**Visual:** three surfaces — buyer, merchant, developer — followed by a Base
Sepolia verification panel. Each compact address links directly to Basescan:

- `PaymentRouter` — `0xEe7c5B5a…C873f7a9`
- `TimelockController` — `0x0c006FC1…BD6e8B00`
- `DepositForwarderFactory` — `0x598F6455…E3e32fCe`

The panel closes with `Both execution paths settle end to end` and `Next:
controlled merchant pilot`.

**Notes:** `docs/roadmap.md`. Phases 1–3 and the commerce surfaces are working.
IDR and MYR pricing are proven in the catalog; SGD exists in the core asset
registry. The only public transaction featured in the deck is the IDR proof, so
do not imply a live SGD catalog payment. The contract rows are verification
actions, not decoration: invite the jury to open one during questions. Items
still next are the passkey browser ceremony, fee/refund policy, general gas
abstraction, and mainnet hardening; do not describe those as complete.
Multi-chain expansion belongs in Q&A, after evidence of the beachhead.

### 7 — Impact and the ask · 0:40

**Headline:** One working transaction. A new rail for commerce.

**Copy:**

- **Proven:** fiat pricing → crypto payment → stablecoin settlement, reconciled
  on Base Sepolia.
- **Next:** a controlled mainnet pilot with design-partner merchants.
- **Ask:** merchant and ecosystem partners — plus rigorous custody review.

**Visual:** no paragraph. A short outcome lockup — `Price locally. Pay globally.
Settle predictably.` — over the three-step equation `SGD/MYR/IDR → supported
crypto → stablecoin`. One supporting line says the payment lands in a
merchant-controlled wallet. Close on `Next: controlled mainnet pilot`.

**Notes:** compliance is cheap, not absent — screening port with a disabled
default (`NOT_SCREENED`, never `CLEAR`); reconciliation states `MATCHED` /
`MISMATCHED` / `NO_ON_CHAIN_RECORD` (`docs/compliance.md`). Hackathon
alignment: Track 1 (Payments and Financial Infrastructure) and Track 2 (Web3
Applications and AI), `docs/roadmap.md`. Before the pilot: finish fee/refund
policy (#12), gas abstraction (#9), and mainnet hardening (#143).
Machine-commerce positioning is later.

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
| **Hackathon judge** | 4, 5, 6 — live payment, atomic settlement, working proof. | Keep team and problem to their clocks. |
| **Investor**        | 3, 6, 7 — beachhead, distribution, model, pilot ask.      | Keep 4 to the outcome and proof link.  |
| **Technical judge** | 4, 5, backup A/B — execution, architecture, threat model. | Keep 1–3 to one breath each.           |

---

## Related

- [Vision & Rationale](./vision.md)
- [Architecture](./architecture.md)
- [Roadmap](./roadmap.md)
- [Threat Model](./threat-model.md)
- [Chain Layer](./chain.md)
