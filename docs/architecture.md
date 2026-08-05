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
- On-Chain Execution — value moves on a smart contract; the backend orchestrates
- Trust-Minimized — the backend never holds keys to user assets

---

## System Architecture

Two execution paths share the same intent, ledger, and stablecoin registry. The
**on-chain** path (Phase 3, primary) routes the customer's payment through a
smart contract that atomically swaps and settles. The **deposit-matching** path
(Phase 2, shipped, fallback) watches a per-intent deposit address.

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

             Quote Engine          ── Price Oracle (adapter)
                                  ── DEX quote (executable minOut)

                     │

────────────────────────────────────────

          PaymentRouter.sol        (on-chain execution, Phase 3)

                     │

              Execution Engine     ── 0x, Uniswap (pluggable)

                     │

────────────────────────────────────────

            Wallet Provider         ── Turnkey (MPC policy engine)
                                    ── Tempo (MPC, alternative)

                     │

────────────────────────────────────────

              Indexer               ── observes PaymentCompleted

                     │

         Double Entry Ledger        (derived from on-chain truth)

                     │

────────────────────────────────────────

                Merchant Wallet     (Safe smart account, self-custodial)
```

The backend creates intents, locks quotes, builds calldata, observes events,
and keeps the ledger. It never signs a payment movement — the contract does.

---

## Payment Flow

The merchant prices in their local currency and settles in a stablecoin; the
customer pays with any supported asset. When the assets differ, the contract
converts on-chain before settlement.

```
Merchant prices            IDR 50.000

↓

