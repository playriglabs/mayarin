# mayarr.xyz

**/maɪˈjɑːr/** — _"My-ar"_

> **Programmable Clearing Infrastructure**
>
> _Move value, not complexity._

Mayarr is a programmable clearing infrastructure that bridges digital assets with traditional payment rails through a modular, provider-agnostic architecture.

Instead of replacing existing financial systems, Mayarr orchestrates how value moves across wallets, blockchains, stablecoins, and local payment networks.

---

# Vision

```
             Any Digital Asset

 BTC • ETH • USDC • USDT • IDRX

                  │
                  ▼

          Liquidity Router

                  │
                  ▼

         Settlement Asset

                  │
                  ▼

         Settlement Engine

                  │
                  ▼

          Clearing Engine

                  │
                  ▼

        Settlement Adapter

      ├── QRIS
      ├── Bank Transfer
      ├── PayNow
      ├── PromptPay
      ├── DuitNow
      └── Future Rails
```

---

# Quick Start

Requires [Bun](https://bun.sh) 1.2+ and Docker.

```bash
bun install
cp .env.example .env

bun run db:up          # Postgres in Docker
bun run db:migrate     # apply migrations

bun run dev            # API on http://localhost:3000
```

Pay something:

```bash
curl -X POST localhost:3000/payment-intents \
  -H 'content-type: application/json' \
  -H 'Idempotency-Key: order-4711' \
  -d '{"merchant":{"id":"M-1","name":"Warung Kopi","city":"Jakarta","countryCode":"ID"},
       "amount":{"amount":"50000.00","asset":"IDR"}}'

curl -X POST localhost:3000/payment-intents/<id>/confirm
curl localhost:3000/payments/<id>
```

Full setup, commands and tooling: [docs/development.md](./docs/development.md).

---

# Documentation

| Document                                           | Covers                                                          |
| -------------------------------------------------- | --------------------------------------------------------------- |
| [Vision & Rationale](./docs/vision.md)             | Why Mayarr exists, the problem, goals and non-goals             |
| [Architecture](./docs/architecture.md)             | Design principles, system layers, payment flow, monorepo, stack |
| [Money](./docs/money.md)                           | Exact minor-unit amounts and the asset registry                 |
| [QR Parser](./docs/qr-parser.md)                   | EMVCo decoding and the QRIS profile                             |
| [Payment Intent](./docs/payment-intent.md)         | Immutable payment requests and their lifecycle                  |
| [Clearing Engine](./docs/clearing-engine.md)       | The nine-state machine, idempotency, resumability               |
| [Double Entry Ledger](./docs/ledger.md)            | Chart of accounts and the postings behind every payment         |
| [Settlement](./docs/settlement.md)                 | The provider abstraction and the rails behind it                |
| [Liquidity & Routing](./docs/liquidity-routing.md) | Turning any asset into the settlement asset _(planned)_         |
| [REST API](./docs/api.md)                          | Endpoints, request and response shapes, error codes             |
| [Development](./docs/development.md)               | Running locally, commands, formatting, git hooks                |
| [Roadmap](./docs/roadmap.md)                       | What is shipped and what comes next                             |

---

# Status

Phase 1 is shipped: QR parser, payment intents, clearing engine, double-entry
ledger and a mock settlement adapter, behind a Hono API on Postgres.

See the [roadmap](./docs/roadmap.md) for what Phase 2 and Phase 3 add.

---

# Tagline

> **Build once. Settle anywhere.**

---

# Closing Statement

> We believe digital assets should not replace existing payment systems.

> They should make them programmable.

Mayarr transforms fragmented payment infrastructure into a unified clearing layer capable of orchestrating value across blockchains, stable assets, and traditional payment rails through one modular architecture.
