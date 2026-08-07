[← Documentation index](./README.md)

---

# Roadmap

Mayarin is **crypto commerce infrastructure**. Merchants price in their local
currency and settle in a stablecoin; customers pay with any supported crypto
asset. Mayarin bridges the two without requiring merchants to understand
blockchain.

The platform is developed in layers. Each phase expands the platform without
changing the core payment intent, allowing new assets, chains, liquidity
venues, and wallet providers to be added through adapters.

> **Scope note.** Fiat payment rails (QRIS, bank transfer) and fiat off-ramp
> providers are intentionally **out of the MVP**. The MVP serves merchants who
> can hold and use stablecoins. A stablecoin → fiat off-ramp is a later,
> explicit phase — not an assumption baked into the core.

---

## Phase 1 — Core Infrastructure ✅ Shipped

Build the programmable payment foundation.

### Core

- ✓ Payment Intent
- ✓ QR Parser (EMVCo / QRIS)
- ✓ Clearing Engine
- ✓ Double Entry Ledger
- ✓ Mock Settlement Adapter
- ✓ Event-driven Payment State Machine

### Architecture

- ✓ Provider-agnostic architecture
- ✓ Idempotent payment processing
- ✓ Resumable transactions
- ✓ Plugin-based adapters

The payment intent is the single source of truth for payment orchestration.
Every payment flows through the same lifecycle regardless of payer asset,
chain, or settlement wallet provider.

---

## Phase 2 — Chain Interface & Quoting Seams ✅ Shipped

Ship the blockchain interface, finality policy, and the quote/liquidity/
settlement seams later phases plug into — without redesign.

### Chain Interface

- ✓ EVM ChainClient (head, blockHash, transfers)
- ✓ Confirmation Depth & Reorg Policy

The chain client reads the chain; the finality policy decides when observed
value counts as received. Both feed the Phase 3 indexer — the contract emits
the event, the indexer consumes it, and the same reorg policy bounds what is
treated as final.

### Deposit Matching (fallback path)

- ✓ Per-intent Deposit Addresses
- ✓ Wallet Watcher
- ✓ Asset Receipt Detection

The off-chain payment-detection path: the customer transfers to a per-intent
deposit address, a watcher detects receipt, and the clearing engine settles
off-chain. **Superseded as the primary path by Phase 3's on-chain execution**
— retained for direct transfers and chains without a deployed PaymentRouter.

### Stablecoin Registry

- ✓ IDRX
- ✓ USDC
- ✓ USDT

The Stablecoin Registry defines supported settlement assets and maintains
their on-chain identities across supported blockchain networks.

### Quote & Liquidity Seams

- ✓ Rate Provider port
- ✓ Price Source port (Table, Constant-Product)
- ✓ Liquidity Router (same-asset identity, cross-asset delegation)

The off-chain quote seams. A DEX/aggregator `PriceSource` replaces the static
table in Phase 3; the executable `minOut` comes from the DEX, the oracle is a
deviation guard. The `LiquidityRouter`'s same-asset identity stays; its
cross-asset delegation moves to the Execution Engine.

### Settlement Seams

- ✓ Settlement Adapter port
- ✓ Mock Settlement Adapter
- ✓ Stablecoin (internal) Settlement Adapter

The off-chain settlement seams. Phase 3's on-chain settlement (contract →
merchant Safe) supersedes these for the contract path; the adapter port is
retained for the fallback deposit-address path and the future fiat off-ramp.

### Architecture note — two execution paths

Phase 2 shipped the **off-chain orchestration** path (deposit address →
watcher → off-chain clearing → settlement adapter). Phase 3 introduces the
**on-chain execution** path (PaymentRouter → atomic swap → settle to merchant
Safe → event → indexer → ledger). The contract path is primary for supported
assets and chains; the deposit-address path remains as fallback. The ledger
and stablecoin registry are shared by both.

---

## Phase 3 — On-Chain Execution 🚧 In Progress

