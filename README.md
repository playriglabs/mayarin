<div align="center">

# Mayarin

### The merchant names one price in their own currency. The payer brings whatever they hold. Both numbers are exact.

[![Testnet](https://img.shields.io/badge/Live%20on-Testnet-16A34A?style=for-the-badge)](https://api-testnet.mayarin.xyz)
[![Base Sepolia](https://img.shields.io/badge/Base%20Sepolia-PaymentRouter-0052FF?style=for-the-badge)](https://sepolia.basescan.org/address/0xee7c5b5a9eeaf667a6efb217a8a77534c873f7a9)
[![Arc](https://img.shields.io/badge/Arc-Testnet-111111?style=for-the-badge)](./docs/arc.md)
[![Uniswap](https://img.shields.io/badge/Uniswap-Exact%20Output-FF007A?style=for-the-badge)](./docs/liquidity-routing.md)
[![The Graph](https://img.shields.io/badge/The%20Graph-Subgraph-6747ED?style=for-the-badge)](./packages/subgraph)
[![x402](https://img.shields.io/badge/x402-Agent%20Payments-000000?style=for-the-badge)](./docs/x402.md)

</div>

---

## The problem

A merchant in Jakarta prices a bag of coffee at IDR 50,000. A customer wants to pay in EURC. An
agent wants to pay for one API call and has never heard of an account.

To serve any of them today, the merchant has to become an infrastructure team:

```
   accept crypto      →    pick a chain, hold a wallet, fund it with gas
                      →    watch a rate that moves while the customer decides
                      →    swap, hope the pool is deep enough, eat the slippage
                      →    reconcile a balance nobody can explain
```

Every one of those is a way to be paid less than the price on the tag, and to find out afterwards.

## The solution

One clearing layer between the two. The merchant's number is locked first, and everything else is
derived from it.

```
   merchant prices       IDR 50,000, in their own currency
   payer holds           ETH, EURC, USDC, or another configured asset
   Mayarin locks         the merchant's stablecoin settlement minimum
   execution converts    on-chain, only when the two assets differ
   merchant receives     exactly the configured settlement amount
   records show          chain evidence, clearing events, balanced postings
```

The merchant never sees a chain, a gas token, or a slippage setting. The payer never sees the
merchant's currency. Neither side is asked to absorb the difference, because the difference is
priced, bounded and recorded.

**An autonomous agent is a payer class, not a product line.** It reaches the same clearing engine,
the same ledger and the same merchant as a person at a checkout. It differs in one way: it cannot
open an account, hold a card, or be asked to understand gas, so it is given one thing to sign.

## How it works

```
   1  INTENT          the merchant states a price and a settlement asset
                      immutable, versioned, idempotent on the merchant's own key

   2  LOCK            the quote engine freezes the settlement minimum
                      the price a payer is honoured for comes from this lock,
                      never from a window configured beside it

   3  PAY             contract call, deposit transfer, or one signed authorization
                      whichever the payer can actually do

   4  CONFIRM         the receipt is read back off the chain
                      token, recipient and amount matched against what was expected

   5  RECORD          clearing transition and balanced ledger postings
                      written in the same database transaction

                                ↓

      merchant paid  ──►  exactly the invoice, or the payment does not advance
```

**A submitted transaction is never treated as proof of payment.** Broadcasting is easy; being paid
is a fact about the chain. Mayarin reads the receipt and compares it against the expected token,
recipient and amount before anything advances. A webhook only _wakes_ the engine, which then asks
the adapter for the authoritative status — so a spoofed or replayed webhook settles nothing.

## Architecture

Ports and adapters, enforced in one direction: **a domain package never imports a concrete
adapter.** `apps/api/src/container.ts` is the only file that knows which implementations this
deployment runs.

```mermaid
flowchart TB
    Payer["Human checkout · Application (SDK) · AI agent (x402)"]

    subgraph Edge["apps/* — HTTP boundary · Hono + Zod"]
        API["Payment Intents · Commerce · x402 · Webhooks"]
        Worker["chain-worker — watcher, indexer, executor"]
    end

    subgraph Core["packages/core/* — pure domain, zero I/O"]
        Intent["payment-intent<br/><i>immutable aggregate</i>"]
        Quote["quote + liquidity<br/><i>locks the merchant's minimum</i>"]
        Clearing["clearing<br/><i>state machine, the centre</i>"]
        Ledger["ledger<br/><i>double-entry postings</i>"]
        Chain["chain<br/><i>deposits, settlement indexer</i>"]
        Intent --> Quote --> Clearing --> Ledger
        Chain -- recordAssetReceived --> Clearing
    end

    subgraph Adapters["packages/providers/* + packages/db — replaceable"]
        EVM["evm · viem"]
        Swap["uniswap · uniswap-v2 · 0x · lifi"]
        Oracle["pyth · chainlink"]
        Graph["subgraph · The Graph"]
        Wallet["turnkey · Safe"]
        DB["db · Drizzle + Postgres"]
    end

    Payer --> Edge
    Edge --> Core
    Core -. "ports — interfaces only" .-> Adapters
```

Swapping Postgres, a price oracle or a liquidity venue means writing one adapter against a port that
already exists. Reference in-memory fakes ship beside each port under `@mayarin/<pkg>/testing`, so a
domain package is fully testable with no database and no network.

### The clearing engine

Nine states, plus `FAILED` reachable from any non-terminal one. Three invariants hold it together:
every step is **idempotent** (keyed `${transactionId}:${state}`), **resumable** (persisted state is
the only input a step needs), and **auditable** (each transition appends an event in the same
database transaction as the state change).

```mermaid
stateDiagram-v2
    direction LR
    [*] --> CREATED
    CREATED --> QR_PARSED
    QR_PARSED --> PRICE_LOCKED: rate frozen
    PRICE_LOCKED --> PAYMENT_PENDING
    PAYMENT_PENDING --> ASSET_RECEIVED: chain evidence, past confirmation depth
    ASSET_RECEIVED --> CLEARING
    CLEARING --> SETTLING
    SETTLING --> SETTLED
    SETTLED --> SUCCESS
    SUCCESS --> [*]
    PAYMENT_PENDING --> FAILED
    CLEARING --> FAILED
    SETTLING --> FAILED
    FAILED --> [*]
```

Side effects run **before** the state is persisted. A crash in between means the resumed step
repeats a no-op and then records the state — never the reverse, which would replay a transfer.
`ClearingEngine.resumeStuck` recovers what stalls.

### Three execution paths

_How_ value moves is chosen per payment, not per deployment. They serve different payers rather than
acting as fallbacks for one another, and all three land in the same engine, ledger and merchant
account.

| Path              | The payer does                                  | Custody                                                                                     | Advances on                                           |
| ----------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| **Contract**      | Calls `PaymentRouter` with a signed order       | None — receive, swap and settle are atomic                                                  | A `PaymentCompleted` log past confirmation depth      |
| **Deposit-match** | Sends a transfer to a unique per-intent address | Explicit and audited: Mayarin holds the payer asset until the treasury executor converts it | A confirmed deposit matched to the intent             |
| **x402**          | Signs one EIP-3009 authorization                | Operator holds the authorized amount, and only when a swap is needed                        | The receipt read back and matched to the requirements |

```mermaid
sequenceDiagram
    autonumber
    participant P as Payer
    participant M as Mayarin
    participant C as Chain
    participant L as Ledger

    P->>M: create or open the intent
    M->>M: lock the merchant's settlement minimum
    M-->>P: route calldata · deposit address · 402 terms
    P->>C: submit transaction or signed authorization
    M->>C: read the receipt back
    Note over M,C: token, recipient and amount<br/>matched against what was expected
    M->>L: balanced postings, same transaction as the state change
    M-->>P: settled — webhook, SSE, receipt
```

## Agent payments

Any Mayarin-gated endpoint becomes payable per call by an agent that has never registered, holds no
API key, and will never see a checkout page. It receives machine-readable terms, signs one
[EIP-3009](https://eips.ethereum.org/EIPS/eip-3009) authorization for an exact amount, and gets the
resource.

An agent that does not hold the merchant's settlement asset is still a payer:

```
   authorization   payer    →  operator    the agent's asset, exactly what it signed for
   swap            operator →  pool        exact-output, bounded by the authorization
                   pool     →  merchant    exactly the invoice, or the swap reverts
   surplus                                 what the pool did not need, owed back to the payer
```

The merchant's number is the fixed one and the payer's is derived from it, so the swap is priced
**backwards** — what does delivering exactly the invoice cost, rather than what does one unit buy.
On a thin pool those are different answers, and the forward one is wrong in the direction that loses
the payment after the money has already moved.

Whatever the pool does not consume belongs to the payer. Above one cent it is recorded as a
liability owed back to the signing address; below it, the refund costs more than the change, so it
is taken as revenue in a named account and stated in the receipt event. Neither case absorbs it into
a balance nothing explains — the threshold only decides which account carries it.

Measured on Base Sepolia, block `46451061` — an agent holding EURC paying a USDC merchant, with no
account and no API key:

|                |                                                                                                                                                                     |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Authorization  | [`0x254b93ce…`](https://sepolia.basescan.org/tx/0x254b93cec1a73279e12968938c1c491133c5556b4adb9e71cea070e0abc8affa) — 28351 EURC, payer to operator                 |
| Swap           | [`0xb1436735…`](https://sepolia.basescan.org/tx/0xb143673599a6b05cd95676f0bbec7ffc35f9f99563bf45c6f26468944eb38a07) — 28208 EURC in, **20000 USDC to the merchant** |
| Payer's change | 143 EURC — under the one-cent dust threshold, so taken as revenue rather than owed back                                                                             |

Where to read it:

| What                                                             | File                                                     |
| ---------------------------------------------------------------- | -------------------------------------------------------- |
| Pricing the invoice backwards into the payer's asset             | `apps/api/src/services/x402.ts` — `#priceCrossAsset`     |
| Exact-output quote against Uniswap's QuoterV2                    | `packages/providers/swap-uniswap/src/adapter.ts`         |
| Encoding `exactOutputSingle` for `SwapRouter02`                  | `packages/providers/swap-uniswap/src/route.ts`           |
| Plan before the payer's money moves, then send, persist, confirm | `packages/core/x402/src/cross-asset.ts`                  |
| The payer's change, as a liability rather than a gain            | `packages/core/ledger/src/accounts.ts` — `PAYER_SURPLUS` |
| The end-to-end run behind the figures above                      | `scripts/e2e-x402.ts`                                    |

Current boundaries, stated rather than implied: only the `exact` scheme, only over EVM; the Permit2
fallback is specified but not built; the broadcaster pays gas, so sub-cent resources invert the
economics until a sponsorship path exists. Full detail in [docs/x402.md](./docs/x402.md).

### An MCP server the agent pays per call

`POST /x402/mcp` is an MCP server over the same rail. An agent connects, reads what the tools do,
calls one, receives a `402`, signs one authorization, and gets its answer — no account, no API key,
no dashboard. It sells the one thing Mayarin knows and the agent cannot look up: **how each payment
rail has actually been settling**, read from Mayarin's own settlements subgraph on Subgraph Studio.

| Method                     | Costs             |
| -------------------------- | ----------------- |
| `initialize`, `tools/list` | Free              |
| `tools/call`               | One authorization |

**Discovery is free and answers are paid**, and that line is the design rather than a convenience.
An agent cannot decide a price is worth paying for a tool it has not been allowed to read the
description of; a `402` on the catalogue is a shop with the lights off.

Two tools, both doing work on the data rather than returning a query result:

- **`rail_stats`** — per rail: samples, median headroom, and the worst and best observed. _Headroom_
  is the seconds an order had left before its deadline when it landed, so the minimum is the number
  that matters: Base Sepolia's median is 828 seconds and its worst settlement landed with 28, and a
  median on its own would call that rail comfortable.
- **`choose_rail`** — ranks the rails and returns the one to pay on with the reason in a line. Below
  `minSamples` observed settlements it says it is falling back rather than presenting the first rail
  as a decision.

Three refusals are as load-bearing as the answers, and none of them charges: arguments the tool will
not accept refuse **before** the gate, because `exact` gives the payer one signature and a resource
server cannot un-serve a response; no settlements observed at all is refused rather than sold,
because charging for "no rail has been observed" is charging an agent for our own outage; and a tool
that does not exist is a tool error, not a JSON-RPC error, because a model that cannot tell "the
server said no" from "the call never arrived" cannot decide whether retrying is worth anything.

Neither tool queries The Graph directly. Both read the cached observer the `402` itself reads,
because Subgraph Studio allows 3,000 queries a day _account-wide_ — a pay-per-query tool wired
straight through hands anyone who can pay a way to spend the whole deployment's budget.

Measured on Base Sepolia, 7 September — a Circle Agent Stack wallet buying one `choose_rail` call,
with no account and no API key:

|         |                                                                                                                                                         |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Payment | [`0xdce241e2…`](https://sepolia.basescan.org/tx/0xdce241e203e3de3fd1fcd2e2e421d5a7d97a5ff8174a3df2314a4bf73baf6c8b) — 100000 USDC, payer's gas **zero** |
| Answer  | `arc-testnet: median headroom 936.5s over 12 settlements`, read from live Studio data                                                                   |
| Ledger  | Intent `COMPLETED`, clearing `SUCCESS`, fee zero, postings balanced                                                                                     |

The agent paid ten cents to find out which rail to pay on.

**The Graph is load-bearing here, and checkable by deletion.** Remove the subgraph and the rail
choice does not quietly become a worse guess — it announces itself: `choose_rail` reports an
unobserved rail rather than presenting the first offered one as a decision, and with no settlements
observed at all the call is refused free rather than sold. The settlement indexer, for its part,
reads the chain directly again the moment a chain is no longer named in `SUBGRAPH_ENDPOINTS` — the
subgraph is an index over `PaymentCompleted`, never the record itself.

Trying it takes two commands. The first is free and needs no wallet:

```bash
curl -X POST $API/x402/mcp -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

The second pays for an answer, and sends the **same body** in both the request that receives the
`402` and the retry carrying the signature — a different one would be a different purchase settled
against the first one's authorization:

```bash
bun run scripts/e2e-x402.ts --url $API/x402/mcp --pay-to 0x… \
  --body '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"choose_rail","arguments":{"chains":["base-sepolia","arc-testnet"]}}}'
```

| What                                       | File                             |
| ------------------------------------------ | -------------------------------- |
| The MCP wire format, no domain in it       | `apps/api/src/mcp/protocol.ts`   |
| The two tools and what they refuse to sell | `apps/api/src/mcp/rail-tools.ts` |
| The free/paid line, and the gate ordering  | `apps/api/src/routes/mcp.ts`     |
| Ranking and summarising rails, pure        | `packages/core/x402/src/rail.ts` |
| Reading settlements from the subgraph      | `packages/providers/subgraph/`   |
| The subgraph itself                        | `packages/subgraph/`             |

## Deployed

Testnet only. Mainnet is deliberately unprovisioned until the documented security and deployment
gates are met, and must not reuse testnet state, contracts or credentials.

| Chain            | `PaymentRouter`                                                                                  | `DepositForwarderFactory`                                                                        |
| ---------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| Base Sepolia     | [`0xee7c5b5a…`](https://sepolia.basescan.org/address/0xee7c5b5a9eeaf667a6efb217a8a77534c873f7a9) | [`0x69c72C51…`](https://sepolia.basescan.org/address/0x69c72C5191149e85CD862FCcccC2A6F699E9582F) |
| Ethereum Sepolia | [`0xE54E800b…`](https://sepolia.etherscan.io/address/0xE54E800bfFD1fBb5756B7c5E6A4aa40Dd09210E7) | [`0xCa83514c…`](https://sepolia.etherscan.io/address/0xCa83514c0bef26B642f7A69b2ab529c2ab5d7958) |
| Arc Testnet      | [`0xee7c5b5a…`](https://testnet.arcscan.app/address/0xee7c5b5a9eeaf667a6efb217a8a77534c873f7a9)  | [`0x04cd74e7…`](https://testnet.arcscan.app/address/0x04cd74e77ac145b18d61c6c8d7939e3241dbb60a)  |

Settlements are indexed by a subgraph on Subgraph Studio for Base Sepolia and Arc Testnet:
`PaymentCompleted`, `ResidueRefunded`, and per-rail observations, cursored on `_meta.block.number`.
Source in [`packages/subgraph`](./packages/subgraph). It indexes `PaymentRouter` only — the x402 rail
emits nothing it can see.

## The ETHOnline 2026 entry

Mayarin is entered in [ETHOnline 2026](https://ethglobal.com/events/ethonline2026)
(4–16 September 2026) in the **Continuity** pool: the project predates the event,
so its work is documented in two lists rather than one.

**Pre-existing — merged before the window opened on 4 September 2026.** The
clearing engine, double-entry ledger, deposit matching, `PaymentRouter` and
factory contracts, quoting and liquidity routing, the commerce surfaces (catalog,
links, invoices, hosted checkout), the merchant dashboard, the TypeScript SDK, the
WooCommerce plugin, and the documentation set — Phases 1–3. The x402 protocol
spine (#220–#230: facilitator port, resource registry, replay key, HTTP surface)
merged on 3 September, the day before the window opened, and is listed here rather
than claimed for the event.

**Built during the window, 4–13 September 2026.** Three partners, each occupying a
position the flow actually needs:

| Partner      | Built in the window                                                                                                                                                                                    | Measured on chain                                                                                                                                                                                                                                                    |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The Graph    | The settlements subgraph (`v0.0.2` on Base Sepolia and Arc testnet), the settlement indexer reading it, rail statistics, and the paid MCP server above — a second Graph product beside Subgraph Studio | A Circle agent wallet paid $0.10 for one `choose_rail` call: [`0xdce241e2…`](https://sepolia.basescan.org/tx/0xdce241e203e3de3fd1fcd2e2e421d5a7d97a5ff8174a3df2314a4bf73baf6c8b), answered from live Studio data                                                     |
| Arc (Circle) | USDC-native settlement on Arc testnet, a merchant Safe per chain, and Circle Agent Stack contract-account payers whose EIP-1271 signatures the token accepts                                           | Paid x402 runs on Arc, payer's gas zero: [`docs/evidence/`](./docs/evidence/)                                                                                                                                                                                        |
| Uniswap      | Cross-asset x402 — exact-output swaps priced backwards from the invoice, so an agent holding any listed asset pays a merchant settled in another                                                       | EURC payer, USDC merchant: [`0x254b93ce…`](https://sepolia.basescan.org/tx/0x254b93cec1a73279e12968938c1c491133c5556b4adb9e71cea070e0abc8affa) / [`0xb1436735…`](https://sepolia.basescan.org/tx/0xb143673599a6b05cd95676f0bbec7ffc35f9f99563bf45c6f26468944eb38a07) |

The same window also shipped work with no sponsor attached and load-bearing
regardless: the multichain counter and chain-aware exact-output quoting (#244,
#258), merchant-owned agent endpoints and the SDK gate (#269, #274, #283–#287),
one managed wallet address per EVM chain, Ethereum mainnet-shaped rail assets
(#289), wider fiat currency coverage (#288), a rail-liveness ranking on the
payer's checkout (#260, #280), a fee minimum under the Mayarin fee (#290), and
self-service merchant registration (#291).

Every partner claim above traces to a transaction hash or a file under
[`docs/evidence/`](./docs/evidence/), not to a screenshot — and The Graph's place
in the flow is checkable by deletion, described under **Agent payments** above.

What shipped with which PR, what was measured rather than read from a doc, and
what remains before submissions close on 13 September lives in
[ROADMAP.md](./ROADMAP.md).

## Quick start

Requires [Bun](https://bun.sh) 1.4+, Node 22.12+, and Docker. Foundry only for Solidity work.

```bash
git clone https://github.com/playriglabs/mayarin.git
cd mayarin

bun run setup            # install, write .env, start Postgres, migrate
bun run setup -- --seed  # optional: first merchant account and API key

bun run dev:all          # core API + chain worker + dashboard + checkout
```

`setup` is also the repair path: `-- --check` reports configuration drift and changes nothing,
`-- --reset-db` rebuilds only the guarded local database.

A payment link from a server-side integration:

```ts
import { createMayarin } from "@mayarin/sdk";

const mayarin = createMayarin({
  baseUrl: "https://api-testnet.mayarin.xyz",
  secretKey: process.env.MAYARIN_SECRET_KEY,
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

Secret keys stay on the server. Browsers use `createMayarinBrowser` with a publishable key and get a
deliberately restricted commerce surface. See [`packages/sdk`](./packages/sdk/README.md).

## What holds it together

- **Money is never a float.** A `Money` is a `bigint` count of an asset's minor units plus its code.
  Rates and fees are integers — basis points, minor units per whole unit. No float reaches a
  calculation, for 2-decimal fiat and 18-decimal ERC-20 alike.
- **Nothing mutates a balance directly.** Value moves only through balanced double-entry postings;
  an unbalanced one raises `LedgerImbalanceError`.
- **Aggregates are immutable.** A transition returns a new value with an incremented `version`,
  which is also the optimistic-locking token. Concurrent writes raise `ConcurrencyError`.
- **Execution is bounded.** A signed settlement minimum, a deadline and a slippage policy make a
  silent underfill impossible.
- **State changes are replay-safe.** Clearing steps, chain observations, ledger postings, creation
  requests and webhook deliveries are all idempotent.
- **On-chain truth wins.** The ledger is an auditable derived view, never a substitute for confirmed
  chain evidence.
- **Custody boundaries are explicit.** The three paths make different trust assumptions and are
  documented separately rather than averaged into one claim.
- **Commerce is optional.** The Payment Intent is the stable boundary — use the raw primitives
  without adopting the catalog, links or dashboard.

Expected failures are **thrown, not returned**: every domain error extends `MayarinError` with a
`code` and a `retryable` flag, and `apps/api/src/errors.ts` maps the taxonomy onto HTTP status in one
place. The reasoning, and the rest of the style guide, is in the `functional-programming` skill under
[`.agents/skills/`](./.agents/skills/).

## Repository map

Bun workspace monorepo.

| Path                                       | Responsibility                                                   |
| ------------------------------------------ | ---------------------------------------------------------------- |
| `apps/api`                                 | Public payment and commerce API; hosted checkout, invoices, x402 |
| `apps/chain-worker`                        | Wallet watcher, settlement indexer, deposit-path executor        |
| `apps/dashboard` · `apps/dashboard-api`    | Merchant operations UI and its tenant-scoped API                 |
| `apps/checkout-ui` · `apps/pay-proxy`      | Buyer checkout and its restricted buyer-origin proxy             |
| `apps/demo` · `apps/docs` · `apps/landing` | Reference storefront, API documentation, marketing site          |
| `packages/core/*`                          | Pure domain modules and the ports they define                    |
| `packages/providers/*`                     | EVM, oracle, swap, subgraph, settlement and wallet adapters      |
| `packages/contracts/payment-router`        | `PaymentRouter`, deposit forwarders, Foundry tests               |
| `packages/subgraph`                        | The Graph subgraph indexing `PaymentRouter` settlements          |
| `packages/db`                              | Drizzle schema, migrations, Postgres repositories                |
| `packages/sdk` · `packages/embed`          | TypeScript client SDK and embeddable checkout                    |
| `plugins/woocommerce`                      | WooCommerce integration                                          |

Conventions in full: [AGENT.md](./AGENT.md).

## Built with

| Layer                | Technology                                             |
| -------------------- | ------------------------------------------------------ |
| Runtime and language | Bun, TypeScript strict with `noUncheckedIndexedAccess` |
| APIs                 | Hono, Zod                                              |
| Data                 | PostgreSQL, Drizzle ORM                                |
| Contracts            | Solidity, Foundry, OpenZeppelin                        |
| EVM                  | viem                                                   |
| Quotes and execution | Uniswap, 0x, LiFi, Pyth, Chainlink adapters            |
| Indexing             | The Graph — Subgraph Studio                            |
| Wallets              | Safe smart accounts, Turnkey                           |
| Agent payments       | x402 v2, EIP-3009, EIP-712                             |
| Web                  | Astro, React, Vite, Tailwind CSS                       |
| Quality              | Turbo, Biome, Prettier, Lefthook                       |

## Development

| Command                              | Purpose                                                 |
| ------------------------------------ | ------------------------------------------------------- |
| `bun run dev`                        | Core payment API on `http://localhost:3000`             |
| `bun run dev:all`                    | The main local application graph, through Turbo         |
| `bun run check`                      | The complete local gate: format, typecheck, tests       |
| `bun test packages/core/clearing`    | One package; add `-t "name"` for one test               |
| `bun run db:generate` / `db:migrate` | Generate after a schema change, then apply              |
| `bun run test:contracts`             | Foundry suite (needs Foundry)                           |
| `bun run build:contracts-abi`        | Rebuild contracts and regenerate the shared ABI package |

Postgres integration tests are opt-in, because they truncate every table they touch. The runner
refuses a target that does not end in `_test`, or that resolves to the same database as
`DATABASE_URL`:

```bash
docker exec mayarin-postgres createdb -U mayarin mayarin_test
DATABASE_URL=postgres://mayarin:mayarin@localhost:5433/mayarin_test \
  bun run packages/db/src/migrate.ts
TEST_DATABASE_URL=postgres://mayarin:mayarin@localhost:5433/mayarin_test \
  bun test packages/db
```

Git hooks install with `bun install`: pre-commit runs Biome and Prettier over staged files, pre-push
runs the workspace typecheck and the full test suite.

Deployments are manual and target-explicit — a git push deploys nothing. Read
[docs/deployment.md](./docs/deployment.md) before running `bun run deploy:testnet`.

## Documentation

[`docs/`](./docs/README.md) is the design record, and it is expected to stay in sync with the code.

| Start here                                           | For                                                 |
| ---------------------------------------------------- | --------------------------------------------------- |
| [Architecture](./docs/architecture.md)               | Layers, execution paths, code boundaries            |
| [Clearing Engine](./docs/clearing-engine.md)         | The state machine, idempotency, recovery            |
| [Money](./docs/money.md)                             | Assets, precision, parsing, formatting              |
| [Chain Layer](./docs/chain.md)                       | Contract events, deposit matching, finality, reorgs |
| [Liquidity and routing](./docs/liquidity-routing.md) | Quotes, oracles, venues, locks                      |
| [Agent payments](./docs/x402.md)                     | The agent rail, cross-asset settlement, MCP         |
| [REST API](./docs/api.md)                            | Public reference and versioning                     |
| [Threat Model](./docs/threat-model.md)               | Assumptions, mitigations, accepted risks            |

Also: [Ledger](./docs/ledger.md), [Payment Intent](./docs/payment-intent.md),
[Wallets](./docs/wallet.md), [Configuration](./docs/configuration.md),
[Compliance](./docs/compliance.md), [Arc rail](./docs/arc.md), [Embed](./docs/embed.md),
[WooCommerce](./docs/woocommerce.md), [Deployment](./docs/deployment.md). The canonical interactive
API reference is at [docs.mayarin.xyz](https://docs.mayarin.xyz).

## Where this actually is, right now

Shipped and running on testnet: the payment and clearing core, double-entry accounting, contract and
deposit execution, quotes with oracle guards, commerce and hosted checkout, the merchant dashboard,
wallet infrastructure, webhooks, the TypeScript SDK, and agent payments behind `X402_ENABLED`.

Not done, and not pretended otherwise:

- Fiat rails (QRIS, bank transfer) and the stablecoin off-ramp are outside the MVP — later phases
  with their own custody and regulatory perimeter.
- Mainnet is planned, not provisioned.
- The deposit path briefly holds the payer asset. The contract path does not.
- Gas abstraction, settlement splitting, wider chain coverage and the complete browser passkey
  ceremony remain roadmap work.
- Screening has a provider port and an honest disabled default. KYC, freeze handling, exports and
  retention are not complete compliance products.
- Testnet pool depth is not market depth. The oracle deviation guard is widened on testnet and must
  be tightened before mainnet.

Item-level status: [docs/roadmap.md](./docs/roadmap.md); current working state in
[ROADMAP.md](./ROADMAP.md).

## Contributing

Contributions should preserve the system's financial and architectural invariants.

1. Read [AGENT.md](./AGENT.md), [Architecture](./docs/architecture.md), and the domain document for
   the area you are changing.
2. Add tests at the narrowest layer that owns the behavior.
3. Update the design documentation when an invariant, API contract, custody boundary or deployment
   assumption changes.
4. Run `bun run check` before opening a pull request — plus the contract or WooCommerce suites when
   those areas change.

Good first contributions: tests, documentation, provider adapters, developer experience, and
narrowly scoped roadmap items that do not weaken tenant isolation, exact-money handling, idempotency
or custody controls.

Use [GitHub Issues](https://github.com/playriglabs/mayarin/issues) for reproducible bugs and scoped
proposals. Include the affected package, expected versus actual behavior, and a minimal sanitized
log — never secrets, keys, customer data or production connection strings.

## Security

Payment and wallet code is security-sensitive. **Report vulnerabilities privately** — contact the
maintainers to arrange a channel before disclosing anything publicly. This repository does not yet
publish a `SECURITY.md` or a disclosure address.

Security-relevant changes must account for tenant isolation; authorization, CSRF and API-key
permissions; exact money and quote-lock behavior; replay and idempotency boundaries; finality,
reorgs and RPC failure; signer, treasury and merchant-wallet separation; contract upgrade and
timelock controls; and the different custody assumptions of the three execution paths. See
[Threat Model](./docs/threat-model.md), [Quote Signing](./docs/quote-signing.md), and
[Wallets](./docs/wallet.md).

## License

[Apache License 2.0](./LICENSE) — copyright 2026 Playrig Labs. The Solidity sources under
`packages/contracts/payment-router` carry their own `SPDX-License-Identifier: MIT` headers and stay
MIT; MIT is compatible with Apache-2.0, so a consumer of this repository may rely on both.

---

<div align="center">

**Build once. Settle anywhere.**

</div>
