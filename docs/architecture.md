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

**Three execution paths** share the same intent, clearing engine, ledger, and
stablecoin registry. They are chosen **per payer, not per deployment** — none is
a fallback for another, because they serve different payers:

| Path                | The payer                                  | How it is funded                                       |
| ------------------- | ------------------------------------------ | ------------------------------------------------------ |
| `on-chain-contract` | a human or app that can _connect_ a wallet | `PaymentRouter` receives, swaps and settles atomically |
| `deposit-match`     | anyone who can only send a plain transfer  | a per-intent deposit address, watched                  |
| `x402`              | a program                                  | one signed EIP-3009 authorization, broadcast           |

The contract path needs the payer to connect a wallet, because it submits
calldata and because the signed order's `refundTo` must be known before the payer
pays. A payer who scans a QR or pastes an address into a custodial withdrawal can
only do a plain transfer, so deposit-matching is the only path open to them. An
`x402` payer never sees an address at all — the payment is identified by the
authorization nonce rather than by where the money landed, which is why that path
derives no deposit address.

Anything branching on how a payment is funded must say which of the three it
means. Two named predicates exist for exactly that (`usesDepositAddress`,
`awaitsFacilitatorSettlement`) and replaced a `!== "on-chain-contract"` phrasing
that was right with two paths and silently wrong with three. See
[Agent Payments](./x402.md).

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

          PaymentRouter.sol        (contract path — atomic receive/swap/settle)
          Deposit address          (deposit-match path — watched)
          Facilitator              (x402 path — broadcasts one authorization)

                     │

              Execution Engine     ── 0x, Uniswap v3/v2, LiFi (pluggable)

                     │

────────────────────────────────────────

            Wallet Provider         ── Turnkey (MPC policy engine)
                                    ── Safe (self-custodial account shape)

                     │

────────────────────────────────────────

              Indexer               ── observes PaymentCompleted
                                    ── via the settlements subgraph, or the chain

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

### x402 path _(for programs)_

An agent asks for a gated resource, is told the price in a header, signs one
authorization, and is served. It never registered with anyone.

```
Agent requests a gated resource, unpaid

↓

Resource priced through the quote engine, once per accepted rail

↓

402 Payment Required     terms in the PAYMENT-REQUIRED header

↓

Agent signs             EIP-3009 authorization, exact amount

↓

Facilitator             verifies, then broadcasts

↓

Settlement              read back off the chain and matched to this payment

↓

Clearing Engine → Double Entry Ledger → resource served
```

The price is honoured for a window **derived from the quote lock**, never
configured beside it, so the two numbers cannot drift apart. No deposit address
is derived: the payment is identified by the authorization nonce.

A payer that does not hold the merchant's settlement asset is still served —
the authorization lands at the operator and an **exact-output** swap delivers
exactly the invoice to the merchant, bounded by what the payer signed. See
[Agent Payments](./x402.md).

---

## Monorepo Structure

Implemented and shipped (`✓`), planned for later phases (`·`):