Move value movement on-chain. The backend orchestrates; the contract executes.

### PaymentRouter Smart Contract

- ✓ Stateless, atomic receive → swap → settle
- ✓ Backend-signed EIP-712 order (`intentId`, `minOut`, `fee`, `merchantSafe`, `refundTo`, `deadline`)
- ✓ Hard revert on `minOut` miss — no treasury FX risk, no top-up
- ✓ Zero resting balance — the contract is never a custodian
- ✓ `payEth(order)` (native value) + `payERC20(order, permit)` via Permit2
- ✓ On-chain idempotency — `intentId` consumed, replay rejected
- ✓ Whitelisted input assets and DEX routers
- ✓ Bounded, timelocked admin — add/remove routers, set fee recipient, pause only; never redirect funds
- ☐ Deployed and verified on Base Sepolia (#29)

The contract is the **keystone**. Atomicity + hard revert is what makes
"merchant always receives the settlement asset" safe without Mayarin running a
treasury FX book. If that one property slips — async swap, resting balance, or
top-up on miss — the risk model inverts and Mayarin becomes a custodial desk
with an uncapitalized treasury. Spec it as an invariant.

### Execution Engine

- ✓ Determine whether a swap is required (same-asset → no-op)
- ✓ Select execution provider (0x, Uniswap, LiFi) — best `minOut` or first-quote by latency strategy, with failure fallback
- ✓ Fetch executable quote → `minOut`
- ✓ Build calldata for PaymentRouter
- ✓ Slippage policy — the bound lives in the quote lock, and the route asserts `expectedIn ≤ maxIn`
- ☐ MEV protection (private mempool / Flashbots Protect) — the exposure policy is
  recorded per strategy (`DEFAULT_STRATEGY_POLICIES`) and travels with the
  selection, but nothing enforces it at submission: the payer sends their own
  transaction, so private-mempool routing needs the relayer in #9

The Execution Engine is an **off-chain planner**, not an executor. It picks
the venue and builds calldata; the contract executes. Do not duplicate swap
logic in both places. Strategy selection routes by latency tolerance —
immediate (POS) vs batched

### Quote Engine

- ✓ Compose PriceOracle (reference + deviation guard) + DEX quote (executable `minOut`)
- ✓ Two-leg pricing — fiat FX leg + venue swap leg
- ✓ Lock quote → signed order with TTL and slippage bound
- ✓ Quote-signing key as a custody-adjacent trust root — Turnkey behind an `OrderSigner` port, with a rotation policy

The hard lock is the **merchant's settlement amount** (fiat → stablecoin
`minOut`). The customer's payer-asset amount is a **display estimate**, not a
custody lock — the contract swaps whatever arrives. This supersedes the
two-lock deposit model for the contract path.

### Price Oracle (adapter)

- ✓ Pyth Network (production — pull-based, on-chain verifiable), including the
  on-chain price update as its own transaction
- ✓ Chainlink (off-chain reference)

The Price Oracle is a **data dependency**, not a standalone service. The
executable `minOut` comes from the DEX quote; the oracle is a deviation guard.
Do not trust the oracle for the fill; trust the DEX, guard with the oracle.

### Clearing — Contract Execution Path

- ✓ `ExecutionPath` discriminator (`deposit-match` | `on-chain-contract`) persisted on the clearing transaction
- ✓ `ContractPaymentPlanner` port — prices both legs, locks, signs the order at `PRICE_LOCKED`
- ✓ `recordPaymentCompleted` seam — the only thing that advances a waiting contract-path payment
- ✓ Expiry fails with `QUOTE_EXPIRED` past the deadline plus an indexing-lag grace; never auto re-quotes
- ✓ `GET /payments/:id/contract-call` — signed order plus a route fetched fresh per attempt

