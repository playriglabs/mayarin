[← Back to the documentation index](./README.md)

# Pitch Deck

The slide-by-slide spec for the Mayarin pitch. This file is the source of the
deck's text. The rendered deck at `mayarin.xyz/pitch-deck`
(`apps/landing/src/pages/pitch-deck/`) mirrors it slide for slide; when the copy
changes, change it here first. RFC #168 is the design record.

**Time box: 7 minutes.** Eight core slides, timed below to 6:40, leave 20
seconds of slack. Two backup slides sit after the core deck for questions and
are not presented.

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

The status of every claim is recorded once, in the claim ledger (backup B) and
in the speaker notes below.

---

## Vocabulary for an international room

The first audience is a hackathon jury in Singapore. Terms that are everyday in
Indonesia get one plain phrase on first use, and amounts use the international
format:

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

- Mayarin — programmable crypto-commerce infrastructure.
- Merchants price in their currency and receive a stablecoin.
- Customers pay with any supported crypto asset.

**Visual:** reversed wordmark over the hairline grid field (beams travelling
the grid lines), pronunciation _/maɪˈjɑːrɪn/_, `mayarin.xyz`. The headline and
the wordmark fade in; nothing else moves.

**Notes:** one breath. Name origin if asked: Indonesian _bayar_ (to pay) +
Latin _maior_ (greater), `docs/vision.md`.

### 2 — The problem · 0:50

**Headline:** Accepting crypto today turns a merchant into a treasury desk.

**Copy:**

- Merchants must run keys, wallets, swaps, gas, and reconciliation — or bolt
  crypto onto a fiat gateway and reconcile by hand.
- Customers rarely hold the exact token a merchant wants, and wallet UIs are not
  built for invoices.
- Developers rebuild the same payment state machine on fragmented APIs, wallets,
  DEXs, and chains.
- Backends become custodians by accident, and ledgers drift from what the chain
  says.

**Visual:** four friction cards — merchant, customer, developer, infrastructure.

**Notes:** `PURPOSE.md §2`, `docs/vision.md`. Framing line for the speaker:
"Crypto adoption does not require merchants to become crypto operators."

### 3 — What Mayarin is · 0:50

**Headline:** Pricing, quoting, execution, settlement, and accounting — as
infrastructure, not the merchant's job.

**Copy:**

- The merchant prices in local fiat and picks a settlement stablecoin.
- The customer pays in any supported asset.
- Mayarin quotes, locks the price, converts on-chain in one atomic step when
  assets differ, settles, and records.
- One API and one SDK. Storefronts, POS, invoices, and embedded checkout build
  on top.

**Visual:** three columns — merchant, Mayarin, customer — with a "what we are
not" strip underneath: not an exchange, not a custodial wallet, not a bank or
fiat rail, no fiat off-ramp in the MVP.

**Notes:** the "not" strip is a credibility device, `docs/vision.md` →
Non-Goals. Stablecoins are the settlement rail; wallet infrastructure, DEX
liquidity, and oracles exist as primitives; the orchestration layer above them
did not. Primitives are provider-backed: Turnkey (key management), Safe
(smart-account wallets), Uniswap, 0x, LiFi (liquidity), Pyth, Chainlink (price
oracles). QRIS is Indonesia's national QR payment standard — the counterpart of
Singapore's SGQR; the QR parser reads EMVCo and QRIS payloads.

### 4 — How a payment works · 1:20

**Headline:** IDR 36,000 in. ETH paid. USDC received. One transaction.

**Copy:**

- A coffee shop in Jakarta creates a payment for IDR 36,000 — about S$3.
- Mayarin quotes and locks the price with a time and slippage bound.
- The customer pays 0.01295 ETH from any wallet they already have.
- The contract swaps ETH to USDC and delivers 2.007 USDC to the shop's own
  wallet in the same transaction.
- Ledger, dashboard, and webhooks update from the confirmed on-chain event.

**Visual:** the five-step flow — payer → PaymentRouter → atomic swap → merchant
wallet → indexed event → ledger — arriving one step at a time over the wave
plane (money in motion). Ends on the Basescan link of the settlement
transaction.