```
apps/

  ✓ api/                 payment clearing API (Hono) — payments, commerce, x402, MCP
  ✓ chain-worker/        wallet watcher, settlement indexer, deposit-path executor
  ✓ checkout-ui/         buyer-facing SPA, served by the API from its own image
  ✓ dashboard-api/       merchant dashboard API (Hono + Effect)
  ✓ dashboard/           merchant dashboard UI (Astro + React)
  ✓ pay-proxy/           restricted buyer-origin proxy for the hosted surfaces
  ✓ demo/                Parahyangan Supply reference storefront
  ✓ x402-merchant/       reference merchant app gating its own endpoint over x402
  ✓ docs/                interactive OpenAPI + SDK documentation (docs.mayarin.xyz)
  ✓ landing/             marketing site and pitch deck
  ✓ blog/ studio/        editorial site and content studio

packages/

    core/                pure domain — ports only, no Postgres, no HTTP, no vendor

      ✓ clearing/         state machine, engine, fees, rate/liquidity ports
      ✓ ledger/           double-entry accounts, entries, balances
      ✓ payment-intent/   immutable intents, their lifecycle, and ExecutionPath
      ✓ qr-parser/        EMVCo TLV decoder + QRIS profile
      ✓ settlement/       SettlementAdapter port (with mode) and registry
      ✓ chain/            chain ports, deposit types, confirmation policy, watcher
      ✓ stablecoin/       StablecoinRegistry port and value types — the admissible set
      ✓ auth/             merchant/user/session domain, PasswordHasher port
      ✓ compliance/       audit trail — reads clearing/ledger/chain, reconciles them, ScreeningProvider port
      ✓ catalog/          products, prices per currency, stateless carts → payment intents
      ✓ invoicing/        numbered invoices, lifecycle, due dates, outstanding balance
      ✓ notifications/    signed webhook delivery, retries, idempotent redelivery
      ✓ wallet/           WalletProvider port — managed Safe, connect-existing, passkey key
      ✓ quote/            quote engine — guarded composition, lock, EIP-712 order assembly + OrderSigner port
      ✓ execution/        execution engine — SwapVenue port, planner, venue selection, exact-output route port
      ✓ x402/             protocol types, exact/EVM scheme, facilitator port, resource
                          registry, payables, replay key, cross-asset port, rail ranking

    contracts/

      ✓ payment-router/   PaymentRouter.sol, TimelockController, DepositForwarderFactory
      ✓ abis/             generated ABI package shared by the providers

    providers/            adapters — the only place a vendor SDK appears

      ✓ mock/             MockSettlementAdapter
      ✓ evm/              viem ChainClient, HdDepositAddressDeriver, cross-asset settler
      ✓ viem-chains/      chain definitions keyed by ChainId
      ✓ stablecoin/       StablecoinSettlementAdapter (internal)
      ✓ argon2/           Argon2PasswordHasher
      ✓ turnkey/          order signer, wallet provider (sub-org, policy, Safe),
                          merchant key provider (passkey-only sub-org)
      ✓ x402-local/       local facilitator — broadcasts the payer's authorization,
                          probes token capability, reads settlement back off the chain
      ✓ subgraph/         settlement source and rail observations, read from The Graph
      ✓ swap-0x/          ZeroExSwapVenue + ZeroExRouteSource — price read + exact-output route
      ✓ swap-uniswap/     UniswapSwapVenue + UniswapRouteSource — QuoterV2 + exactOutputSingle
      ✓ swap-uniswap-v2/  constant-product venue for chains with no v3 deployment
      ✓ swap-lifi/        LifiSwapVenue — LiFi quote, same-chain, price-only
      ✓ pyth/             PythPriceOracle — Hermes reference read for the deviation guard
      ✓ fx/               FxRatesPriceOracle — the fiat leg no venue can price
      ✓ coinbase/         CoinbasePriceOracle — public ticker, covers what Pyth's grant denies
      ✓ chainlink/        ChainlinkPriceOracle — AggregatorV3 reference read via viem
      · zerodev/          gas abstraction / paymaster / relayer (#9)

  ✓ db/                   Drizzle schema, migrations, Postgres repositories
  ✓ http/                 shared HTTP concerns for both API surfaces
  ✓ sdk/                  TypeScript client SDK — commerce, payment, QR, webhooks, x402
  ✓ embed/                embeddable checkout web component
  ✓ subgraph/             the settlements subgraph source, schema, and manifest
  ✓ shared/               money, assets, ids, errors, events, clock

plugins/

  ✓ woocommerce/          WooCommerce plugin with signed webhook verification
```

The one-way dependency rule is what the layout exists to protect:

- **`core/*` depends on nothing concrete.** No Postgres, no Hono, no viem, no
  Turnkey. Adding such a dependency breaks the property.
- **`db`** — the domain packages define repository _ports_; their Drizzle
  implementations live here. Keeping them out of `core` is what lets a domain
  package be tested, and swapped, without a database.
- **The reference in-memory fakes ship with their port**, in each core package's
  segregated `/testing` subpath (`@mayarin/<pkg>/testing`) — outside domain
  `src/`, which stays pure. That is what makes a domain package testable without
  a database _and_ without depending on `@mayarin/db`, which would form a
  `core ↔ db` cycle and break Turbo's topological `^typecheck` caching.
- **`apps/api/src/container.ts` is the composition root** — the only file that
  knows which concrete adapters this deployment runs.

