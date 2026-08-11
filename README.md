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
| [Roadmap](./docs/roadmap.md)                       | What is shipped and what comes next                                |

---

# Status

**Phase 1 — Core Infrastructure ✅ Shipped.** QR parser, payment intents, clearing
engine, double-entry ledger and a mock settlement adapter, behind a Hono API on
Postgres.

**Phase 2 — Chain Interface & Quoting Seams ✅ Shipped.** EVM chain client,
finality + reorg policy, per-intent deposit addresses, wallet watcher, stablecoin
registry (IDRX/USDC/USDT), RateProvider/PriceSource ports + LiquidityRouter, and
stablecoin settlement adapter.

**Phase 3 — On-Chain Execution ✅ Shipped.** PaymentRouter contract deployed and
verified on Base Sepolia, quote engine with Pyth/Chainlink oracle guard,
settlement indexer, CREATE2 deposit forwarder and treasury executor. Both
execution paths settle end to end: the payer connects a wallet, or makes a plain
transfer to a per-intent address that the executor converts. Gas abstraction
(#9) moved to Phase 4, scoped to sponsoring merchant withdrawals from a managed
wallet — off-chain work that needs no contract change.

**Phase 4 — Commerce Platform.** Commerce layer, wallet infrastructure
(Safe/Turnkey), on-chain settlement + fee/refund split, notifications, developer
SDK, merchant dashboard, compliance.

**Phase 5 — Multi-Asset, Multi-Chain.** More payer assets + venues + chains +
wallet providers; configurable settlement assets.

See the [roadmap](./docs/roadmap.md) for the detail.

---

# RFCs & Issue Board

Feature work is tracked as RFC issues — full specs with goals, non-goals,
acceptance criteria, and dependencies, assigned by phase:

- **Phase 3** — On-Chain Execution ✅ ([closed](https://github.com/playriglabs/mayarin/issues?q=is%3Aissue+label%3Aphase-3))
- **Phase 4** — Commerce Platform ([#10–#16](https://github.com/playriglabs/mayarin/issues?q=is%3Aopen+label%3Aphase-4+label%3Arfc))
- **Phase 5** — Multi-Asset, Multi-Chain ([#17–#21](https://github.com/playriglabs/mayarin/issues?q=is%3Aopen+label%3Aphase-5+label%3Arfc))

[Open the board →](https://github.com/playriglabs/mayarin/issues?q=is%3Aopen+label%3Arfc)

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
