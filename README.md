# mayarin

**/maɪˈjɑːrɪn/** — _"My-ar-in"_

> **Programmable Crypto-Commerce Infrastructure**
>
> _Price in fiat. Settle in stablecoins. Pay with anything._

Mayarin is programmable crypto-commerce infrastructure: merchants price in their local currency and settle in a stablecoin; customers pay with any supported crypto asset. Mayarin bridges the two without requiring merchants to understand blockchain.

A provider-agnostic clearing layer orchestrates value across wallets, blockchains, and stablecoins through one modular architecture. Fiat payment rails (QRIS, bank transfer) and a stablecoin → fiat off-ramp are intentionally out of the MVP — later, explicit phases with their own custody perimeter.

---

# Vision

```
              Any Payer Asset

   ETH • USDC • USDT • IDRX • …

                   │
                   ▼

     ┌─────────────┴─────────────┐

     ▼                           ▼

 Off-chain orchestration     On-chain execution
 deposit address → watcher    PaymentRouter → atomic swap
 (fallback path)             (primary path)

     └─────────────┬─────────────┘
                   ▼

       Settlement Asset (stablecoin)

                   │
                   ▼

       Merchant Smart Account

     ├── USDC   ├── USDT   └── IDRX
```

---

# Quick Start

Requires [Bun](https://bun.sh) 1.2+ and Docker.

```bash
bun run setup          # install, .env, Postgres, migrations, config check
bun run dev            # API on http://localhost:3000
bun run dev:docs       # developer docs on http://localhost:4321
```

`setup` is also the way back to a working tree when something has drifted — it
reports which keys your `.env` is missing against `.env.example`, and which it
declares that nobody else has. Run it with `--seed` to create the first merchant
account, `--reset-db` to migrate from an empty database, or `--check` to report
without changing anything.

Doing it by hand is four steps rather than one, and the third has a trap:

```bash
bun install
cp .env.example .env
bun run db:up

# `db:migrate` runs in packages/db, which has no .env of its own — the root file
# is not inherited, so DATABASE_URL must be passed in explicitly.
export $(grep -E '^DATABASE_URL' .env) && bun run --cwd packages/db migrate
```

Pay something. Creating an intent is a merchant act, so it needs an API key —
`bun run seed:merchant` prints one (`apiKey:`) when it creates the merchant:

```bash
curl -X POST localhost:3000/v1/payment-intents \
  -H 'content-type: application/json' \
  -H 'Authorization: Bearer <apiKey from seed:merchant>' \
  -H 'Idempotency-Key: order-4711' \
  -d '{"merchant":{"id":"M-1","name":"Warung Kopi","city":"Jakarta","countryCode":"ID"},
       "amount":{"amount":"50000.00","asset":"IDR"}}'

curl -X POST localhost:3000/v1/payment-intents/<id>/confirm
curl localhost:3000/v1/payments/<id>
```

Full setup, commands and tooling: [docs/development.md](./docs/development.md).

---

# Documentation

| Document                                           | Covers                                                             |
| -------------------------------------------------- | ------------------------------------------------------------------ |
| [Vision & Rationale](./docs/vision.md)             | Why Mayarin exists, the problem, goals and non-goals               |
| [Architecture](./docs/architecture.md)             | Design principles, system layers, payment flow, monorepo, stack    |
| [Money](./docs/money.md)                           | Exact minor-unit amounts and the asset registry                    |
| [QR Parser](./docs/qr-parser.md)                   | EMVCo decoding and the QRIS profile                                |
| [Payment Intent](./docs/payment-intent.md)         | Immutable payment requests and their lifecycle                     |
| [Chain Layer](./docs/chain.md)                     | Per-intent deposit addresses, wallet watcher, reorg policy         |
| [Stablecoin Registry](./docs/stablecoin.md)        | Admissible stablecoins and their on-chain identities               |
| [Liquidity & Routing](./docs/liquidity-routing.md) | Turning any asset into the settlement asset via a pluggable source |
| [Clearing Engine](./docs/clearing-engine.md)       | The nine-state machine, idempotency, resumability                  |
| [Double Entry Ledger](./docs/ledger.md)            | Chart of accounts and the postings behind every payment            |
| [Settlement](./docs/settlement.md)                 | The provider abstraction and the adapters behind it                |
| [REST API](./docs/api.md)                          | Endpoints, request and response shapes, error codes                |
| [Configuration](./docs/configuration.md)           | Deployment identity vs merchant settings vs market data            |
| [Development](./docs/development.md)               | Running locally, commands, formatting, git hooks                   |
| [Deployment Targets](./docs/deployment.md)         | Manual Railway testnet/mainnet selection and safety gates          |
| [Roadmap](./docs/roadmap.md)                       | What is shipped and what comes next                                |

---

# New Roadmap

Mayarin can grow from its programmable clearing foundation into an open,
multi-network commerce platform. The next possibilities are organized around
five horizons:

- **Complete the commerce experience** — production-ready checkout, merchant
  smart accounts, fee and refund splitting, gas-sponsored withdrawals,
  notifications, SDKs, analytics, and compliance tooling.
- **Expand how customers pay** — support more tokens, native assets, liquidity
  venues, wallet providers, and execution strategies while keeping settlement
  predictable for merchants.
- **Reach more networks and markets** — add EVM networks, then explore Solana,
  TRON, configurable settlement assets, and explicitly designed cross-chain
  flows.
- **Enable AI-native payments** — give assistants and autonomous agents a safe
  way to discover payment options, request quotes, and complete approved
  purchases through Agent Pay-style flows or an MCP server. Agent identities,
  scoped API keys, per-transaction limits, human approval thresholds,
  idempotency, and a complete audit trail should be required before any agent
  can move funds.
- **Open and scale the infrastructure** — strengthen observability,
  reconciliation, high availability, and multi-region operation; introduce
  provider and plugin SDKs; and explore a separately governed stablecoin-to-fiat
  off-ramp.

These are directions Mayarin can pursue, not delivery commitments. Each should
preserve the project's core principles: provider-agnostic adapters, auditable
value movement, merchant-controlled funds, and a clear custody boundary.

See the [detailed roadmap](./docs/roadmap.md) for current capabilities, design
constraints, and phase-level plans.

---

# Tagline

> **Build once. Settle anywhere.**

---

# Closing Statement

> We believe digital assets should not replace existing payment systems.
> They should make them programmable.

Mayarin turns fragmented crypto-payment infrastructure into a unified clearing
layer that orchestrates quoting, execution, settlement, accounting, and wallet
provisioning behind one API — so the merchant prices in their local currency and
receives their chosen stablecoin while the customer pays with whatever asset they hold.
