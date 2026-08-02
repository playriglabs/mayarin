[← Documentation index](./README.md)

---

# Roadmap

## Phase 1 — shipped

- QR Parser
- Payment Intent
- Clearing Engine
- Double Entry Ledger
- Mock Settlement Adapter

One deliberate stand-in remains: with no wallet integration yet, nothing observes
the payer's asset arriving on-chain. `ASSET_RECEIPT_MODE=auto` treats a payment
as funded when it reaches `PAYMENT_PENDING`; `manual` leaves it waiting for
`recordAssetReceived`, which is the seam Phase 2's wallet watcher plugs into.
Prices are locked against a configured table until the liquidity router replaces
it with real discovery.

## Phase 2

- EVM Wallet Integration
- Liquidity Router
- Settlement Engine
- Dashboard

## Phase 3

- Production Settlement Providers
- Smart Routing Engine
- Multi-country Payment Rails
- Treasury Automation

---

---

# Hackathon Alignment

## Track 1 — Payments & Financial Infrastructure

- Payment orchestration
- Clearing infrastructure
- Settlement abstraction
- Treasury management
- Merchant payment rails
- Financial operations

## Track 2 — Web3 Applications & AI

- Stablecoin payments
- Cross-chain settlement
- Smart payment routing
- Treasury optimization
- Modular Web3 infrastructure

---

## Related

- [Architecture](./architecture.md)
- [Vision & Rationale](./vision.md)

[← Documentation index](./README.md)
