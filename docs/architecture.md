[← Documentation index](./README.md)

# Architecture

How the pieces fit together, how a payment moves through them, and where the
code lives.

---

## Design Principles

- Provider Agnostic
- Event Driven
- Modular
- Ledger First
- Idempotent
- Composable
- Resumable Transactions
- Plugin Architecture

---

---

## System Architecture

```
                 Client SDK

                     │

                     ▼

               API Gateway

                     │

────────────────────────────────────────

             Payment Intent

                     │

────────────────────────────────────────

               QR Parser

                     │

────────────────────────────────────────

           Liquidity Router

                     │

────────────────────────────────────────

          Settlement Engine

                     │

────────────────────────────────────────

           Clearing Engine

                     │

────────────────────────────────────────

         Double Entry Ledger

                     │

────────────────────────────────────────

         Settlement Adapter

      ├── QRIS
      ├── Bank Transfer
      ├── PayNow
      ├── PromptPay
      ├── DuitNow
      └── Mock

                     │

────────────────────────────────────────

                Merchant
```

---

---

## Payment Flow

```
Customer

↓

Scan Merchant QR

↓

QR Parser

↓

Payment Intent

↓

Liquidity Router

↓

Settlement Asset

↓

Settlement Engine

↓

Clearing Engine

↓

Settlement Adapter

↓

Merchant Paid
```

---

---

## Monorepo Structure

Implemented in Phase 1 (`✓`), planned for later phases (`·`):

```
apps/

  ✓ api/
  · dashboard/          Phase 2
  · playground/         Phase 2
  · docs/               Phase 2

packages/

    core/

      ✓ clearing/         state machine, engine, fees, rate port
      ✓ ledger/           double-entry accounts, entries, balances
      ✓ payment-intent/   immutable intents and their lifecycle
      ✓ qr-parser/        EMVCo TLV decoder + QRIS profile
      ✓ settlement/       SettlementAdapter port and registry
      · routing/          Phase 3 smart routing

    blockchain/           Phase 2

      · evm/
      · wallet/
      · contracts/

    providers/

      ✓ mock/
      · qris/             Phase 3
      · bank/             Phase 3

  ✓ db/                 Drizzle schema, repositories, in-memory adapters
  · sdk/                Phase 2
  ✓ shared/             money, assets, ids, errors, events, clock
```

Two packages are not in the original layout:

- **`core/qr-parser`** — the QR parser is a core component in this document but
  was missing from the tree.
- **`db`** — the domain packages define repository _ports_; their Drizzle and
  in-memory implementations live here. Keeping them out of `core` is what lets a
  domain package be tested, and swapped, without a database.

Note that `apps/docs/` above is a future documentation _site_, and is not the
same thing as the repository's `docs/` directory — the Markdown you are reading
now, which lives at the root and has no build step.

---

---

## Technology Stack

### Backend

- Bun
- TypeScript
- Hono

### Blockchain

#### Networks

- Base (Primary)
- Ethereum
- Arbitrum
- Optimism
- Polygon

#### SDK

- Viem
- Wagmi
- WalletConnect

#### Liquidity

- Uniswap
- 0x API
- 1inch API

#### Settlement Assets

- IDRX
- USDC
- USDT

### Storage

- PostgreSQL
- Drizzle ORM

### Infrastructure

- BullMQ
- Upstash Redis

Not yet wired: Phase 1 recovers stalled payments by resuming them on startup and
on demand (`ClearingEngine.resumeStuck`). A queue turns that into a background
worker without changing the engine, since resumption is already a pure function
of persisted state.

### Validation

- Zod

### Deployment

- Docker
- Railway
- Fly.io

---

## Related

- [Clearing Engine](./clearing-engine.md)
- [Double Entry Ledger](./ledger.md)
- [Development](./development.md)

[← Documentation index](./README.md)
