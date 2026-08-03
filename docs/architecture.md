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
      ├── Direct EVM
      ├── Tempo
      └── Mock

                     │

────────────────────────────────────────

                Merchant
```

---

---

## Payment Flow

The payer scans a merchant QR and Mayarin routes whatever they hold into what
the merchant settles in.

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

### POS crypto checkout _(Phase 2 + 3)_

The other direction: the merchant's terminal issues the QR, and the payer sends
from an exchange or a self-custody wallet.

```
Merchant POS quotes a price

↓

Payment Intent          asset, chain and amount locked

↓

Deposit Address         derived per intent

↓

Address QR              EIP-681 / BIP-21, not EMVCo

↓

Payer scans in Binance, sends

↓

Wallet Watcher          sees the transfer

↓

Confirmation Depth      reached

↓

Clearing Engine         ASSET_RECEIVED

↓

Merchant Paid
```

The address QR is a different payload family from EMVCo — an exchange app has
never heard of QRIS — but it enters the same `PaymentIntent`, so nothing
downstream can tell the two flows apart.

Two properties fall out of the existing design. The clearing engine needs no new
state: the watcher drives the `PAYMENT_PENDING → ASSET_RECEIVED` transition that
Phase 1 already ships, through the same `recordAssetReceived` seam
`ASSET_RECEIPT_MODE=manual` exposes today. And when the payer sends the asset the
merchant already settles in, the Liquidity Router has nothing to convert, so that
path skips it.

A per-intent deposit address is what makes the payment identifiable. An exchange
withdrawal leaves from an omnibus hot wallet and carries no memo or calldata, so
the address is the only thing tying a transfer to an intent.

---

---

## Monorepo Structure

Implemented in Phase 1 (`✓`), planned for later phases (`·`):

```
apps/

  ✓ api/
  · dashboard/          Phase 2 payment explorer, timeline, settlement status
  · playground/         Phase 3
  · docs/               Phase 3

packages/

    core/

      ✓ clearing/         state machine, engine, fees, rate port
      ✓ ledger/           double-entry accounts, entries, balances
      ✓ payment-intent/   immutable intents and their lifecycle
      ✓ qr-parser/        EMVCo TLV decoder + QRIS profile
      ✓ settlement/       SettlementAdapter port and registry
      ✓ chain/           chain ports, deposit types, confirmation policy, watcher
      ✓ stablecoin/      StablecoinRegistry port and value types — the admissible set
      · qr-generator/     Phase 3 EMVCo/QRIS + crypto address QR encoding
      · merchant/         Phase 3 merchants, invoices, payment links
      · routing/          Phase 4 smart routing

    blockchain/           Phase 2

      ✓ evm/             viem chain client and HD deposit-address deriver
      · wallet/            custody, sweeping (Phase 2D Settlement Engine)
      · contracts/

    providers/

      ✓ mock/
      ✓ evm/             viem ChainClient and HdDepositAddressDeriver
      · qris/             Phase 4
      · bank/             Phase 4
      · paynow/           Phase 4
      · promptpay/        Phase 4
      · duitnow/          Phase 4
      · tempo/            Phase 4 blockchain settlement
      · tron/             Phase 4
      · solana/           Phase 4

  ✓ db/                 Drizzle schema, repositories, in-memory adapters
  · sdk/                Phase 3 TypeScript client, webhooks, provider SDK
  · pos/                Phase 3 terminal API, receipts, live payment status
  ✓ shared/             money, assets, ids, errors, events, clock
```

Two packages are not in the original layout:

- **`core/qr-parser`** — the QR parser is a core component in this document but
  was missing from the tree.
- **`db`** — the domain packages define repository _ports_; their Drizzle and
  in-memory implementations live here. Keeping them out of `core` is what lets a
  domain package be tested, and swapped, without a database.

The chain layer respects the same boundary one-way: `packages/core/chain` knows
the clearing engine's seam (`recordAssetReceived`) only as an injected sink, so
it never imports `@mayarin/clearing`. The composition root in `apps/api` is the
only place that wires a real `WalletWatcher` to the engine, feeding each funded
intent back through that sink. See [Chain Layer](./chain.md).

A [Stablecoin Registry](./stablecoin.md) holds which stablecoins a deployment
admits and where each lives on-chain, unioning `SETTLEMENT_ASSETS` with
`CHAIN_ASSETS`. It is the single source the watcher pairs, the intent
admissibility check, and (later) the liquidity router and settlement engine all
read from.

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
- Tempo _(Phase 4)_
- TRON _(Phase 4, non-EVM)_
- Solana _(Phase 4, non-EVM)_

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
- JPYC _(Phase 2, JPY)_
- XSGD _(Phase 2, SGD)_

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

- [Chain Layer](./chain.md)
- [Stablecoin Registry](./stablecoin.md)
- [Clearing Engine](./clearing-engine.md)
- [Double Entry Ledger](./ledger.md)
- [Development](./development.md)

[← Documentation index](./README.md)