Price Engine               IDR → USDC          (merchant's settlement amount)

↓

Quote Engine               locks minOut + TTL + slippage

↓

Customer chooses asset     ETH

↓

Quote Engine               derives ETH display amount   (estimate, not a lock)

↓

Payment QR / Request       EIP-681 / PaymentRouter calldata

↓

Customer pays              → PaymentRouter.sol

↓

Swap (if needed)           ETH → USDC, atomic, hard revert on minOut miss

↓

Merchant receives          USDC in their managed wallet

↓

PaymentCompleted event     → Indexer → Ledger → Dashboard
```

The hard lock is the **merchant's settlement amount** (`minOut`). The customer's
payer-asset amount is a **display estimate** — the contract swaps whatever
arrives, so the customer's quote is not a custody lock. Atomicity plus a hard
revert on `minOut` miss is what makes "merchant always receives the settlement
asset" safe without a treasury FX book.

### Deposit-matching path _(Phase 2, fallback)_

For direct transfers and chains without a deployed `PaymentRouter`, the shipped
off-chain path remains: the customer sends to a per-intent deposit address, a
watcher detects receipt, and the clearing engine settles off-chain.

```
Payment Intent            asset, chain and amount locked

↓

Deposit Address           derived per intent

↓

Address QR                EIP-681 / BIP-21

↓

Payer sends               (exchange withdrawal or self-custody wallet)

↓

Wallet Watcher            sees the transfer

↓

Confirmation Depth        reached

↓

Clearing Engine           ASSET_RECEIVED

↓

Settlement Adapter        off-chain

↓

Merchant Paid
```

The address QR is a different payload family from EMVCo — an exchange app has
never heard of QRIS — but it enters the same `PaymentIntent`, so nothing
downstream can tell the two flows apart. A per-intent deposit address is what
makes the payment identifiable: an exchange withdrawal leaves an omnibus hot
wallet with no memo or calldata, so the address is the only thing tying a
transfer to an intent.

---

## Monorepo Structure

Implemented and shipped (`✓`), planned for later phases (`·`):

```
apps/

  ✓ api/                 payment clearing API (Hono)
  ✓ dashboard-api/       merchant dashboard API (Hono + Effect)
  ✓ dashboard/           merchant dashboard UI (Astro + React)
  ✓ landing/             marketing site

packages/

    core/

      ✓ clearing/         state machine, engine, fees, rate/liquidity ports
      ✓ ledger/           double-entry accounts, entries, balances
      ✓ payment-intent/   immutable intents and their lifecycle
      ✓ qr-parser/        EMVCo TLV decoder + QRIS profile
      ✓ settlement/       SettlementAdapter port (with mode) and registry
      ✓ chain/            chain ports, deposit types, confirmation policy, watcher
      ✓ stablecoin/       StablecoinRegistry port and value types — the admissible set
      ✓ auth/             merchant/user/session domain, PasswordHasher port
      · commerce/         Phase 4 product catalog, prices, carts → payment intents
      · quote/            Phase 3 quote engine (lock, TTL, slippage, signing)
      · execution/        Phase 3 execution engine (DEX routing, calldata)

    contracts/            Phase 3 PaymentRouter.sol — on-chain execution layer
      · payment-router/

    providers/

      ✓ mock/             MockSettlementAdapter
      ✓ evm/             viem ChainClient and HdDepositAddressDeriver
      ✓ stablecoin/       StablecoinSettlementAdapter (internal)
      ✓ argon2/           Argon2PasswordHasher
      · turnkey/          Phase 4 wallet provider (MPC policy engine)
      · zerodev/          Phase 3 gas abstraction / paymaster / relayer
      · swap-0x/          Phase 3 0x Protocol swap source
      · swap-uniswap/     Phase 3 Uniswap swap source
      · pyth/             Phase 3 Pyth price oracle
      · chainlink/         Phase 3 Chainlink price oracle

  ✓ db/                   Drizzle schema, repositories, in-memory adapters
  · sdk/                  Phase 4 TypeScript client SDK (commerce + payment + QR)
  ✓ shared/              money, assets, ids, errors, events, clock
```

Two packages worth noting:

- **`core/qr-parser`** — the QR parser is a core component but was missing from
  the original tree.
- **`db`** — the domain packages define repository _ports_; their Drizzle and
  in-memory implementations live here. Keeping them out of `core` is what lets a
  domain package be tested, and swapped, without a database.

The chain layer respects the same boundary one-way: `packages/core/chain` knows
the clearing engine's seam (`recordAssetReceived`) only as an injected sink, so
it never imports `@mayarin/clearing`. The composition root in `apps/api` is the
only place that wires a real `WalletWatcher` to the engine. See
[Chain Layer](./chain.md).

A [Stablecoin Registry](./stablecoin.md) holds which stablecoins a deployment
admits and where each lives on-chain, unioning `SETTLEMENT_ASSETS` with
`CHAIN_ASSETS`. It is the single source the watcher pairs, the intent
admissibility check, and (later) the execution engine all read from.

The [Quote / Liquidity](./liquidity-routing.md) ports the clearing engine already
locks prices through are the seams Phase 3 plugs into: a DEX `PriceSource`
replaces the static table for the executable `minOut`, an oracle becomes the
deviation guard, and the `LiquidityRouter`'s same-asset identity stays. Swap
execution moves on-chain to `PaymentRouter.sol` in Phase 3 — the router only
prices today.

The [Settlement Engine](./settlement.md) settles a payment through a
`SettlementAdapter` whose `mode` says whether value leaves Mayarin
(`"external"`) or stays as a merchant balance (`"internal"` — the engine credits
`MERCHANT_HOLDING`, a liability the merchant withdraws on-chain). The on-chain
path (Phase 3) supersedes the off-chain adapters for supported assets: the
contract settles directly to the merchant's managed wallet, and the off-chain
adapters remain as the fallback path's settlement.

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
- Solana _(future, non-EVM)_
- TRON _(future, non-EVM)_

#### SDK

- Viem
- Wagmi

#### Wallet Infrastructure

- Turnkey (MPC policy engine — the wallet provider)
- Tempo (MPC, alternative backend)
- Safe (smart-account wallet shape, self-custodial)

The backend never holds user keys. Turnkey provisions and signs for managed
wallets under policy; the merchant's wallet is a self-custodial Safe smart
account. The "reveal private key" feature is disabled; layered signing security
is added later. For now, Turnkey is sufficient.

#### Liquidity

- Uniswap
- 0x API

#### Price Oracles

- Pyth Network (production — pull-based, on-chain verifiable)
- Chainlink (off-chain reference)

#### Gas Abstraction

- ZeroDev (relayer / paymaster)

A merchant whose wallet starts empty cannot move their stablecoin. Gas
abstraction is required for the "no wallet, no seed phrase" experience.

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

- [Chain Layer](./chain.md)
- [Stablecoin Registry](./stablecoin.md)
- [Clearing Engine](./clearing-engine.md)
- [Double Entry Ledger](./ledger.md)
- [Development](./development.md)

[← Documentation index](./README.md)
