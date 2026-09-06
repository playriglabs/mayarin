# Mayarin

**/maɪˈjɑːrɪn/** — _“My-ar-in”_

> **A programmable clearing layer for humans, applications, and autonomous
> agents**
>
> Price in fiat. Settle in stablecoins. Paid by any of the three.

Mayarin turns fragmented crypto-payment infrastructure into one programmable
clearing layer. Merchants price in their local currency and receive a configured
stablecoin; the payer brings whatever supported asset they already hold.
Quoting, execution, settlement, accounting, wallets, and merchant-facing commerce
are coordinated behind one provider-agnostic layer rather than becoming part of
the merchant's application.

**The thesis has not changed. What widened is who may be a payer.**

```text
today      Human       → Mayarin → Merchant
           Application → Mayarin → Merchant
next       AI agent    → Mayarin → Merchant · Agent · API
```

An autonomous agent is a **payer class**, not a product line. It reaches the same
clearing layer, the same ledger and the same merchant as a person at a checkout —
it simply cannot open an account, hold a card, or be asked to understand gas.

That last case is [x402](https://github.com/coinbase/x402): any Mayarin-gated
endpoint becomes payable per call by an agent that has never registered, holds no
API key, and will never see a checkout page. It signs one authorization for an
exact amount and receives the resource.

The project currently runs on **testnet**. Its Base Sepolia execution contracts
are deployed and verified; the mainnet environment remains deliberately
unprovisioned until the documented security and deployment gates are satisfied.

## Contents

- [Why Mayarin](#why-mayarin)
- [Project status](#project-status)
- [Features](#features)
- [Agent payments](#agent-payments)
- [Architecture](#architecture)
- [How a payment moves](#how-a-payment-moves)
- [Design principles](#design-principles)
- [Quick start](#quick-start)
- [SDK example](#sdk-example)
- [Repository map](#repository-map)
- [Technology stack](#technology-stack)
- [Development](#development)
- [Testing and quality](#testing-and-quality)
- [Deployment](#deployment)
- [Documentation](#documentation)
- [Roadmap and current boundaries](#roadmap-and-current-boundaries)
- [Community and support](#community-and-support)
- [Contributing](#contributing)
- [Security](#security)
- [Licensing](#licensing)

## Why Mayarin

Merchants think in local prices. Customers hold crypto. Settlement happens in
stablecoins. Without an orchestration layer, merchants are forced to manage
wallets, rates, swaps, gas, finality, and reconciliation themselves.

Mayarin turns those responsibilities into infrastructure:

```text
Merchant prices       IDR 50,000
Customer chooses      ETH, USDC, or another configured payer asset
Mayarin locks         the merchant's stablecoin settlement minimum
Execution converts    on-chain when the payer and settlement assets differ
Merchant receives     the configured settlement stablecoin
Records show          chain evidence, clearing events, and balanced postings
```

Mayarin is not an exchange, a general-purpose custodial wallet, or a fiat
payment rail. The Payment Intent is the stable boundary: platforms may use the
first-party catalog and checkout, or build their own commerce experience on the
same payment primitives.

## Project status

| Area                      | Status                         | Notes                                                                                                               |
| ------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| Core payment and clearing | Shipped                        | Immutable intents, resumable state machine, exact money, idempotency                                                |
| Double-entry accounting   | Shipped                        | Balanced postings and merchant-scoped reconciliation                                                                |
| Contract execution        | Testnet                        | `PaymentRouter`, timelock, and deposit-forwarder contracts on Base Sepolia                                          |
| Deposit matching          | Shipped                        | Per-intent addresses, confirmation policy, reorg handling, treasury executor                                        |
| Quotes and routing        | Shipped                        | Oracle guards and pluggable execution venues                                                                        |
| Commerce                  | Shipped                        | Products, carts, links, invoices, hosted checkout, orders, and customers                                            |
| Merchant dashboard        | Shipped                        | Real API-backed operational and developer surfaces                                                                  |
| Wallet infrastructure     | Shipped with browser follow-up | Verified addresses, managed Safe, balances, and withdrawals; complete passkey browser ceremony remains roadmap work |
| TypeScript SDK            | Shipped in the monorepo        | Server and publishable browser clients; publication is a release decision                                           |
| Webhooks and live status  | Shipped                        | Signed retries, delivery inspection, replay, SSE buyer status                                                       |
| Agent payments (x402)     | Shipped, off by default        | Protocol, facilitator, resource registry, and HTTP surface; enabled with `X402_ENABLED`                             |
| Mainnet                   | Planned                        | No mainnet Railway project is provisioned                                                                           |

The detailed and continuously updated status lives in
[docs/roadmap.md](./docs/roadmap.md).

## Features

### Payment and execution

- Immutable Payment Intents with merchant references and idempotency keys.
- Fiat-denominated pricing with stablecoin settlement.
- Exact integer minor-unit arithmetic; no floating-point money paths.
- Atomic receive → swap → settle through `PaymentRouter` when supported.
- Deposit-address fallback for direct transfers and unsupported contract paths.
- Native ETH and ERC-20 chain handling behind shared chain ports.
- Confirmation-depth policy, reorg detection, cursor persistence, and backfill.
- Pyth and Chainlink reference-price adapters.
- Uniswap and 0x exact-output route adapters, plus LiFi quote support.
- Signed quote locks with settlement minimums, deadlines, and slippage bounds.

### Agent payments (x402)

- x402 protocol v2 over the existing clearing engine — no second value path.
- `requirePayment` middleware turning any handler into a machine-payable
  resource.
- Resources priced once in the merchant's currency, offered on several chains at
  once; the payer picks.
- `exact` scheme over EIP-3009, with EIP-2612/Permit2 as the fallback for tokens
  that lack it.
- Facilitator port with a local implementation, so Mayarin can broadcast a
  payer's authorization or delegate to somebody else's facilitator.
- Settlement confirmed by reading the transaction back off the chain — a
  facilitator's word is never enough.
- Token capability probed from the contract at boot, never configured.
- Replay key scoped by network, asset and nonce, covering the window before the
  chain has recorded it.

### Commerce and checkout

- Optional product catalog with one explicit price per currency.
- Stateless carts that produce immutable Payment Intent snapshots.
- Fixed, open-amount, and catalog-backed payment links.
- Numbered invoices with lifecycle, due dates, hosted views, and checkout.
- Hosted buyer checkout bundled with the core API.
- Embeddable browser checkout and a reference storefront.
- Static merchant QR and per-payment EIP-681 deposit codes.
- Merchant-reference lookup and idempotent creation flows.
- Payment refund API and refund summaries.
- WooCommerce plugin with signed webhook verification.

### Merchant operations

- Overview and merchant analytics.
- Product catalog, payment links, counter checkout, orders, and customers.
- Payment explorer with clearing and chain-event timelines.
- Settlement views combining booked amounts with chain evidence.
- Managed and connected wallets, proof-of-control challenges, balances, and
  withdrawal history.
- Merchant profile, accepted assets, settlement configuration, and change
  history.
- Scoped users, permissions, secret API keys, and publishable keys.
- Signed webhook endpoints, secret rotation, delivery inspection, and replay.
- Unified event logs and merchant-scoped audit/reconciliation records.

### Developer platform

- Versioned Hono REST API under `/v1`.
- Separate session-based dashboard API with tenant isolation and CSRF defense.
- Generated OpenAPI 3.1 reference and interactive playground.
- `@mayarin/sdk` TypeScript client for commerce, payments, QR helpers, invoices,
  and webhook verification.
- Browser-safe SDK surface using publishable keys for catalog reads and cart
  checkout.
- Provider ports for storage, chains, settlement, liquidity, prices, wallets,
  execution, and screening.

## Agent payments

See the [Arc rail audit and reproduction guide](./docs/arc.md) for the architecture,
contract-path evidence, and remaining Circle wallet and submission work.

An agent asks for a resource, is told the price in machine-readable terms, pays,
and is served. It never registered with anyone.

```text
GET /premium-data
        ↓
402 Payment Required
   PAYMENT-REQUIRED: { price, chains, assets, deadline }
        ↓
agent signs an authorization for exactly that amount
        ↓
GET /premium-data
   PAYMENT-SIGNATURE: { signature, authorization }
        ↓
verify → broadcast → confirm on-chain → credit the merchant
        ↓
200 OK  +  PAYMENT-RESPONSE: { transaction, network }
```

Three properties are worth stating plainly, because each is a rule the code
enforces rather than a claim:

- **The agent signs exactly one thing** — an authorization for an exact amount,
  in an asset it already holds. It never touches gas, never holds the merchant's
  asset, and never sees an address. Gas is paid by whoever broadcasts, and
  `transferWithAuthorization` cannot change the amount or the recipient, so a
  facilitator is a broadcaster rather than a custodian.
- **A facilitator's `success` is a claim, not a settlement.** Nothing advances
  until the transaction has been read back off the chain and matched to this
  payment — right token, right recipient, full amount.
- **The merchant is unchanged.** They are still priced in their own currency and
  still settled in their configured stablecoin. An agent is a different kind of
  payer, not a different kind of merchant.

Enabled with `X402_ENABLED`, which is off by default: without an operator key
there is nothing to broadcast an authorization with, so the routes answer 404
rather than half-working.

See [ROADMAP.md](./ROADMAP.md) for the ETHOnline 2026 work built on this.

## Architecture

![Mayarin architecture flow: merchants and customers enter through the Mayarin API, which coordinates quoting, contract execution or transfer watching, clearing, the ledger, and stablecoin settlement](./apps/landing/public/images/pitch-deck/mayarin-architecture-flow.png)

Mayarin follows ports and adapters. Pure domain packages define the contracts;
Postgres, EVM, oracle, liquidity, settlement, and wallet packages implement
them. Composition roots in the applications select the concrete deployment.

Every payment enters the same orchestration and accounting model, but value can
move through one of three paths. Which one applies is chosen per payer, not per
deployment — they serve different buyers rather than acting as fallbacks for one
another:

1. **On-chain contract path — primary where supported.** Mayarin locks the
   merchant's settlement minimum and builds a signed order. The customer calls
   `PaymentRouter`, which receives, optionally swaps, and settles atomically. A
   confirmed `PaymentCompleted` event is indexed into clearing and the ledger.
2. **Deposit-matching path.** The customer transfers to a unique per-intent
   address. The chain worker confirms the transfer and a treasury executor
   converts and settles it. This path briefly holds the payer asset; that custody
   boundary is explicit and audited. It is the only path open to a payer who can
   just send a transfer — a QR scan, or a withdrawal from an exchange.
3. **x402 path — for programs.** The payer signs an EIP-3009 authorization and a
   facilitator broadcasts it. No deposit address is derived, because the payment
   is identified by the authorization nonce rather than by where the money
   landed. An agent never sees an address, so deriving one per `402` would be an
   unused address for every request that is never paid.

Read [Architecture](./docs/architecture.md), [Chain Layer](./docs/chain.md), and
[Threat Model](./docs/threat-model.md) before changing an execution or custody
boundary.

## How a payment moves

### Contract execution path

```text
Merchant creates intent
        ↓
Quote engine locks the stablecoin settlement minimum
        ↓
Customer selects a payer asset
        ↓
Execution engine builds fresh route calldata
        ↓
Customer submits PaymentRouter transaction
        ↓
Receive → optional swap → merchant settlement (atomic)
        ↓
PaymentCompleted event reaches the settlement indexer
        ↓
Clearing state → double-entry ledger → dashboard and webhooks
```

### Deposit-matching path

```text
Payment Intent locks asset, chain, and amount
        ↓
Mayarin allocates a unique deposit address
        ↓
Customer transfers from a wallet or exchange
        ↓
Wallet watcher observes and confirms the transfer
        ↓
Treasury executor converts and settles
        ↓
Clearing state → double-entry ledger → dashboard and webhooks
```

### x402 path

```text
Agent requests a gated resource with no payment
        ↓
Resource priced through the quote engine, once per accepted rail
        ↓
402 Payment Required, terms in the PAYMENT-REQUIRED header
        ↓
Agent signs an EIP-3009 authorization for the exact amount
        ↓
Facilitator verifies, then broadcasts
        ↓
Settlement read back off the chain and matched to this payment
        ↓
Clearing state → double-entry ledger → resource served
```

The price a payer is given is honoured for a window derived from the quote lock,
never configured beside it. The two numbers cannot drift apart because there is
only one.

#### Cross-asset: the agent pays with what it holds

An agent that does not hold the merchant's settlement asset is still a payer.
It signs one authorization in the asset it has, and the merchant is paid the
exact amount they invoiced in the asset they chose:

```text
authorization   payer    → operator     the agent's asset, exactly what it signed for
swap            operator → pool         exact-output, bounded by the authorization
                pool     → merchant     exactly the invoice, or the swap reverts
surplus                                 what the pool did not need, booked back to the payer
```

The merchant's number is the fixed one and the payer's is derived from it, so
the swap is priced **backwards** — asking what delivering exactly the invoice
costs, rather than what one unit buys. On a thin pool those are different
answers, and the forward one is wrong in the direction that loses the payment
after their money has already moved.

`exact` gives the payer one signature and no way to top it up, so the amount
they sign is the exact-output quote plus a slippage bound, and that bound is
also the ceiling the swap may consume. Whatever it does not consume is theirs:
it is recorded as a liability owed back, never absorbed.

Measured on Base Sepolia, block `46451061` — an agent holding EURC paying a
USDC merchant, with no account and no API key:

|                |                                                                                                                                                                     |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Authorization  | [`0x254b93ce…`](https://sepolia.basescan.org/tx/0x254b93cec1a73279e12968938c1c491133c5556b4adb9e71cea070e0abc8affa) — 28351 EURC, payer → operator                  |
| Swap           | [`0xb1436735…`](https://sepolia.basescan.org/tx/0xb143673599a6b05cd95676f0bbec7ffc35f9f99563bf45c6f26468944eb38a07) — 28208 EURC in, **20000 USDC to the merchant** |
| Payer's change | 143 EURC, booked to `PAYER_SURPLUS`                                                                                                                                 |

Where to read it:

| What                                                             | File                                                                  |
| ---------------------------------------------------------------- | --------------------------------------------------------------------- |
| Pricing the invoice backwards into the payer's asset             | `apps/api/src/services/x402.ts` — `#priceCrossAsset`                  |
| The exact-output quote against Uniswap's QuoterV2                | `packages/providers/swap-uniswap/src/adapter.ts` — `quoteExactOutput` |
| Encoding `exactOutputSingle` for `SwapRouter02`                  | `packages/providers/swap-uniswap/src/route.ts`                        |
| Plan before the payer's money moves, then send, persist, confirm | `packages/core/x402/src/cross-asset.ts`                               |
| Approve, swap, and read the receipt back                         | `packages/providers/evm/src/cross-asset-settler.ts`                   |
| The payer's change, as a liability rather than a gain            | `packages/core/ledger/src/accounts.ts` — `PAYER_SURPLUS`              |
| The end-to-end run that produced the figures above               | `scripts/e2e-x402.ts`                                                 |

Notes on the Uniswap integration itself — what the contracts do that their
documentation does not say — are in [`FEEDBACK.md`](./FEEDBACK.md).

## Design principles

- **Money is never a float.** Amounts are integer minor units and rates are
  integer ratios or basis points.
- **Execution is bounded.** A signed settlement minimum, deadline, and
  slippage policy prevent a silent underfill.
- **State changes are replay-safe.** Clearing steps, chain observations,
  ledger postings, creation requests, and webhook deliveries are idempotent.
- **Value movement is auditable.** Nothing mutates a balance directly; every
  recorded movement goes through balanced ledger postings.
- **Effects stay at the edge.** Core packages define ports. Infrastructure
  adapters own I/O and vendor dependencies.
- **On-chain truth wins.** The ledger is an auditable derived view, not a
  substitute for confirmed chain evidence.
- **Custody boundaries are explicit.** The atomic path and fallback deposit
  path make different trust assumptions and are documented separately.
- **Commerce is optional.** A developer can use raw payment primitives without
  adopting Mayarin's catalog, links, or dashboard.

## Quick start

### Requirements

- [Bun](https://bun.sh) 1.4 or newer
- Docker with Docker Compose
- Foundry only when working on Solidity contracts

### One-command setup

```bash
git clone https://github.com/playriglabs/mayarin.git
cd mayarin

# Install dependencies, create .env, start Postgres, and apply migrations.
bun run setup

# Optionally create the first merchant account and API key.
bun run setup -- --seed

# Run the core API, chain worker, dashboard API, dashboard, and checkout UI.
bun run dev:all
```

`setup` is also the recovery path for a drifted environment:

```bash
bun run setup -- --check     # report configuration drift; change nothing
bun run setup -- --reset-db  # rebuild only the guarded local Docker database
```

### Focused development servers

```bash
bun run dev                  # core payment API on http://localhost:3000
bun run dev:dashboard:local  # reset and run the complete local dashboard flow
bun run dev:demo             # Parahyangan Supply reference storefront
bun run dev:docs             # interactive API documentation
bun run dev:landing          # marketing site and pitch deck
bun run dev:studio           # content studio
```

See [Development](./docs/development.md) for manual database setup, environment
configuration, chain-worker options, and local fixture guidance.

## SDK example

Create a fixed IDR payment link from a server-side integration:

```ts
import { createMayarin } from "@mayarin/sdk";

const secretKey = process.env.MAYARIN_SECRET_KEY;
if (secretKey === undefined) throw new Error("MAYARIN_SECRET_KEY is required");

const mayarin = createMayarin({
  baseUrl: "https://api-testnet.mayarin.xyz",
  secretKey,
});

const link = await mayarin.commerce.paymentLinks.create(
  {
    kind: "fixed",
    merchant: {
      id: "merchant_123",
      name: "Toko Melati",
      city: "Jakarta",
      countryCode: "ID",
    },
    amount: { amount: "50000.00", asset: "IDR" },
  },
  { idempotencyKey: "order-4711" },
);

console.log(link.url);
```

Secret keys stay on the server. Browser integrations use
`createMayarinBrowser` with a publishable key and receive only the deliberately
restricted commerce surface. See [packages/sdk/README.md](./packages/sdk/README.md)
and the [reference storefront](./apps/demo/README.md).

## Repository map

Mayarin is a Bun workspace monorepo.

| Path                                | Responsibility                                                   |
| ----------------------------------- | ---------------------------------------------------------------- |
| `apps/api`                          | Public payment and commerce API; hosted checkout, invoices, x402 |
| `apps/chain-worker`                 | Wallet watcher, settlement indexer, and deposit-path executor    |
| `apps/checkout-ui`                  | Buyer-facing checkout bundled with the core API                  |
| `apps/dashboard-api`                | Authenticated, tenant-scoped merchant API                        |
| `apps/dashboard`                    | Merchant operations dashboard                                    |
| `apps/demo`                         | Parahyangan Supply reference storefront                          |
| `apps/docs`                         | Interactive API and SDK documentation                            |
| `apps/landing`                      | Marketing site and pitch deck                                    |
| `apps/pay-proxy`                    | Restricted buyer-origin proxy for hosted payment surfaces        |
| `apps/blog` / `apps/studio`         | Editorial site and content studio                                |
| `packages/core/*`                   | Pure domain modules and provider/repository ports                |
| `packages/providers/*`              | EVM, oracle, swap, settlement, password, and wallet adapters     |
| `packages/contracts/payment-router` | Solidity contracts and Foundry tests                             |
| `packages/db`                       | Drizzle schema, migrations, and Postgres repositories            |
| `packages/sdk`                      | TypeScript client SDK                                            |
| `packages/embed`                    | Embeddable checkout package                                      |
| `plugins/woocommerce`               | WooCommerce integration                                          |

The central dependency rule is one-way: domain packages may depend on other
domain contracts, but never on Postgres, Hono, viem, Turnkey, or another concrete
adapter. See [AGENT.md](./AGENT.md) for the complete repository conventions.

## Technology stack

| Layer                 | Technology                                              |
| --------------------- | ------------------------------------------------------- |
| Runtime and language  | Bun, TypeScript                                         |
| APIs                  | Hono, Zod, Effect at the dashboard application boundary |
| Web applications      | Astro, React, Preact, Vite, Tailwind CSS                |
| Data                  | PostgreSQL, Drizzle ORM                                 |
| Smart contracts       | Solidity, Foundry, OpenZeppelin                         |
| EVM integration       | viem                                                    |
| Wallet infrastructure | Safe smart accounts, Turnkey adapter                    |
| Quotes and execution  | Pyth, Chainlink, Uniswap, 0x, LiFi adapters             |
| Agent payments        | x402 protocol v2, EIP-3009, EIP-712 typed data          |
| Monorepo and quality  | Bun workspaces, Turbo, Biome, Prettier, Lefthook        |
| Deployment            | Railway services and Cloudflare Workers/Pages           |

## Development

### Common commands

| Command                             | Purpose                                                      |
| ----------------------------------- | ------------------------------------------------------------ |
| `bun run setup`                     | Install, validate configuration, start Postgres, and migrate |
| `bun run dev:all`                   | Run the main local application graph through Turbo           |
| `bun run db:up` / `bun run db:down` | Start or stop local Postgres                                 |
| `bun run db:migrate`                | Apply checked-in Drizzle migrations                          |
| `bun run db:generate`               | Generate a migration after changing the schema               |
| `bun run db:studio`                 | Open Drizzle Studio for the local database                   |
| `bun run docs:generate-openapi`     | Regenerate the OpenAPI artifact from route schemas           |
| `bun run build:contracts-abi`       | Build contracts and regenerate the shared ABI package        |
| `bun run e2e`                       | Run the deposit-path end-to-end script                       |

### Code conventions

- TypeScript is strict, including `noUncheckedIndexedAccess` and
  `exactOptionalPropertyTypes`.
- Domain aggregates are immutable and time is injected through a `Clock`.
- Expected domain failures use the shared typed error taxonomy.
- Biome owns TypeScript, JavaScript, and JSON; Prettier owns Markdown and YAML.
- Cross-package imports use the `@mayarin/*` workspace names.
- Migrations are generated after schema changes and never rewritten casually.

## Testing and quality

```bash
bun run format:check     # Biome + Prettier
bun run typecheck        # every workspace package
bun test                 # unit and integration suites
bun run check            # complete local gate
bun run test:contracts   # Foundry contract suite
bun run test:woocommerce # PHP lint and plugin tests through Docker
```

Postgres integration tests are opt-in because they truncate every table they
touch. Point them only at the dedicated test database:

```bash
TEST_DATABASE_URL=postgres://mayarin:mayarin@localhost:5433/mayarin \
  bun test packages/db
```

Git hooks are installed by `bun install`:

- **pre-commit** — Biome and Prettier over staged files, with fixes re-staged;
- **pre-push** — workspace typecheck followed by the complete Bun test suite.

## Deployment

Deployments are manual and target-explicit. Git pushes do not automatically
deploy production infrastructure.

The testnet backend is split into four isolated Railway services:

| Service         | Responsibility                                             |
| --------------- | ---------------------------------------------------------- |
| `core-api`      | Public API plus hosted checkout and invoice pages          |
| `dashboard-api` | Merchant session and operations API                        |
| `chain-worker`  | Continuous chain observation and execution workers         |
| `Postgres`      | Application state, cursors, ledger, events, and audit data |

Browser-facing dashboard, payment proxy, demo, documentation, and landing
surfaces deploy separately to Cloudflare. The testnet wrapper verifies the
local gate, target identity, optional migrations, dependency order, and smoke
checks:

```bash
bun run deploy:testnet
```

Do not run deployment commands from this README alone. Read
[docs/deployment.md](./docs/deployment.md), verify the target registry, and
follow its environment-isolation and key-handling rules.

## Documentation

| Document                                             | Covers                                                  |
| ---------------------------------------------------- | ------------------------------------------------------- |
| [Documentation index](./docs/README.md)              | Orientation and the complete design record              |
| [Vision and rationale](./docs/vision.md)             | Problem, goals, and explicit non-goals                  |
| [Architecture](./docs/architecture.md)               | System layers, execution paths, and code boundaries     |
| [REST API](./docs/api.md)                            | Public reference, versioning, and dashboard API         |
| [Payment Intent](./docs/payment-intent.md)           | Immutable payment request and lifecycle                 |
| [Money](./docs/money.md)                             | Assets, precision, parsing, and formatting              |
| [Liquidity and routing](./docs/liquidity-routing.md) | Quotes, oracles, venues, locks, and execution           |
| [Chain Layer](./docs/chain.md)                       | Contract events, deposit matching, finality, and reorgs |
| [Clearing Engine](./docs/clearing-engine.md)         | State machine, idempotency, and recovery                |
| [Double-entry ledger](./docs/ledger.md)              | Accounts, postings, and reconciliation                  |
| [Merchant wallets](./docs/wallet.md)                 | Safe provisioning, proof of control, and custody        |
| [Compliance](./docs/compliance.md)                   | Audit records and ledger-to-chain reconciliation        |
| [Threat Model](./docs/threat-model.md)               | Security assumptions, mitigations, and accepted risks   |
| [Embeddable checkout](./docs/embed.md)               | Checkout integration on merchant sites                  |
| [WooCommerce](./docs/woocommerce.md)                 | Plugin setup and payment lifecycle                      |
| [Deployment](./docs/deployment.md)                   | Testnet topology and guarded deployment process         |
| [Roadmap](./docs/roadmap.md)                         | Shipped status, limitations, and future phases          |

The canonical interactive API reference is published at
[docs.mayarin.xyz](https://docs.mayarin.xyz).

[ROADMAP.md](./ROADMAP.md) is the working state of the ETHOnline 2026 entry —
what shipped, what is next, and the chain facts that were measured rather than
read from a vendor's documentation.

## Roadmap and current boundaries

Current boundaries are part of the design, not hidden footnotes:

- Fiat rails such as QRIS and bank transfer are outside the MVP.
- Stablecoin-to-fiat off-ramping is a later phase with its own custody and
  regulatory perimeter.
- Testnet is provisioned; mainnet is planned and must not reuse testnet state,
  contracts, or credentials.
- The deposit path briefly holds the payer asset between receipt and execution;
  the contract path does not.
- Broader gas abstraction, multi-recipient settlement splitting, multi-chain
  expansion, and the complete browser passkey ceremony remain roadmap work.
- Screening has a provider port and honest disabled default; KYC, freeze
  handling, exports, and retention policy are not complete compliance products.

Future work is organized around completing the commerce experience, expanding
payer assets and execution venues, reaching more chains and markets, scaling
operations, and opening provider/plugin extension points. See the
[roadmap](./docs/roadmap.md) for item-level status.

Agent payments have boundaries of their own, and they are current rather than
aspirational: only the `exact` scheme is implemented, only over EVM; the
Permit2 fallback is specified but not yet built; and in that scheme the
broadcaster pays gas, so sub-cent resources invert the economics until a
sponsorship path exists. [ROADMAP.md](./ROADMAP.md) tracks the ETHOnline 2026
work on top of this and records those gaps in one place.

## Community and support

- Use [GitHub Issues](https://github.com/playriglabs/mayarin/issues) for
  reproducible bugs and scoped feature proposals.
- Search existing issues before opening a new one and link the relevant design
  document or roadmap item when possible.
- Include the affected app/package, expected behavior, actual behavior,
  reproduction steps, and a minimal sanitized log.
- Never include secrets, private keys, wallet credentials, customer data, or
  production connection strings.
- Keep vulnerability reports private as described in [Security](#security).

## Contributing

Contributions should preserve the system's financial and architectural
invariants.

1. Read [AGENT.md](./AGENT.md), [Architecture](./docs/architecture.md), and the
   domain document for the area you plan to change.
2. Create a focused branch and keep unrelated working-tree changes out of it.
3. Add tests at the narrowest layer that owns the behavior.
4. Update the relevant design documentation when an invariant, API contract,
   custody boundary, or deployment assumption changes.
5. Run `bun run check` before opening a pull request. Run the contract or
   WooCommerce suites as well when those areas change.
6. Keep commits free of generated attribution trailers and follow the existing
   commit style.

Good first contributions improve tests, documentation, provider adapters,
developer experience, and narrowly scoped roadmap items without weakening
tenant isolation, exact-money handling, idempotency, or custody controls.

A standalone `CONTRIBUTING.md` and code of conduct are not yet present. Until
they are added, [AGENT.md](./AGENT.md) and [docs/development.md](./docs/development.md)
are the contributor guides.

## Security

Payment and wallet code is security-sensitive. Do not put private keys, API
secrets, wallet credentials, RPC credentials, or production database URLs in an
issue, pull request, fixture, log, or screenshot.

Before reporting a vulnerability publicly, contact the maintainers privately.
The repository does not yet publish a dedicated `SECURITY.md` or disclosure
address, so coordinate a private channel with the repository owners first.

Security-relevant changes must account for:

- merchant and tenant isolation;
- authorization, CSRF, and API-key permissions;
- exact money and quote-lock behavior;
- replay and idempotency boundaries;
- finality, reorgs, and chain/RPC failure;
- signer, treasury, and merchant-wallet separation;
- contract upgrade, timelock, and deployment-target controls;
- the different custody assumptions of contract and deposit execution.

See [Threat Model](./docs/threat-model.md), [Quote Signing](./docs/quote-signing.md),
and [Merchant Wallets](./docs/wallet.md).

## Licensing

This repository does not currently contain a root-level license file. Public
source availability does not by itself grant permission to copy, modify, or
redistribute the project. Repository owners should add an explicit open-source
license before presenting Mayarin as licensed open-source software.

---

> **Build once. Settle anywhere.**

Mayarin turns fragmented crypto-payment infrastructure into one programmable
clearing layer, so merchants can think in local prices and stablecoin settlement
while customers pay with the supported asset they already hold.
