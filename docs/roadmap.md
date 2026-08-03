[← Documentation index](./README.md)

---

# Roadmap

## Phase 1 — Foundation ✅ shipped

Establish the programmable clearing infrastructure.

### Core

- Payment Intent
- QR Parser (EMVCo / QRIS)
- Clearing Engine
- Double Entry Ledger
- Mock Settlement Adapter
- Event-driven payment state machine

One deliberate stand-in remains: prices are locked against a configured table
until the Liquidity Router replaces it with real-time price discovery. The
wallet watcher Phase 1 left as a seam now exists — see
[Chain Layer](./chain.md) — so a payment waits for the payer's asset to arrive
rather than being treated as funded at `PAYMENT_PENDING`.

---

## Phase 2 — On-chain Payments

Introduce blockchain-native payment capabilities.

### Blockchain

- ✓ EVM Wallet Integration
- ✓ Wallet Watcher
- ✓ Asset Receipt Detection
- ✓ Per-intent Deposit Addresses
- ✓ Confirmation Depth & Reorg Policy
- · Liquidity Router
- · Settlement Engine

An exchange withdrawal carries no memo and no calldata, so nothing in the
transfer itself says which payment it belongs to. Deriving a deposit address per
payment intent is what makes the match unambiguous; matching on amount alone
collides the moment two customers owe the same figure.

### Stablecoin Settlement

- ✓ IDRX
- ✓ USDC
- ✓ USDT

A [Stablecoin Registry](./stablecoin.md) now holds the admissible set and each
stablecoin's on-chain identities, unioning `SETTLEMENT_ASSETS` with
`CHAIN_ASSETS`. A merchant can be paid in any admitted stablecoin; a payer leg
must be a deposit asset the registry knows.

### Dashboard

- Payment Explorer
- Transaction Timeline
- Settlement Status

---

## Phase 3 — Merchant Infrastructure

Expand Mayarin into a programmable merchant platform.

### Merchant SDK

- Merchant API
- Invoice API
- Payment Links
- Webhooks

### POS SDK

- Dynamic QR Generation
- Static QR Support
- Payment Terminal API
- Real-time Payment Status
- Receipt API

### QR SDK

- QRIS Parser
- QRIS Generator
- EMVCo Parser
- EMVCo Generator
- Crypto Address QR (EIP-681 / BIP-21)
- QR Validation

A crypto QR is a different payload family from EMVCo, not another EMVCo profile.
An exchange app scans an address URI; it has never heard of QRIS. Both families
share the parser's profile seam, but a payload is one or the other.

### Crypto Payments

- Crypto → Fiat
- Crypto → Crypto
- Wallet-to-Wallet Payments
- Configurable Settlement Assets
- Underpayment & Overpayment Handling
- Wrong-chain Recovery

### POS crypto checkout

The end-to-end flow this enables, and the one place the roadmap's phases
interleave rather than stack:

```
Merchant POS quotes a price
  ↓ lock asset, chain and amount        Phase 1  PRICE_LOCKED
  ↓ derive a deposit address            Phase 2  per-intent addresses
  ↓ render an address QR                Phase 3  QR SDK
Payer scans it in Binance, sends
  ↓ watcher sees the transfer           Phase 2  wallet watcher
  ↓ enough confirmations                Phase 2  confirmation depth
  ↓ recordAssetReceived                 Phase 1  shipped
Payment success
```

Two consequences worth stating. The clearing engine needs no new state — the
watcher drives the `PAYMENT_PENDING → ASSET_RECEIVED` transition that already
exists. And when the payer sends the same asset the merchant settles in, the
Liquidity Router has nothing to convert, so that path skips it entirely.

---

## Phase 4 — Global Settlement Network

Scale beyond a single payment rail.

### Settlement Providers

- QRIS
- Bank Transfer
- PayNow
- PromptPay
- DuitNow

### Blockchain Providers

- Direct EVM
- TRON
- Solana
- Tempo
- Future Stablecoin Infrastructure

Non-EVM chains are not optional here. Exchange users withdraw USDT on TRON
because the fee is cents, so a payer told to send USDT will often send it on a
chain Phase 2's EVM watcher cannot see.

### Smart Routing

- Liquidity Optimization
- Settlement Optimization
- Retry Strategy
- Treasury Optimization

---

## Phase 5 — Commerce Infrastructure

Transform Mayarin into a universal payment platform.

### Payment Rails

- QRIS
- Bank Transfer
- Wallet Payments
- Crypto Address Payments
- Cross-border Payments

### Merchant Platform

- Merchant Dashboard
- Multi-store Support
- Team Management
- Reporting & Analytics
- Settlement Reports

### Developer Platform

- TypeScript SDK
- REST API
- Webhooks
- Plugins
- Provider SDK

---

# Long-term Vision

Mayarin aims to become a universal programmable payment infrastructure.

- One SDK, One API.
- Multiple payment rails.
- Multiple settlement providers.
- Multiple blockchain networks.
- Developers integrate once while Mayarin orchestrates liquidity, clearing, settlement, and payment execution behind the scenes.

---

# Hackathon Alignment

## Track 1 — Payments & Financial Infrastructure

- Payment orchestration
- Clearing infrastructure
- Settlement abstraction
- Treasury management
- Merchant payment rails
- POS infrastructure
- Financial operations

## Track 2 — Web3 Applications & AI

- Stablecoin payments
- Crypto-to-crypto payments
- Cross-chain settlement
- Smart payment routing
- Modular Web3 infrastructure

---

## Related

- [Architecture](./architecture.md)
- [Vision & Rationale](./vision.md)

[← Documentation index](./README.md)