The chain layer respects the same boundary one-way: `packages/core/chain` knows
the clearing engine's seam (`recordAssetReceived`) only as an injected sink, so
it never imports `@mayarin/clearing`. The composition root in `apps/api` is the
only place that wires a real `WalletWatcher` to the engine. See
[Chain Layer](./chain.md).

A [Stablecoin Registry](./stablecoin.md) holds which stablecoins a deployment
admits and where each lives on-chain, unioning `SETTLEMENT_ASSETS` with
`CHAIN_ASSETS`. It is the single source the watcher pairs, the intent
admissibility check, and (later) the execution engine all read from.

The [Quote / Liquidity](./liquidity-routing.md) ports the clearing engine locks
prices through are the seams the execution layer plugged into, and did without
redesign: a DEX `PriceSource` serves the executable `minOut` where the quote
layer is on, an oracle is the deviation guard, and the `LiquidityRouter`'s
same-asset identity stays. The static `EXCHANGE_RATES` table remains the default
for a deployment with `QUOTE_ENABLED=false`. Swap **execution** happens on-chain
— in `PaymentRouter` on the contract path, and in an exact-output swap sent by
the operator on the cross-asset x402 path. The router prices; it never executes.

The [Settlement Engine](./settlement.md) settles a payment through a
`SettlementAdapter` whose `mode` says whether value leaves Mayarin
(`"external"`) or stays as a merchant balance (`"internal"` — the engine credits
`MERCHANT_HOLDING`, a liability the merchant withdraws on-chain). On-chain
settlement supersedes the off-chain adapters wherever `PaymentRouter` executes —
the contract path always, and the deposit path once a treasury executor is wired.
The adapter port is retained for a deployment with no executor and for the future
fiat off-ramp. On the x402 path the merchant is paid directly by the
authorization, or by the exact-output swap when the payer's asset differs.

---

## Technology Stack

### Backend

- Bun
- TypeScript
- Hono

### Blockchain

#### Networks

