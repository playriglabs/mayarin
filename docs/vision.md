[← Documentation index](./README.md)

# Vision & Rationale

Why Mayarr exists, what it refuses to become, and the problem it is pointed at.

---

## Philosophy

> **Money moves. Infrastructure orchestrates.**

Traditional payment systems understand fiat.

Blockchain understands programmable value.

Mayarr exists between those worlds.

Not another payment gateway.

Not another crypto wallet.

Not another exchange.

A programmable clearing layer for modern payments.

---

---

## Name & Meaning

**/maɪˈjɑːr/** — _"My-ar"_

Mayarr is inspired by the Indonesian word **"bayar"** (_to pay_), reimagined into a modern, global identity.

It also draws inspiration from the Latin word:

> **Maior**

Meaning:

- Greater
- Higher
- Superior

Representing the next evolution of financial infrastructure.

---

---

## Overview

Today's payment ecosystem is fragmented.

Traditional payment gateways move:

```
Fiat
   │
   ▼
Fiat
```

Crypto wallets move:

```
Crypto
   │
   ▼
Crypto
```

There is no universal infrastructure capable of orchestrating value across both ecosystems.

Mayarr introduces a programmable clearing layer capable of:

- Accepting any supported digital asset
- Routing assets through the most efficient liquidity path
- Converting assets into a configurable settlement asset
- Managing treasury and settlement balances
- Recording every transaction through double-entry accounting
- Executing settlements through pluggable payment adapters
- Supporting multiple payment rails without changing business logic

---

---

## Problem

Stablecoins have become programmable money.

However, merchant payment infrastructure remains fragmented across countries, providers, and banking systems.

Today users can:

- Store crypto
- Trade crypto
- Transfer crypto

But spending digital assets through existing merchant infrastructure remains difficult.

Every payment provider has different APIs, settlement rules, and financial rails.

Developers must integrate every provider independently.

---

---

## Solution

Mayarr introduces a programmable clearing architecture where payment providers become interchangeable adapters.

Core responsibilities include:

- Payment orchestration
- Liquidity routing
- Settlement abstraction
- Treasury management
- Clearing
- Ledger management
- Payment state management

The business layer never communicates directly with payment providers.

Instead, every payment flows through a unified clearing engine.

---

---

## Goals

Mayarr is designed around four principles.

- Abstract payment rails
- Normalize digital assets
- Make settlement programmable
- Keep integrations provider agnostic

---

---

## Non Goals

Mayarr is **not**:

- A cryptocurrency exchange
- A custodial wallet
- A banking platform
- A payment gateway
- A blockchain

Instead, Mayarr focuses exclusively on payment orchestration, clearing, and settlement infrastructure.

---

---

## Why Clearing?

Most payment gateways process payments.

Mayarr orchestrates payments.

Instead of coupling applications directly with payment providers:

```
Application

↓

QRIS
```

Mayarr introduces a programmable abstraction:

```
Application

↓

Payment Intent

↓

Liquidity

↓

Settlement

↓

Clearing

↓

Payment Rail
```

Developers integrate once.

Settlement providers become interchangeable.

---

---

## Value Proposition

Unlike traditional payment gateways that only process fiat transactions, Mayarr provides a programmable clearing layer capable of orchestrating digital assets, settlement assets, and traditional payment infrastructure through one unified architecture.

Developers integrate once.

Mayarr manages routing, settlement, clearing, accounting, and payment orchestration across multiple providers.

---

## Related

- [Architecture](./architecture.md)
- [Roadmap](./roadmap.md)

[← Documentation index](./README.md)