**Notes:** the amounts are from a real Base Sepolia payment on 2026-08-19,
intent `pi_01M0D8X65WSYV0T5FQRQVXV5M7`: payer transaction
[`0xe031f84f…`](https://sepolia.basescan.org/tx/0xe031f84f710834cbbf1516f0dfad12c543933da7772799795235e93d21b7525e),
settlement transaction
[`0x41a87c05…`](https://sepolia.basescan.org/tx/0x41a87c05e673ed17b80ef5009813b932db74e095d4cdfca2c5dfdda49bee83c1).
Payer sent 0.012953540 ETH. Settlement 2.019586 USDC, fee 0.012118 USDC,
merchant net 2.007468 USDC. IDR 36,000 is about S$3 at roughly 12,000 IDR per
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

### 5 — Why Mayarin · 1:00

**Headline:** Atomic on-chain settlement without a custodial FX desk.

**Copy:**

- **One transaction, no custody.** Receive, swap, settle in a single call. Hard
  revert if the swap misses the locked minimum. The contract holds no balance
  between payments.
- **Provisioned, not custodial.** The merchant is always a signer on their own
  Safe smart-account wallet. Payouts can only reach a verified merchant wallet — enforced on-chain.
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

### 6 — Live today · 0:50

**Headline:** Live on Base Sepolia today. Not a roadmap drawing.

**Copy:**

- Three contracts deployed and verified on Base Sepolia, Base's public testnet.
  Both execution paths settle end to end.
- Full commerce surface: catalog, carts, payment links, hosted checkout,
  embeddable checkout, WooCommerce plugin.
- Merchant dashboard: products, orders, customers, payments, settlement,
  wallets, webhooks, API keys, event log.
- Managed self-custody wallets: a Safe smart-account wallet created from a
  passkey (Face ID or Touch ID). No MetaMask, no seed phrase.
- Developer surface: TypeScript SDK, REST API, signed webhooks, real-time
  status.

**Visual:** over the grid field, the live hosts as a list — `mayarin.xyz`, `api-testnet.mayarin.xyz`,
`dashboard-testnet.mayarin.xyz`, `pay-testnet.mayarin.xyz`,
`docs.mayarin.xyz` — and the three contract addresses.

**Notes:** `docs/roadmap.md`. Phases 1–3 complete; Phase 4 mostly complete.
Everything on this slide is live. Not on this slide, by rule: passkey browser
ceremony, on-chain fee and refund split (#12), gas-free withdrawal (#9), OG
images (#166 in review), freeze handling and export. Bring a live demo payment
through the demo marketplace (`apps/demo`, Pages project `mayarin-demo`).

### 7 — Scale and go-to-market · 0:50

**Headline:** Global by design, local by default.

**Copy:**

- The payment intent is the constant. Assets, chains, venues, and providers
  are adapters around it — we add adapters, not rewrites.
- Next: more payer assets, more liquidity venues, more EVM chains, then Solana
  and TRON.
- Distribution: payment links and a printable QR with zero code, then
  embeddable checkout and the WooCommerce plugin, then the full dashboard.
- Beachhead: Indonesia first, then Southeast Asia — merchants price in
  Indonesian rupiah (IDR), customers hold crypto.
- Revenue: a fee split from the merchant settlement inside the same
  transaction. The merchant never pays gas to receive.

**Visual:** the dark globe with the settlement corridor cities (Jakarta,
Singapore, Bangkok, Tokyo, Dubai, Riyadh, Frankfurt, London, Sydney, São Paulo,
Mexico City). It fades in and turns; nothing else animates.

**Notes:** Phase 5 (RFCs #17–#21) and Phase 6, `docs/roadmap.md`. IDR and MYR
pricing already proven in the catalog. Cross-chain settlement is a separate
bridge trust model — later. Fiat off-ramp is a later phase with its own custody
perimeter. Treasury stays a fee recipient and gas funder, never an FX book. The
fee mechanism is live in the contract (`minOut − fee` to merchant, fee to
treasury, excess refunded); the backend fee and refund policy is next (#12);
the take-rate is a release decision. Agent Pay — Mayarin as the settlement and
policy layer for machine-initiated commerce — is later; mention only if asked.
`PURPOSE.md §22`.

### 8 — Impact and the ask · 0:40

**Headline:** Any merchant, any customer, any asset — with the merchant in
control.

**Copy:**

- Merchants reach global crypto liquidity without giving up custody or
  learning blockchain.
- Every payment is auditable: a balanced ledger entry and an on-chain event,
  reconciled against each other.
- Built in Indonesia, architected for any local currency.
- **The ask (judges):** shipped, not slideware — scrutinise the testnet.
- **The ask (investors):** seed to finish Phase 4 and open Phase 5 multi-chain.

**Visual:** one merchant story — a coffee shop in Jakarta prices a flat white at
IDR 36,000 (about S$3), a visitor pays in ETH, the shop holds USDC in a wallet
only it controls — and the ask in one line.

**Notes:** compliance is cheap, not absent — screening port with a disabled
default (`NOT_SCREENED`, never `CLEAR`); reconciliation states `MATCHED` /
`MISMATCHED` / `NO_ON_CHAIN_RECORD` (`docs/compliance.md`). Hackathon
alignment: Track 1 (Payments and Financial Infrastructure) and Track 2 (Web3
Applications and AI), `docs/roadmap.md`. Phase 4 items behind the investor ask:
on-chain fee split (#12), gas-free withdrawals (#9), mainnet hardening (#143).
Machine-commerce positioning is later.

---

## Backup slides

### A — Risks we carry

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

### B — Claim ledger

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

| Audience            | Lead with                                                | Trim                                   |
| ------------------- | -------------------------------------------------------- | -------------------------------------- |
| **Hackathon judge** | 4, 5, 6 — the real payment, atomic settlement, live.     | 7 to three bullets.                    |
| **Investor**        | 3, 7, 8 — market, scale by adapter, beachhead, ask.      | 4 to the diagram. Keep 5 and backup A. |
| **Technical judge** | 4, 5, backup A — architecture, invariants, threat model. | 1–3 to one breath each.                |

---

## Related

- [Vision & Rationale](./vision.md)
- [Architecture](./architecture.md)
- [Roadmap](./roadmap.md)
- [Threat Model](./threat-model.md)
- [Chain Layer](./chain.md)