`CHAIN_IDS` in `packages/core/chain/src/types.ts` is the list; widening it is
what adds a network. What a deployment actually runs is narrower — a chain needs
an RPC URL, assets, and (for the contract path) a deployed `PaymentRouter`. See
[Chain Layer → Supported chains](./chain.md#supported-chains).

- `base`, `base-sepolia` — primary; contracts deployed and verified on Sepolia
- `ethereum-sepolia`
- `arbitrum`, `arbitrum-sepolia`
- `arc-testnet` — Circle's chain; the first whose native asset is not ETH
- `robinhood-testnet` — an Orbit chain
- Solana, TRON _(future, non-EVM — a different signing and address model)_

Cross-chain payment (payer on chain A, merchant settled on chain B) needs a
bridge with its own trust model. It is **not** what a single `PaymentRouter`
deployment does.

#### SDK

- Viem
- Wagmi

#### Wallet Infrastructure

- Turnkey (MPC policy engine — the wallet provider)
- Safe (smart-account wallet shape, self-custodial)
- Circle Agent Stack contract accounts, as **payers** — an EIP-1271 signer the
  token accepts, not a wallet Mayarin provisions

Tempo was considered as an alternative MPC backend behind the same port and is
not wired.

The backend never holds user keys. Turnkey provisions and signs for managed
wallets under policy; the merchant's wallet is a self-custodial Safe smart
account. The "reveal private key" feature is disabled; layered signing security
is added later. For now, Turnkey is sufficient.

**Custody boundary — enforced, not asserted.** "Self-custodial" requires the
merchant to _control_ the Safe, not merely be its beneficiary. The Safe signer
set always includes a merchant-controlled signer (merchant passkey or device
key, provisioned via Turnkey); Turnkey is a co-signer and policy engine, never
the sole signer. Mayarin-via-Turnkey cannot move merchant funds without the
merchant. A merchant-controlled recovery path lets the merchant add their own
signer or rotate to full self-custody on exit — _provisioned, not custodial._
This is what separates Mayarin from a custodian.

- **Merchant is a Safe signer.** Turnkey provisions the Safe with a
  merchant-controlled key in the signer set. The backend proposes transactions
  within policy; Turnkey enforces; the merchant co-signs. No key the backend
  holds can move merchant funds alone.
- **Merchant-controlled recovery.** The merchant can add their own signer or
  recover the Safe without Mayarin, so Mayarin cannot lock a merchant out.
- **Signer allowlists `merchantSafe`.** The PaymentRouter signer (RFC #6,
  HSM-held) only signs an `Order` whose `merchantSafe` is a known
  merchant-owned Safe. The contract trusts the signer; the signer trusts only
  known merchant Safes — the off-chain defense against a compromised signer
  redirecting settlement (see `packages/contracts/payment-router/README.md`).
- **Fee Safe ≠ merchant Safes.** `feeRecipient` (Mayarin revenue) is a separate
  treasury Safe, never a merchant Safe. The contract splits `minOut − fee`
  (merchant) and `fee` (treasury) into separate buckets; wallet infra keeps
  them separate too.
- **Sequencing.** The Phase 3 contract settles to `merchantSafe`, and Phase 4
  (#11) added the ways one comes to exist: connect-existing, where the merchant
  links an address and proves control by signature; a passkey-held key, created
  in a Turnkey sub-organization Mayarin is not a user of, for the merchant who
  owns no wallet at all; and managed provisioning, where Mayarin deploys a Safe
  with the merchant already an owner at threshold 1. A merchant who sets no
  settlement address is paid at that Safe. The contract needed no change —
  `merchantSafe` is opaque to it. See [wallets](./wallet.md); gas sponsorship for
  a wallet with no balance is #9 and is not yet built.

#### Liquidity

- Uniswap v3 (`QuoterV2` + `SwapRouter02`, exact-output)
- Uniswap v2 (constant product, for chains with no v3 deployment)
- 0x API
- LiFi (quote only — no exact-output API)

#### Price Oracles

- Pyth Network (pull-based, on-chain verifiable)
- Chainlink (off-chain reference, `AggregatorV3` via viem)
- FX rates (the fiat leg no venue can price)
- Coinbase public ticker (covers pairs a Pyth grant denies)

Name every source in `QUOTE_ORACLE` and `QUOTE_ORACLE_FALLBACKS`; one with no
feed for a pair drops out of that read rather than failing it, which is what lets
three partial sources cover a matrix none of them covers alone.

#### Gas Abstraction

- ZeroDev (relayer / paymaster)

A merchant whose wallet starts empty cannot move their stablecoin. Gas
abstraction is required for the "no wallet, no seed phrase" experience.

#### Agent Payments

- x402 protocol v2, EIP-3009 `transferWithAuthorization`, EIP-712 typed data
- Local facilitator (`packages/providers/x402-local`) — Mayarin broadcasts
- The Graph — the settlements subgraph the rail statistics are read from
- MCP, over the same rail, at `POST /x402/mcp`

#### Settlement Assets

- USDC (primary)
- USDT
- EURC

Which stablecoins a deployment admits is market data, not code: it lives in the
`stablecoins` key of `market_config`. See
[Stablecoin Registry](./stablecoin.md) and [Configuration](./configuration.md).

### Storage

- PostgreSQL
- Drizzle ORM

### Infrastructure

- `apps/chain-worker` — a **separate process**. The wallet watcher, settlement
  indexer and deposit-path executor run here, not in the API. `bun run dev` alone
  never settles a deposit-match payment.
- Postgres `LISTEN`/`NOTIFY` on the payment write, fanned out over SSE — the
  hosted checkout's live status, with no broker.

No job queue is wired. Stalled payments are recovered by resuming them on startup
and on demand (`ClearingEngine.resumeStuck`); a queue would turn that into a
background worker without changing the engine, since resumption is already a pure
function of persisted state.

### Validation

- Zod

### Deployment

- Docker
- Railway — `core-api`, `dashboard-api`, `chain-worker`, Postgres
- Cloudflare Workers/Pages — dashboard, pay proxy, demo, docs, landing

See [Deployment Targets](./deployment.md).

---

## Related

- [Chain Layer](./chain.md)
- [Agent Payments (x402)](./x402.md)
- [Stablecoin Registry](./stablecoin.md)
- [Clearing Engine](./clearing-engine.md)
- [Double Entry Ledger](./ledger.md)
- [Configuration](./configuration.md)
- [Development](./development.md)

[← Documentation index](./README.md)
