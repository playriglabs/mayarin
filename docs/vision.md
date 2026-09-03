[← Documentation index](./README.md)

# Vision & Rationale

Why Mayarin exists, what it refuses to become, and the problem it is pointed at.

---

## Philosophy

> **Merchants think in fiat. Settlement happens in stablecoins. The payer holds
> whatever they hold — and may not be a person at all.**

Traditional payment systems understand fiat. Blockchain understands programmable
value. Mayarin is the infrastructure that lets a merchant price in their local
currency and receive a stablecoin, while the payer pays in any supported asset —
without either side understanding the other's world.

The second half of that sentence has widened. A payer used to mean a person: at
a checkout, scanning a QR, connecting a wallet. It now also means a **program** —
an autonomous agent that has no account, no API key and no checkout page, and
that pays for a single API call by signing one authorization. Same clearing
layer, same ledger, same merchant experience; a different kind of buyer.

Not another payment gateway. Not another crypto wallet. Not another exchange.

**Programmable clearing infrastructure for people and programs.**

---

## Name & Meaning

**/maɪˈjɑːrɪn/** — _"My-ar-in"_

Mayarin is inspired by the Indonesian word **"bayar"** (_to pay_), reimagined into
a modern, global identity.

It also draws inspiration from the Latin word:

> **Maior**

Meaning:

- Greater
- Higher
- Superior

Representing the next evolution of financial infrastructure.

---

## Overview

Merchants price goods in the currency they think in. Customers hold crypto.
Between them is a gap: the merchant does not want to manage a wallet, quote
exchange rates, or care which asset the customer paid with; the customer does
not want to hunt for the one stablecoin the merchant accepts.

Mayarin closes that gap. A merchant prices in their local currency and configures
a settlement stablecoin. A payer pays in any supported asset. Mayarin quotes,
locks, and — when the assets differ — converts on-chain before settlement.

```
Merchant prices      IDR 50.000
Customer pays        0.00028 ETH
Mayarin converts      ETH → USDC (on-chain, atomic)
Merchant receives    0.95 USDC
```

The merchant never learns which asset the customer used. The customer never
learns which stablecoin the merchant settles in.

The same gap exists between a merchant and a machine, and it is wider. An agent
buying one API call cannot open an account, cannot hold a card, and cannot be
asked to understand gas. It can sign one authorization for an exact amount in an
asset it already holds — so that is the whole interface it is given.

```
Agent requests       GET /premium-data
Mayarin answers      402, with the price in machine-readable terms
Agent signs          an authorization for exactly that amount
Merchant receives    0.02 USDC
```

No signup, no key, no invoice. The merchant's side of that transaction is
indistinguishable from any other payment.

---

## Problem

Stablecoins are programmable money, but merchant payment infrastructure for them
is fragmented and crypto-native in all the wrong places: merchants are asked to
connect wallets, manage seed phrases, understand gas, and reconcile which asset
arrived from which customer.

There is now a second gap, and it is newer. Software agents can decide to buy
things, and the payment infrastructure they are handed assumes a human: an
account to open, a card to hold, a subscription to manage, an API key to be
issued. An agent that wants one API call once has no way to pay for one API call
once.

Today a merchant who wants to accept crypto must either:

- become their own treasury desk — hold keys, manage wallets, swap assets
  themselves; or
- bolt a crypto checkout onto a fiat gateway and reconcile the two by hand.

Neither is infrastructure. Both push the hard parts onto the merchant.

---

## Solution

Mayarin is a programmable payment layer where pricing, quoting, on-chain
execution, settlement, and accounting are infrastructure — not the merchant's
job.

Core responsibilities:

- Price in the merchant's local currency, settle in a stablecoin.
- Quote and lock a rate with a slippage bound and TTL.
- Execute the conversion on-chain, atomically, when the assets differ.
- Provision a managed settlement wallet — no keys, no seed phrases.
- Record every movement through double-entry accounting.
- Expose one API and one SDK so developers build their own storefronts, POS,
  and checkout on top.
- Make any endpoint payable per call, so a program can buy from it without an
  account.

The business layer never speaks to a DEX, a wallet provider, or a chain directly.
Every payment flows through the same orchestration, and execution happens
on-chain behind a smart contract.

---

## Goals

Mayarin is designed around four principles.

- Let merchants price in fiat and settle in stablecoins.
- Let payers pay with any supported asset — whether they are a person or a
  program.
- Keep execution on-chain and trust-minimized; keep the backend an orchestrator.
- Keep integrations provider-agnostic (wallet, liquidity, price, chain).

---

## Non Goals

Mayarin is **not**:

- A cryptocurrency exchange.
- A custodial wallet — the backend never holds user assets; a wallet provider
  provisions managed wallets under policy.
- A fiat payment rail — QRIS, bank transfer, and other fiat rails are
  intentionally out of the MVP.
- A stablecoin → fiat off-ramp — a later, explicit phase with its own custody
  and regulatory perimeter.

---

## Why On-Chain Execution

Most payment gateways process payments. Mayarin orchestrates them, and a smart
contract executes them.

Instead of the backend moving assets:

```
Application → Backend → DEX → Merchant wallet     (backend is a custodian)
```

Mayarin pushes execution to the chain:

```
Customer → PaymentRouter.sol → swap (if needed) → Merchant wallet
                                              ↓
                                    PaymentCompleted event
                                              ↓
                              Backend observes → Ledger → Dashboard
```

The backend creates intents, locks prices, builds calldata, observes events,
and keeps the ledger. It never holds keys to user assets and never signs a
payment movement. Atomicity — receive, swap, and settle in one transaction — is
what makes "the merchant always receives the settlement asset" safe without
Mayarin running a treasury FX book.

---

## Value Proposition

A merchant prices in their local currency and receives their chosen stablecoin.
A customer pays with whatever asset they hold. A developer integrates once and
builds any commerce experience on top.

Mayarin manages quoting, on-chain execution, settlement, wallet provisioning,
and accounting behind one API and one SDK.

---

## Related

- [Architecture](./architecture.md)
- [Roadmap](./roadmap.md)

[← Documentation index](./README.md)
