[← Documentation index](./README.md)

---

# Roadmap

Mayarin is **a programmable clearing layer for humans, applications, and
autonomous agents**. Merchants price in their local currency and settle in a
stablecoin; the payer brings any supported asset. Mayarin bridges the two without
requiring merchants to understand blockchain.

The phases below expand the layer along one axis at a time. An autonomous agent
is a payer class rather than a product line — see [vision](./vision.md#the-payer-class)
and [Agent Payments](./x402.md).

**Phases 1 through 4 are shipped; Phase 5 is partly shipped** — the agent rail,
the indexing layer, the venues and the additional chains are live, while Solana,
TRON and split settlement are not.

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

### Architecture note — the execution paths

Phase 2 shipped the **deposit-matching** path (deposit address → watcher →
clearing → settlement adapter). Phase 3 added the **on-chain execution** path
(PaymentRouter → atomic swap → settle to merchant Safe → event → indexer →
ledger). Phase 5 added the **x402** path (one signed authorization → facilitator
broadcast → settlement read back off the chain).

There are now three, and **none is a fallback for another** — they are chosen per
payer, because they serve different payers. The contract path needs a connected
wallet; deposit-matching is the only path open to someone who can only send a
transfer; an x402 payer is a program that never sees an address. The intent,
clearing engine, ledger and stablecoin registry are shared by all three. See
[Architecture](./architecture.md#system-architecture).

---

## Phase 3 — On-Chain Execution ✅ Shipped

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
- ✓ Deployed and verified on Base Sepolia (#29)

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

### What Phase 3 shipped

`PaymentRouter` and its `TimelockController` are live and verified on Base
Sepolia, alongside a `DepositForwarderFactory`; addresses and on-chain
configuration are in [`docs/chain.md`](./chain.md).

**Both execution paths settle end to end, on-chain and through the API.**

- ✓ **Contract path** — the payer connects a wallet and submits the router call
  themselves; the settlement indexer (#8) reads `PaymentCompleted` back.
- ✓ **Deposit path** — the payer makes a plain transfer to a per-intent address,
  and a treasury executor (#69) converts it. A deposit address receives exactly
  the quoted amount and so cannot pay its own gas; a **CREATE2 forwarder**
  removes the problem rather than paying for it, with one operator key instead
  of one per address and no pre-funding.
- ✓ **Both payer assets** — native ETH, swapped through Uniswap, and a
  same-asset ERC-20 deposit that skips the DEX entirely.
- ✓ **The books describe what is actually held** (#70). Between receipt and swap
  the deposit path holds the payer's asset, not the settlement asset, and
  `PAYER_ASSET_HELD` / `PAYER_ASSET_OBLIGATION` say so. `FX_RESULT` names the
  difference between the locked price and the swap achieved — a credit when the
  swap beat the lock, a debit when it fell short — and `GAS_EXPENSE` books what
  the operator paid.

### What Phase 3 deliberately leaves open

- **Gas abstraction (#9) is Phase 4**, not an omission here. `payERC20` binds
  the Permit2 owner to `msg.sender`, so a relayer cannot submit for the payer.
  That is a contract change, and it must land before mainnet or before this
  address escapes into an SDK or a merchant integration — `verifyingContract` is
  part of the EIP-712 domain, so a new address invalidates every previously
  signed order.
- **`DepositForwarder` has had static analysis but no adversarial review.**
  Slither and Mythril are clean (see the contract package README); a review pass
  by someone other than the author is not done, and `PaymentRouter` had one.
- **Deploying the factory pins `INIT_CODE_HASH`.** Every deposit address derives
  from it, so a bytecode change afterwards leaves the factory unable to deploy to
  addresses already issued. Finalize, then deploy, then derive.
- **Only top-level native transfers are detected.** ETH moved by a contract — an
  exchange sweeping through a router — is an internal transaction no block body
  shows. `trace_block` sees those and is not on every provider tier.

---

## Phase 4 — Commerce Platform ✅ Shipped

Expose the commerce and developer surface on top of the execution layer.

### Commerce Layer

- ☑ Product Catalog (first-class module, optional) — `packages/core/catalog`
- ☑ Prices per currency (IDR and MYR proven; a product carries one amount per currency)
- ☑ Carts and totals → produce Payment Intents
- ☑ Payment Links — fixed, open-amount, and catalog-backed
- ☑ Hosted checkout + static merchant QR (`/checkout`)
- ☑ `Idempotency-Key` on intent, link and cart-checkout creation
- ☑ `merchantReference` on the intent, indexed and filterable

Prices are entered per currency rather than converted from a base price at read
time. Converting on read would make a displayed price move with an FX feed
between the moment a buyer reads it and the moment they pay; the FX conversion
that does happen belongs to the liquidity router at quote time, where it is
locked and auditable.

Carts are **stateless**. Lines come in, one Payment Intent goes out, and the
lines survive only as an immutable snapshot in the intent's metadata. A stored,
mutable cart could move the price after the clearing engine reached
`PRICE_LOCKED`, which the engine's invariants say cannot happen.

Status on the hosted checkout is live rather than polled: Postgres `NOTIFY` on the
payment write, fanned out over SSE (#13).

The commerce layer is a **thin optional layer** that produces Payment Intents.
It depends on `payment-intent`, never the reverse. The contract boundary is
the **Payment Intent, not the Product** — third-party developers can build
storefronts, POS, and checkout directly on the payment primitives and skip
the catalog entirely. Making the catalog load-bearing would make Mayarin a
commerce platform (Shopify), not payment infrastructure (Stripe).

### Wallet Infrastructure

- ☑ Wallet Provider abstraction — `packages/core/wallet`, Turnkey behind it
- ☑ Managed smart-account provisioning (Safe default), resumable and idempotent
- ☑ Policy-gated signing — the port proposes from a closed union and never takes bytes; the Turnkey policy binds a non-root signer to that merchant's Safe
- ☑ Connect-existing wallet (Safe, EOA) — additive, not a rewrite
- ☑ Passkey-held merchant key — a merchant who owns no wallet gets one only their authenticator can use, so provisioning no longer presupposes MetaMask
- ☑ Merchant is a Safe signer (Turnkey co-signs, never sole) + merchant-controlled recovery — self-custody enforced, and executed on Base Sepolia
- ☑ PaymentRouter signer allowlists `merchantSafe` to known merchant-owned Safes (RFC #6) — `WalletGuard`, on the contract and deposit paths alike
- ☑ Settlement address defaults to the managed wallet on that chain, so a provisioned merchant is payable without finding a settings field
- ☑ `GET /settings` reports the address the signer will actually use, so "chosen nothing" is not reported as "cannot settle"
- ☑ Settlement balance read from the chain — `GET /wallets/balance`, settlement asset plus the gas asset, an unconfigured token omitted rather than zeroed
- ☑ Withdrawal — `POST /wallets/withdraw`, to one of the merchant's own verified wallets only. The sub-org key sends `execTransaction` to the Safe (the destination its policy already checks) and the Safe accepts it pre-validated from an owner; the deployer funds that one submission, which is the slice of #9 this needed

The wallet **backend** is done. What is left is browser work and belongs to the
dashboard, not here (Merchant Dashboard → Wallets, below):

- driving the passkey ceremony — `navigator.credentials.create`, then a Turnkey
  request stamped by that passkey to sign the verification challenge
- registering a second authenticator, which Turnkey adds to the existing
  sub-organization on the authority of the passkey the merchant already has
- a form for the settlement address, which now has a sensible default to show

A merchant who has lost their only passkey is not stranded by that gap: the Safe
still has Mayarin as an owner at threshold 1, bounded by policy to transactions
addressed to that Safe.

Merchants never connect MetaMask, import keys, or manage seed phrases — a key
bound to their passkey is created for them, and the Safe is provisioned around
it once they have signed one message with it. **Safe smart account** is the
wallet shape — self-custodial, chain-enforced policy,
relayer-paid gas — giving Stripe-smooth onboarding without Mayarin becoming a
custodian. **Turnkey** is the wallet provider: an MPC policy engine that
provisions and signs for managed wallets under policy. **Tempo** is an
alternative MPC wallet-infra backend, considered as a swappable option behind
the same port.

**Custody boundary.** Self-custody is enforced, not asserted: the Safe signer
set always includes a merchant-controlled key (Turnkey is a co-signer/policy
engine, never the sole signer), and a merchant-controlled recovery path lets
the merchant rotate to self-custody on exit — _provisioned, not custodial._
The PaymentRouter signer (#6, HSM-held) signs either an authenticated, audited
external payout instruction or a verified managed-wallet fallback, and
`feeRecipient` is a separate treasury Safe. `WalletGuard` enforces those
source-specific rules, refuses treasury payout destinations, and prevents a
deployment from booting when `TREASURY_ADDRESS` is already somebody's merchant
wallet. The contract treated `merchantSafe` as opaque throughout, so #11 made
managed onboarding production-grade without a contract change.

Where the boundary honestly still rests on a vendor: the passkey key lives in a
Turnkey sub-organization Mayarin is not a user of, so "Mayarin cannot sign with
the merchant's own key" is Turnkey's authorization model rather than anything in
this repository. See `docs/wallet.md`.

### Settlement

- ☑ On-chain settlement to merchant smart account — `PaymentRouter` transfers the
  settlement asset to `merchantSafe`
- ☑ Fee extraction on-chain (`minOut − fee` to merchant, fee to the treasury
  `feeRecipient`, separate buckets)
- ☑ Excess refund to customer — settlement-asset excess above `minOut` as
  `PaymentCompleted.refundAmount`, and input the router did not consume as a
  separate `ResidueRefunded`, both to `refundTo`
- ☑ Refund API — `POST /payments/:id/refund` and refund summaries. Idempotent:
  a repeated key returns the refund it made rather than issuing a second one, and
  an omitted amount refunds everything still refundable
- ☐ Multi-recipient settlement splitting — the one pending `Order` struct change
  (#12). It stands alone rather than waiting to be batched with #9

A refund on the **deposit path** is a transfer the operator sends. A refund on
the **contract path** needs the operator to move value it does not hold, which is
why it waits on gas (#9) rather than on #11.

### Gas Abstraction

- ☐ Relayer / paymaster / zerodev for merchant smart-account wallets
- ☐ Merchant never needs native gas to **withdraw** settlement

A merchant handed a Safe full of stablecoin and told to acquire native gas
before they can touch it has not been onboarded. Gas abstraction is the floor
under the managed wallet (#11), which is where the differentiation actually is.

**Receiving already needs no gas** — `PaymentRouter` transfers the settlement
token _to_ `merchantSafe`, and receiving an ERC-20 costs the recipient nothing.
The goal is only the withdrawal, and only once the wallet is one Mayarin
provisioned: `merchants.settlement_address` is merchant-supplied today, and how
a merchant moves their own money is their business.

**Payer-side gasless is out of scope, by decision.** Payers pay their own gas.
Nobody is stranded by that: a payer holding only tokens and no native asset pays
through deposit-match, where the sending wallet or exchange covers gas, and
`payEth` needs no sponsorship at all since a payer paying in ETH holds ETH.

**No contract change, and therefore no redeploy.** An earlier reading of #9 held
that `payERC20` binding the Permit2 `owner` to `msg.sender` blocks a relayer.
That is true only of the classic pattern — an EOA payer signs a permit off-chain
and someone else submits — which dropping payer-side gasless removes the need
for. `verifyingContract` stays as deployed and every previously signed order
stays valid. The only pending struct change on the board is the multi-recipient
split (#12), and it now stands alone rather than waiting to be batched.

**Prerequisite:** an EOA cannot be sponsored — it has no paymaster to attach, so
gas must come from its own balance. The managed wallet in #11 must be a smart
account (Safe with a relayer, or ERC-4337). A pure MPC-signed EOA kills this.

### Notifications

- ☑ Webhook delivery to merchant integrations (signed, retry, idempotent) — `packages/core/notifications`, driven off the clearing event log
- ☑ Merchant-owned webhook endpoints and delivery inspection in the dashboard API
- ☑ Real-time payment status — SSE on the hosted checkout, backed by Postgres `NOTIFY`

### Developer SDK

- ☑ One Client SDK (TypeScript) — merchant commerce, payment, QR helpers
- POS support is excluded from the current SDK scope; the merchant preset ships alone
- ☑ REST API — `apps/api` (payments) and `apps/dashboard-api` (merchant surface)
- ☑ Webhooks

### Merchant Dashboard

- ☑ Product and catalog management — real `/catalog/products`, create and edit
- ☑ Payment explorer and transaction timeline
- ☑ Settlement status — `/settlements`, the booked amounts plus what the chain
  reported, per payment
- ☑ Merchant analytics, derived from the payments page and honest about the window
- ☑ Overview
- ☑ Payment Links — fixed, open and catalog-backed, with the hosted-checkout QR
- ☑ Counter sale ("Take payment") — mints one payment from a link and shows its
  EIP-681 deposit code, which a wallet scans as a transfer rather than as a URL,
  plus an indicative price in every accepted payer asset
- ☑ Wallets — connect an existing address, prove control by signature, provision
  the managed Safe. What is still missing is the browser half of the **passkey**
  ceremony (`navigator.credentials.create`, then a Turnkey request stamped by
  that passkey); the other two paths are complete
- ☑ Settings — settlement asset, accepted assets, settlement address, merchant
  profile, and the change history behind them
- ☑ Developers → Webhooks: endpoints, secret rotation, delivery inspection, replay
- ☑ Orders — `/orders`, a derived read of cart-bearing or referenced payment
  intents. Line items, the linked customer, and the payment status — no
  fulfillment state, no second state machine; an order is the commerce view of
  a payment, and its detail is the payment detail
- ☑ Customers — `/customers`, a merchant-managed directory linked to orders via
  `metadata.customerId` stamped at intent creation. CRUD plus a detail view:
  lifetime value (sum of `COMPLETED` amounts) and the orders taken for them.
  No payer-address auto-derivation — a deposit-match transfer has no sender
- ☑ Developers → API keys: bearer-token access to the dashboard API, with
  per-key permissions (a subset of the merchant's own). The secret is shown
  once at creation; listings carry only a prefix. A bearer request is exempt
  from CSRF (it is not auto-sent cross-origin) and reaches exactly the surfaces
  its permissions allow
- ☑ Developers → Event logs: `/event-logs`, a unified timeline of clearing,
  settlement, and webhook events in one derived read. Three bounded `LIMIT n`
  queries merged in JS — no table of its own, since the three sources are
  already append-only. A webhook row carries no `intentId` in v1
- ☑ Developers → SDK — `@mayarin/sdk` provides merchant commerce, payment,
  QR helpers and webhook verification. Publication remains a release decision;
  POS-specific behavior is excluded from the current scope

Every surface above reads a real endpoint. The dashboard carries no fixture data:
a merchant seeds an account, signs in, prices a product, mints a link, and the
buyer who opens that link mints a Payment Intent — with no script anywhere on the
path.

A payment link freezes a merchant snapshot, which needs city and country, so the
merchant record carries them (migration 0019) and the settings surface asks for
them. The link route refuses without them rather than freezing a blank into every
payment it takes.

The payments and settlement views poll while anything on them can still move and
stop once nothing can. The hosted checkout has a real event stream (#13); the
merchant side does not, and a poll that switches itself off is the honest version
of live rather than a pretence of one.

The dashboard's surfaces, as they are grouped:

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
- ☑ Immutable audit trail (ledger + on-chain events)
- ☑ Audit query interface, merchant-scoped, with ledger ↔ chain reconciliation
- ☑ Screening port with a disabled default (`NOT_SCREENED`, never `CLEAR`)

Even crypto-only, Mayarin has compliance surface — stablecoin issuers can
freeze, and screening is expected by acquirers, issuers, and regulators. The
architecture makes compliance cheap, not absent.

The audit trail writes nothing: it joins records that are already append-only —
clearing events, ledger postings, confirmed chain logs — so there is no second
copy of the truth to drift. See [Compliance](./compliance.md).

Not done: freeze handling, an export format, and a retention policy.

---

## Phase 5 — Agent Payments, Multi-Asset, Multi-Chain ◐ Partly shipped

Widen who may be a payer, and what they may pay with, on how many chains.

### Agent payments (x402) — ✅ Shipped, off by default

An autonomous agent is a **payer class, not a product line**. It reaches the same
clearing engine, the same ledger and the same merchant as a person at a checkout.
Full documentation: [Agent Payments](./x402.md).

- ☑ x402 protocol v2 types, HTTP transport, and the `exact`/EVM scheme
- ☑ Third `ExecutionPath` (`x402`) on the clearing engine, with the two named
  predicates the branches ask through
- ☑ Facilitator port and a local implementation — Mayarin broadcasts the payer's
  authorization, or delegates to somebody else's facilitator
- ☑ Settlement confirmed by reading the transaction back off the chain; a
  facilitator's `success` is never enough
- ☑ Resource registry, priced once in the merchant's currency and offered on
  every rail the deployment can serve; `maxTimeoutSeconds` derived from the quote
  lock rather than configured beside it
- ☑ Replay key scoped by network, asset and nonce — the window before the chain
  has recorded it
- ☑ Token capability probed from the contract at boot, with a control call, never
  configured
- ☑ `requirePayment` middleware — any handler becomes machine-payable
- ☑ Merchant-owned agent endpoints, on the API and in the dashboard
- ☑ Payables (#273) — an invoice's outstanding balance or a payment link's total,
  locked by a live quote row so two agents racing one obligation refuse rather
  than double-pay
- ☑ Cross-asset payments — exact-output swaps priced backwards from the invoice,
  so an agent holding any listed asset pays a merchant settled in another; the
  payer's change is a liability (`PAYER_SURPLUS`) or dust revenue, never absorbed
- ☑ Browser-friendly merchant paywall, and the SDK gate + connect adapter
- ☑ An MCP server at `POST /x402/mcp` selling rail intelligence per call —
  discovery free, answers paid, and three refusals that never charge
- ☐ Permit2 / EIP-2612 fallback for tokens without EIP-3009 — specified and
  probed for, not built
- ☐ Gas sponsorship, so sub-cent resources stop inverting the economics (#9)

Only the `exact` scheme is implemented, and only over EVM. x402 never touches
`PaymentRouter`, so an agent payment emits no `PaymentCompleted` and adds nothing
to the settlement subgraph.

### Indexing

- ☑ Settlements subgraph (`packages/subgraph`), deployed for Base Sepolia and Arc
  testnet, indexing `PaymentCompleted`
- ☑ `SettlementIndexer` reads it, clamped to how far it has indexed, and falls
  back to reading the chain directly the moment a chain leaves
  `SUBGRAPH_ENDPOINTS` — the subgraph is an index, never the record
- ☑ Rail statistics and the rail choice derived from it, cached rather than
  queried per call: Subgraph Studio allows 3,000 queries a day _account-wide_

### Payer Assets

- ☑ ERC-20 payer assets — same-asset deposits, and Permit2 on the contract path
- ☑ Native ETH
- ☑ EURC as a payer asset against a USDC merchant, cross-asset
- ☑ Asset admissibility governed by the `stablecoins` market-config key rather
  than a redeploy
- ☐ Configurable per-merchant payer-asset governance beyond `accepted_assets`

### Execution Venues

- ☑ Uniswap v3 (`QuoterV2` + `SwapRouter02`, exact-output)
- ☑ Uniswap v2, for chains with no v3 deployment
- ☑ 0x Protocol
- ☑ LiFi (quote only — it has no exact-output API)
- ☑ Strategy selection by latency tolerance, with failure fallback
- ☐ MEV exposure enforced at submission — the policy travels with the selection
  (`DEFAULT_STRATEGY_POLICIES`) but nothing routes through a private mempool; the
  payer sends their own transaction, so that needs the relayer in #9
- ☐ Smart routing — liquidity, fee, and network optimization

### Blockchain Networks

`CHAIN_IDS` is the list; what a deployment runs is narrower. See
[Chain Layer → Supported chains](./chain.md#supported-chains).

- ☑ Base and Base Sepolia — primary, contracts deployed and verified
- ☑ Ethereum Sepolia
- ☑ Arbitrum and Arbitrum Sepolia
- ☑ Arc testnet (Circle) — the first chain whose native asset is not ETH, with
  USDC-native settlement and a merchant Safe per chain
- ☑ Robinhood testnet (an Orbit chain)
- ☑ Chain-aware, exact-output quoting and the multichain counter (#244)
- ☑ Checkout ranks the payer's rail list by observed rail liveness (#260)
- ☑ Per-link rail restrictions (#282)
- ☐ Solana
- ☐ TRON

Cross-chain payment (customer pays on chain A, merchant settles on chain B)
requires a bridge with its own trust model. It is **not** handled by a single
PaymentRouter deployment — design the cross-chain path explicitly when reached.

### Wallet Providers

- ☑ Turnkey (MPC policy engine — the wallet provider)
- ☑ Connect-existing (Safe, EOA), with proof of control by signature
- ☑ Passkey-held merchant key, in a Turnkey sub-organization Mayarin is not a
  user of
- ☑ Circle Agent Stack contract accounts as **payers** — EIP-1271 signatures the
  token accepts. Not a wallet Mayarin provisions; a payer class it serves
- ☐ Tempo (MPC wallet infra — considered as an alternative behind the same port,
  not wired)
- ☐ The browser half of the passkey ceremony

### Settlement Assets

- ☑ Configurable settlement asset per merchant (`settlement_asset`, through
  `PATCH /settings`)
- ☑ USDC, USDT, EURC admitted through the `stablecoins` market-config key
- ☐ Settlement policy — split settlement, as an additive extension (#12)

### Fiat coverage

- ☑ Expanded fiat currency coverage (#288) — a product carries one explicit
  amount per currency, and the FX leg is priced by an oracle, never converted at
  read time

Each provider implements a common interface, allowing Mayarin to remain
provider-agnostic while supporting multiple execution paths.

---

## Phase 6 — Scale & Open Infrastructure ☐ Not started

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

Mayarin aims to become programmable clearing infrastructure.

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
      • x402 rail (agent payers)
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

# The ETHOnline 2026 entry

Mayarin is entered in the **Continuity** pool: the project predates the event, so
its work is documented in two lists rather than one — what merged before
4 September 2026, and what was built in the window. Three partner slots are
taken: **The Graph** (the settlements subgraph, the rail statistics, and the MCP
server that is a second Graph product), **Arc/Circle** (USDC-native settlement, a
merchant Safe per chain, Circle Agent Stack payers), and **Uniswap** (cross-asset
exact-output swaps priced backwards from the invoice).

[`ROADMAP.md`](../ROADMAP.md) at the repository root is the working state of that
entry — what shipped with which PR, what is next per sponsor, the facts measured
off Arc rather than read from its documentation, and the things about the x402
rail that are expensive to rediscover. Read it before touching
`packages/core/x402` or anything under `x402` in the API.

---

## Related

- [Architecture](./architecture.md)
- [Vision & Rationale](./vision.md)
- [Chain Layer](./chain.md)
- [Agent Payments (x402)](./x402.md)
- [Liquidity Routing](./liquidity-routing.md)
- [Stablecoin Registry](./stablecoin.md)
- [Configuration](./configuration.md)

[← Documentation index](./README.md)