Three decisions settled here, and they are load-bearing. **The route is fetched
at submit, not at lock** — a route goes stale faster than a price, so only the
price is locked and the number the payer sees is the lock's `payerEstimate`,
already grossed up by the slippage bound, so it is a ceiling rather than a
guess. **An expired lock fails; it never re-quotes** — a new `minOut` is a new
price, and a new price needs the payer's consent. The contract enforces the same
deadline on-chain, so a payment failed here cannot settle later. **The signed
order is persisted, the route never is** — a resumed step reuses the signature
rather than re-signing, and on-chain truth is `PaymentCompleted`.

### Indexer & Event Ingestion

- ✓ Reliable event ingestion — `SettlementIndexer` over the existing `ChainClient`, not a separate service
- ✓ Idempotent — keyed by `(chain, txHash, logIndex)`, the identity the log envelope carries
- ✓ Reorg handling and backfill — the same `policy.ts` a deposit uses, unchanged
- ✓ Reconciliation — a confirmed log matching no payment is surfaced as `chain.settlement.unmatched`

The ledger is now a **derived view** of on-chain reality, not the source of
truth. Divergence handling (missed event, reorg, indexing lag, under/over
payment) is first-class, not an edge case.

Ponder was considered and rejected. The case against an indexer in
`docs/chain.md` is about deposit addresses — derived continuously off-chain, so
no static filter covers them. The router is the opposite: one known address
emitting one event, so a pass is the same three RPC calls the wallet watcher
already makes, and the reorg policy is reused rather than reimplemented in a
second service with its own datastore.

### What Phase 3 has left

The Base Sepolia deploy (#29) is **done** — `PaymentRouter` and its
`TimelockController` are live and verified; addresses and on-chain
configuration are in [`docs/chain.md`](./chain.md).

Two open RFCs remain, and they are the same gap seen from two sides: the
deposit path detects the payer's asset and stops.

- ☐ **Treasury execution (#69)** — nothing moves a matched deposit into the
  router. The contract executes atomically, but only when someone calls it, and
  on the deposit path nobody does. Blocked on a decision rather than on code:
  a deposit address receives exactly the quoted amount, so it cannot also pay
  gas. The RFC recommends a CREATE2 forwarder — one operator key instead of one
  per address, and no pre-funding — but gross-up and pre-funding are still on
  the table, and the choice shapes the executor.
- ☐ **Ledger accounting for the deposit-path swap (#70)** — the ledger books the
  settlement asset when the payer's asset is confirmed, before any swap has run,
  so between those moments the books state a balance that does not exist while
  the asset actually held is recorded nowhere. Masked today only because Phase 2
  is watch-only; it becomes real the moment #69 lands. Needs an account for the
  held payer asset, one for the FX result, one for sponsored gas, and a stated
  rule for what "balanced" means when a posting's legs are in different assets.

Both are Phase 3 by label, and #70 is a consequence of #69 rather than an
independent workstream — the accounting hole only opens once a swap actually
runs. Phase 4 work that does not touch the deposit path is not gated on either.

---

## Phase 4 — Commerce Platform

Expose the commerce and developer surface on top of the execution layer.

### Commerce Layer

- ☐ Product Catalog (first-class module, optional)
- ☐ Prices in merchant `pricingCurrency` (IDR initially; multi-currency by design like MYR, THB)
- ☐ Carts and totals → produce Payment Intents
- ☐ Payment Links

The commerce layer is a **thin optional layer** that produces Payment Intents.
It depends on `payment-intent`, never the reverse. The contract boundary is
the **Payment Intent, not the Product** — third-party developers can build
storefronts, POS, and checkout directly on the payment primitives and skip
the catalog entirely. Making the catalog load-bearing would make Mayarin a
commerce platform (Shopify), not payment infrastructure (Stripe).

### Wallet Infrastructure

- ☐ Wallet Provider abstraction
- ☐ Managed smart-account provisioning (Safe default)
- ☐ Policy-gated signing — backend proposes within policy, never signs raw
- ☐ Connect-existing wallet (Safe, EOA) — additive, not a rewrite
- ☐ Merchant is a Safe signer (Turnkey co-signs, never sole) + merchant-controlled recovery — self-custody enforced
- ☐ PaymentRouter signer allowlists `merchantSafe` to known merchant-owned Safes (RFC #6)

Merchants never connect MetaMask, import keys, or manage seed phrases. A
managed settlement wallet is provisioned on account creation. **Safe smart
account** is the wallet shape — self-custodial, chain-enforced policy,
relayer-paid gas — giving Stripe-smooth onboarding without Mayarin becoming a
custodian. **Turnkey** is the wallet provider: an MPC policy engine that
provisions and signs for managed wallets under policy. **Tempo** is an
alternative MPC wallet-infra backend, considered as a swappable option behind
the same port.

**Custody boundary.** Self-custody is enforced, not asserted: the Safe signer
set always includes a merchant-controlled key (Turnkey is a co-signer/policy
engine, never the sole signer), and a merchant-controlled recovery path lets
the merchant rotate to self-custody on exit — _provisioned, not custodial._
The PaymentRouter signer (#6, HSM-held) only signs Orders whose `merchantSafe`
is a known merchant-owned Safe, and `feeRecipient` is a separate treasury Safe,
not a merchant Safe. The Phase 3 contract settles to `merchantSafe` today;
until #11 lands, the contract path uses a merchant-provided address (the
contract treats `merchantSafe` as opaque), so #11 makes managed onboarding
production-grade without a contract change.

### Settlement

- ☐ On-chain settlement to merchant smart account
- ☐ Fee extraction on-chain (`minOut − fee` to merchant, fee to treasury)
- ☐ Excess refund to customer (`refundTo`)

### Gas Abstraction

- ☐ Relayer / paymaster / zerodev for merchant smart-account wallets
- ☐ Merchant never needs native gas to receive or withdraw settlement

A merchant whose wallet starts empty cannot move their stablecoin. Gas
abstraction is required for the "no wallet, no seed phrase" experience to
function.

Moved here from Phase 3 (#9). It is not only infrastructure: `payERC20` binds
the Permit2 `owner` to `msg.sender`, so a relayer cannot submit on the payer's
behalf without a contract change. On Base Sepolia a redeploy is a normal
iteration, so this does not block #29 — but `verifyingContract` is part of the
EIP-712 domain, so a new address invalidates every previously signed order.
Settle #9 before mainnet, and before the address escapes into anything external
(a published SDK, a merchant integration, a deployed backend).

### Notifications

- ☐ Webhook delivery to merchant integrations (signed, retry, idempotent)
- ☐ Real-time payment status

### Developer SDK

- ☐ One Client SDK (TypeScript) — commerce, payment, QR helpers
- ☐ POS and Merchant presets, not separate packages
- ☐ REST API
- ☐ Webhooks

### Merchant Dashboard

- ☐ Product and catalog management
- ☐ Payment explorer and transaction timeline
- ☐ Settlement status
- ☐ Merchant analytics
- ☐ Overview
- ☐ Orders
- ☐ Wallets
- ☐ Customers
- ☐ Analytics
- ☐ Payment Links
- ☐ Developers
- ☐ Settings

So we have this feature for our product

Commerce
├── Overview
├── Products
├── Orders
├── POS Checkout
├── Payment Links

Payments
├── Transactions
├── Settlement
├── Wallet
├── Refunds (future)

Analytics
├── Revenue
├── Payment Analytics
├── Asset Analytics
├── Customer Insights

Developers
├── API Keys
├── Webhooks
├── SDK
├── Event Logs

The dashboard is one first-party application built on the same primitives any
third-party developer can use.

### Compliance

- No KYC for now or using didit later.
- ☐ Immutable audit trail (ledger + on-chain events)

Even crypto-only, Mayarin has compliance surface — stablecoin issuers can
freeze, and screening is expected by acquirers, issuers, and regulators. The
architecture makes compliance cheap, not absent.

---

## Phase 5 — Multi-Asset, Multi-Chain

Expand the execution surface across assets, venues, and chains.

### Payer Assets

- ☐ ERC-20 payer assets via Permit2 (USDT, IDRX, other stablecoins)
- ☐ Native assets beyond ETH
- ☐ Asset whitelist governance

### Execution Venues

- ☐ Uniswap, 0x Protocol
- ☐ Strategy selection by latency tolerance and MEV exposure
- ☐ Smart routing — liquidity, fee, and network optimization

### Blockchain Networks

- ☐ Additional EVM chains
- ☐ Solana
- ☐ TRON

Cross-chain payment (customer pays on chain A, merchant settles on chain B)
requires a bridge with its own trust model. It is **not** handled by a single
PaymentRouter deployment — design the cross-chain path explicitly when reached.

### Wallet Providers

- ☐ Turnkey (MPC policy engine — the wallet provider)
- ☐ Tempo (MPC wallet infra — alternative backend, considered)
- ☐ Connect-existing (Safe, EOA)

### Settlement Assets

- ☐ Configurable settlement asset per merchant
- ☐ Settlement policy (single default; split settlement as additive extension)

Each provider implements a common interface, allowing Mayarin to remain
provider-agnostic while supporting multiple execution paths.

---

## Phase 6 — Scale & Open Infrastructure

Harden and open the platform.

### Treasury

- ☐ Fee recipient and gas funding only — **not** a liquidity/FX book
- ☐ Treasury dashboard
- ☐ Reconciliation and reporting

If treasury ever funds slippage gaps or holds inventory to make conversions,
Mayarin becomes a custodial FX desk. Keep treasury minimal; conversions happen
on-chain via DEX.

### Platform

- ☐ Observability and audit logs
- ☐ Event streaming
- ☐ High availability and multi-region deployments

### Open Extension

- ☐ Adapter marketplace
- ☐ Custom provider SDK
- ☐ Plugin SDK

### Future — Stablecoin → Fiat Off-Ramp

- ☐ Off-ramp to local bank (explicit, separate custody/trust model)

The off-ramp is the part of the merchant journey that necessarily involves a
custodial hop (an acquirer holds stablecoin transiently). It is a deliberate
later phase with its own regulatory perimeter, not an MVP assumption.

---

# Long-term Vision

Mayarin aims to become programmable crypto commerce infrastructure.

```
                Integrate Once

                      │
                      ▼

                   Mayarin

      Payment Orchestration Layer

      • Payment Intent
      • Quote Engine
      • Execution Engine
      • PaymentRouter (on-chain)
      • Double-entry Ledger (derived)
      • Wallet Infrastructure

                      │

      ┌───────────────┼────────────────┐

      ▼               ▼                ▼

 Blockchain       DEX Liquidity    Wallet
 Networks                          Providers
```

One SDK.

One API.

Any payer asset.

Stablecoin settlement.

Developers integrate once while Mayarin orchestrates quoting, execution,
settlement, accounting, and wallet provisioning behind the scenes. The
merchant prices in their local currency and receives their chosen stablecoin;
the customer pays with whatever asset they hold.

---

# Hackathon Alignment

## Track 1 — Payments & Financial Infrastructure

- Payment orchestration
- On-chain settlement
- Stablecoin commerce
- Merchant infrastructure
- POS infrastructure
- Treasury management

---

## Track 2 — Web3 Applications & AI

- Stablecoin payments
- Crypto-to-crypto payments
- On-chain payment routing
- Modular blockchain infrastructure
- Smart payment execution
- Multi-venue liquidity routing

---

## Related

- [Architecture](./architecture.md)
- [Vision & Rationale](./vision.md)
- [Chain Layer](./chain.md)
- [Liquidity Routing](./liquidity-routing.md)
- [Stablecoin Registry](./stablecoin.md)

[← Documentation index](./README.md)
