# ETHOnline 2026 — Mayarin Agentic Payments

**Event: 4–16 September 2026. Track: Continuity.**

Working state of Mayarin's ETHOnline entry, written so an agent or a person
arriving cold can act without re-deriving anything. For the product's own phase
plan see [`docs/roadmap.md`](./docs/roadmap.md); this file is scoped to the event
and does not replace it.

Governance lives in [`AGENT.md`](./AGENT.md). Read it first — the
ports-and-adapters rule it describes constrains everything below.

---

## The idea

**Mayarin is not becoming an AI product.** The thesis is unchanged — one
programmable clearing layer — and what widened is a single axis: who is allowed
to be a payer.

```text
today      Human       → Mayarin → Merchant
           Application → Mayarin → Merchant
this event AI agent    → Mayarin → Merchant · Agent · API
```

An autonomous agent is a **payer class**, not a product line. It receives a
payment intent — _buy this API call_, _pay this invoice_, _settle $50 USDC to
this merchant_ — and Mayarin handles authorization, quote, route, swap,
settlement and receipt, exactly as it does for a person at a checkout. The agent
never learns what a chain is, where liquidity comes from, or what gas costs.

That framing is the backbone, not a bounty. Every sponsor below occupies a
position it actually needs filled.

**The agent signs exactly one thing:** an authorization for an exact amount, in
an asset it already holds. It never touches gas, never holds the merchant's
asset, never sees an address. That sentence is provable on screen, which is why
it is the pitch rather than "agents don't need to understand blockchain".

---

## Sponsors

| RFC                                                       | Sponsor      | Position in the flow                                        | Pool    |
| --------------------------------------------------------- | ------------ | ----------------------------------------------------------- | ------- |
| [#207](https://github.com/playriglabs/mayarin/issues/207) | —            | The spine: x402 v2 over the clearing engine — **shipped**   | —       |
| [#208](https://github.com/playriglabs/mayarin/issues/208) | Arc (Circle) | Stablecoin clearing and settlement rail                     | $10,000 |
| [#209](https://github.com/playriglabs/mayarin/issues/209) | Hedera       | x402 agentic commerce — a live gated service                | $6,000  |
| [#231](https://github.com/playriglabs/mayarin/issues/231) | The Graph    | Agent payment intelligence — choose the rail from live data | $15,000 |
| [#211](https://github.com/playriglabs/mayarin/issues/211) | Uniswap      | Autonomous liquidity execution — pay with what you hold     | $5,000  |
| [#210](https://github.com/playriglabs/mayarin/issues/210) | Privy        | Agent wallet and spending policy                            | $5,000  |
| [#232](https://github.com/playriglabs/mayarin/issues/232) | —            | The demo agent — makes all of the above legible             | —       |

**Stretch, not cut:** [#213](https://github.com/playriglabs/mayarin/issues/213)
Chainlink — $500 for a contract change and a redeploy sequenced against #12 is
the worst trade in the batch, though the engineering argument survives the prize
decision. [#212](https://github.com/playriglabs/mayarin/issues/212) Bazantic —
same discovery story as the Subgraph MCP, smaller track, less documented.

Umbrella: [#214](https://github.com/playriglabs/mayarin/issues/214).

---

## The demo is the deliverable

Six sponsors, one flow, five minutes of a judge's attention. If the demo is _"an
agent pays for an API and gets data"_, then Arc, The Graph, Uniswap and Privy are
**invisible** — real, load-bearing, and never on screen.

So the agent prints its decisions ([#232](https://github.com/playriglabs/mayarin/issues/232)):

```
Agent: I need this FX quote. Price: $0.02.

  → Asking The Graph: which rail settled with the most headroom this hour?
       arc-testnet    58s median headroom, 0 failures  (n=340)
       base-sepolia   12s median headroom, 2 failures  (n=112)
  → Choosing arc-testnet: most headroom, no observed failures.

  → My wallet holds ETH. The merchant is paid in USDC.
       Uniswap exact-output: 0.0000071 ETH → 0.020000 USDC
  → Policy check: $0.02 ≤ $25 per payment ✓ · $0.34 of $100 today ✓

  → Signing an EIP-3009 authorization for exactly 0.020000 USDC…
  → Settled 0xabc…def on arc-testnet. Merchant credited Rp 320.

  (no API key was used; this agent has no account with anyone)
```

Every line is a decision the code already makes. The requirement is only that it
**say** what it did.

Each sponsor is load-bearing in a way a judge can verify by deletion:

| Remove          | What visibly breaks                                                   |
| --------------- | --------------------------------------------------------------------- |
| The Graph       | The rail choice becomes "first in the array", and the trace admits it |
| Uniswap         | An agent holding only ETH cannot pay a USDC price at all              |
| Privy           | Nothing stops the agent spending its whole balance on one call        |
| Arc             | The settlement has nowhere USDC-native to land                        |
| The rail (#207) | There is no `402`, and the agent needs an account                     |

Two more beats are part of the deliverable: the **no-signup moment** (`curl` from
a clean machine, no key, `402`, pay, resource — under 30 seconds) and the
**refusal** (the same agent, an over-limit payment, the policy visibly saying
no). A spending policy nobody has watched refuse anything is a claim.

---

## Shipped

Twelve PRs, merged. The spine is done; what remains is adapter work on a rail
that exists and is tested.

| PR                                                      | What landed                                                          |
| ------------------------------------------------------- | -------------------------------------------------------------------- |
| [#215](https://github.com/playriglabs/mayarin/pull/215) | Chain facts for `arc-testnet`, `hedera`, `hedera-testnet`            |
| [#216](https://github.com/playriglabs/mayarin/pull/216) | Protocol types, HTTP transport, the `exact`/EVM scheme               |
| [#220](https://github.com/playriglabs/mayarin/pull/220) | Facilitator port, settlement confirmation, the replay key            |
| [#221](https://github.com/playriglabs/mayarin/pull/221) | Resource registry and the price lock that bounds the payer's window  |
| [#222](https://github.com/playriglabs/mayarin/pull/222) | The `x402` execution path in the clearing engine                     |
| [#223](https://github.com/playriglabs/mayarin/pull/223) | Local facilitator — Mayarin broadcasts the payer's authorization     |
| [#224](https://github.com/playriglabs/mayarin/pull/224) | Token capability probe, with a control call                          |
| [#225](https://github.com/playriglabs/mayarin/pull/225) | Postgres adapter for the resource registry (migration 0026)          |
| [#226](https://github.com/playriglabs/mayarin/pull/226) | HTTP surface: `requirePayment`, discovery, facilitator endpoints     |
| [#227](https://github.com/playriglabs/mayarin/pull/227) | Migration-journal guard, three tests rotted since #61, two high CVEs |
| [#228](https://github.com/playriglabs/mayarin/pull/228) | Astro 5 → 7 and the Node 22 floor it brings                          |
| [#229](https://github.com/playriglabs/mayarin/pull/229) | `.nvmrc` names the major, so `nvm use` resolves                      |

### Where the code lives

```
packages/core/x402/            protocol types, exact/EVM scheme, transport codec,
                               resource registry, facilitator port, replay key
packages/core/x402/testing/    spec fixtures + fakes built to lie
packages/providers/x402-local/ reader (read-only) + facilitator (holds the key) + probe
packages/db/src/repositories/  x402.ts — Drizzle resource repository
apps/api/src/services/x402.ts  the application service
apps/api/src/routes/x402.ts    requirePayment, discovery, facilitator endpoints
apps/api/src/container.ts      createX402 — one facilitator per configured chain
```

`packages/core/x402` imports only `@mayarin/chain` and `@mayarin/shared`. Keep it
that way; the layout in `AGENT.md` exists to protect exactly that.

---

## What a new agent most needs to know

Seven rules, each with the failure it prevents.

**1. `X402_ENABLED` is off by default.** Nothing runs until it is true _and_
`OPERATOR_PRIVATE_KEY` is set. Without a key there is nothing to broadcast an
authorization with, so the container returns `undefined` and the routes answer
404 — absent rather than broken.

**2. A facilitator's `success: true` is a claim, not a settlement.** Never
advance a payment on an HTTP response. `confirmSettlement` reads the transaction
back off the chain and checks it is _this_ payment — right token, right
recipient, full amount. A real transfer of one atomic unit of some other token
would otherwise settle an invoice.

**3. The payer's echo is never the source of requirements.** A `PaymentPayload`
carries back the requirements it chose; `selectRequirements` reads it for two
fields only — which network, which asset — and returns our own copy for
everything else. Verifying against the echo checks a payment against its own
claims.

**4. `maxTimeoutSeconds` is derived from the quote lock, never configured beside
it.** `X402_QUOTE_TTL_SECONDS` is the only knob. The other arrangement is one
this repository has paid for: a quote TTL shorter than its paired deadline
produced `ASSET_RECEIVED` after expiry, an `ExpiredOrder` revert, and eventually
`EXECUTION_EXHAUSTED`.

**5. Ask the chain, not the documentation.** Arc's docs describe its USDC
interface as `transferFrom`, `approve` and allowances and mention EIP-3009
nowhere; the contract implements it, and EIP-2612 besides. The Graph's docs page
says Base Sepolia is unsupported; its own registry says otherwise. Both were
settled by reading the source of truth directly. `EvmAssetCapabilityProbe` calls
an invented selector first — a contract that _answers_ that is refused rather
than described, because the probe cannot tell truth from noise there.

**6. Every execution-path branch used to ask `!== "on-chain-contract"`.** Right
with two paths, silently wrong with three. Use `usesDepositAddress` and
`awaitsFacilitatorSettlement`. `usesDepositAddress(undefined)` is `true` on
purpose — the field's own default is deposit-match.

**7. Hand-written migrations must also be registered in
`packages/db/migrations/meta/_journal.json`.** A `.sql` file the journal does not
name is skipped: the migrator prints "Migrations applied", records a row, exits
zero, and creates nothing. `packages/db/test/journal.test.ts` now catches it.

### Measured, not assumed

Read off the chains and registries on 3–4 September:

| Fact                            | Value                                                                                                       |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Arc testnet / mainnet chain id  | `5042002` / `5042`                                                                                          |
| Hedera testnet / mainnet        | `296` / `295`                                                                                               |
| Arc USDC                        | `0x3600000000000000000000000000000000000000` — `FiatTokenV2` behind an EIP-1967 proxy, **not** a precompile |
| Arc USDC capability             | `eip3009` ✓ · `eip2612` ✓ · domain `{USDC, 2}`                                                              |
| Arc EURC                        | `0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a` — `eip3009` ✓ · domain `{EURC, 2}`                             |
| Arc Permit2                     | deployed · `x402ExactPermit2Proxy` **not** deployed                                                         |
| Arc decimals                    | native view 18, ERC-20 view 6 — **one balance**, factor 10^12                                               |
| The Graph: `base-sepolia`       | Subgraph Studio ✓ · Firehose ✓ · Substreams ✓                                                               |
| The Graph: `arc-testnet`, `arc` | Subgraph Studio ✓                                                                                           |
| The Graph: Hedera               | **absent from the registry entirely**                                                                       |

Read off Arc testnet on 4 September, before deploying anything to it:

| Fact                                 | Value                                                            |
| ------------------------------------ | ---------------------------------------------------------------- |
| `eth_chainId` · `web3_clientVersion` | `0x4cef52` (5042002) · `arc/v1`                                  |
| `PUSH0` · `MCOPY` · `TSTORE`         | all execute — `evm_version = "cancun"` needs no downgrade        |
| Control (`0xfe` INVALID)             | reverts `InvalidFEOpcode`, so those three answers mean something |
| Arc USDC probed                      | `eip3009` ✓ · `eip2612` ✓ · domain `{USDC, 2}`                   |
| Arc EURC probed                      | `eip3009` ✓ · `eip2612` ✓ · domain `{EURC, 2}`                   |
| Permit2 · Multicall3                 | 9152 bytes · 3808 bytes, both at their canonical addresses       |
| Base fee · gas price · gas limit     | 20 gwei · 25 gwei · 30M                                          |
| ArcScan                              | Blockscout API at `https://testnet.arcscan.app/api/`             |
| Block time                           | ~0.517s, measured over 1000 blocks                               |
| `eth_getLogs`: Alchemy free tier     | **10 blocks**, refused above it                                  |
| `eth_getLogs`: public endpoint       | 2000 blocks, capped at 20000 results (16777 in one such window)  |

Arc's own currency is USDC, so a deploy is priced in cents rather than in test
ETH nobody has.

**Arc's block time is what makes the polling indexer untenable there, not the
provider.** At ~0.5s per block, `CHAIN_LOG_RANGE=10` covers five seconds of chain
per call and `WATCHER_INTERVAL_MS=60000` asks for it once a minute — the watcher
loses twelve seconds of chain for every second it runs. Raising the range needs a
plan above the Alchemy free tier's 10-block cap. The real answer is the
`SettlementSource` port reading the subgraph instead of polling `eth_getLogs`,
which is #231's production argument rather than a bounty.

**The Arc decimal split is the one fact that corrupts accounting rather than
display.** Two `AssetCode`s for one Arc balance counts the same money twice, and
every reconciliation afterwards is wrong _while still balancing_.

The Graph's registry uses the same CAIP-2 ids `caip2Of` already emits, so network
identity needs no translation. It also corroborates Arc mainnet as `5042` from a
second independent source — the id #215 left out of `CHAIN_IDS` for being
unverifiable against a live endpoint.

---

## Next

### Before writing code

- [ ] **Confirm Continuity registration with every sponsor, in the form that
      sponsor requires.** Arc states it outright. Answers take hours; send first.
      A submission filed against the wrong track is a disqualification discovered
      at judging.

### #208 — Arc

- [x] Deploy `PaymentRouter`, `TimelockController`, `DepositForwarderFactory` to
      Arc testnet; verified on ArcScan. See **Deployed on Arc** below.
- [x] Configure `CHAIN_RPC_URLS`, `CHAIN_ASSETS`, `CHAIN_CONFIRMATIONS`,
      `PAYMENT_ROUTERS`, `CHAIN_START_BLOCKS` and `DEPOSIT_FORWARDERS` for
      `arc-testnet`. **`CHAIN_NATIVE_ASSETS` is deliberately left without an Arc
      entry**: Arc's native currency is USDC, 18 decimals in the native view and
      6 in the ERC-20 view over one balance, so declaring it native would give
      one balance two `AssetCode`s and count the same money twice.
- [ ] Set `X402_ENABLED=true` once an operator key is funded for broadcasting.
- [x] **Call `EvmAssetCapabilityProbe` from the composition root at boot.** Done:
      `AssetCapabilities` (core port + cache) is built in `createX402`, warmed by
      `apps/api/src/index.ts` before traffic, and `X402Service.paymentRequired`
      now takes the token's domain and transfer method from the chain rather
      than from the resource row.
- [ ] Audit the native-decimal assumption at the four sites `docs/chain.md`
      names, before trusting any Arc balance.
- [ ] Circle Agent Stack as the payer, spending under a Circle policy — including
      the policy refusing an over-limit payment.
- [ ] Architecture diagram, video, documentation, repo.

#### Deployed on Arc

4 September, 0.015 USDC all in — Arc's own currency is USDC, so gas is priced in
cents. Throwaway v0: these addresses must not reach the SDK, the docs, or a demo
link.

| Contract                  | Address                                      |
| ------------------------- | -------------------------------------------- |
| `PaymentRouter`           | `0xee7c5b5a9eeaf667a6efb217a8a77534c873f7a9` |
| `TimelockController`      | `0x0c006fc14063e3f78271312b975231e4bd6e8b00` |
| `DepositForwarderFactory` | `0x04cd74e77ac145b18d61c6c8d7939e3241dbb60a` |

The router and timelock carry **the same addresses as Base Sepolia** — same
deployer, same nonces, same `CREATE`. Harmless on chain, because the EIP-712
domain carries `chainId`. But an address no longer identifies a chain: read the
chain key in `PAYMENT_ROUTERS`, never the address. The factory differs only
because its nonce did.

Read back off Arc after the deploy: `signer()` matches `QUOTE_SIGNER_PRIVATE_KEY`,
USDC is whitelisted as both settlement and input asset, `paused() == false`, and
the factory's `INIT_CODE_HASH` is byte-identical to Base's — which is what keeps
one `DEPOSIT_FORWARDER_INIT_CODE_HASH` correct for every chain.

### #231 — The Graph

- [x] Subgraph over `PaymentCompleted` / `ResidueRefunded` — `packages/subgraph`,
      codegen and build green against `base-sepolia`. It also records
      `headroomSeconds` per settlement, which is the number the rail choice is
      about. **Deploying it needs a Studio key**, so that step is manual.
- [ ] Decide how x402 settlements are indexed. They never touch `PaymentRouter`,
      so `PaymentCompleted` carries none of them, and the token's
      `AuthorizationUsed` carries no `validBefore` — there is no headroom to read
      off it. Decide with the Arc deployment, not before.
- [ ] Same subgraph for `arc-testnet` once #208 deploys there.
- [x] `chooseRail` in `packages/core/x402/src/rail.ts` — pure, 11 tests, one per
      rule, including the fallback that announces itself. Ranks on **median**
      headroom (one lucky settlement cannot carry a rail), needs `minSamples`
      before a rail is ranked at all, and every tie-break is deterministic.
      Failures are reported and **not ranked on**: the number cannot come from
      the chain, so ranking on it would make the rail depend on how well we were
      recording, and `undefined` would quietly become zero.
- [x] Both subgraphs deployed to Studio and syncing without errors. See
      **Subgraphs live** below.
- [x] `SubgraphRailObservations` in `packages/providers/subgraph` implementing
      the `RailObservationSource` port. Reads samples rather than the `Rail`
      aggregate, because a running total is the one thing a median cannot be
      recovered from. Raises on an unreachable or erroring subgraph instead of
      reporting an empty rail — an outage and a rail that never settled are
      different facts. Run against both live endpoints: Base 78 samples, Arc 0,
      and the choice comes out `base-sepolia: median headroom 828s over 78
settlements`.
- [ ] Subgraph MCP in front of it, so the agent asks in natural language.
- [x] `SettlementSource` port so `SettlementIndexer` can read the subgraph instead
      of polling `eth_getLogs`. Per chain: a chain named in `SUBGRAPH_ENDPOINTS`
      is served by `SubgraphSettlementSource`, every other chain polls exactly as
      before. **`indexedHead` is what makes it safe** — the indexer's cursor moves
      across the range it asked about, so a subgraph that has not caught up must
      hold the cursor back rather than let it walk over blocks nobody read. A
      deployment stuck on an indexing error refuses to report progress at all.
- [x] Redeploy both subgraphs as `v0.0.2` and configure `SUBGRAPH_ENDPOINTS`.
      Verified live through `SubgraphSettlementSource`: `indexedHead` answers on
      both chains, a range query returns a `SettlementLog` complete with
      `logIndex` and `blockHash`, and the router guard refuses an endpoint
      pointed at a different router.
- [ ] Seed both testnets with real settlements before recording, or the fallback
      fires on camera. `bun run e2e -- --chain arc-testnet --asset USDC --amount
  0.25` is the tool: the chain is an argument now rather than a constant.
      **A deposit payment is the only thing that fills an empty rail** — x402
      never touches `PaymentRouter`, so no amount of agent traffic emits a
      `PaymentCompleted`; the deposit path does, because the treasury executor
      settles through the router.

#### Subgraphs live

| Network        | Query URL                                                                   | State                     |
| -------------- | --------------------------------------------------------------------------- | ------------------------- |
| `base-sepolia` | `https://api.studio.thegraph.com/query/1758657/mayarin-base-sepolia/v0.0.1` | 78 settlements            |
| `arc-testnet`  | `https://api.studio.thegraph.com/query/1758657/mayarin-arc-testnet/v0.0.1`  | 0 — router deployed today |

Base's headroom: median 828s, min 28s, max 1797s, none negative. **Three
settlements landed under a minute**, one of them at 28s. That tail is what a mean
would have hidden, and it is the reason `chooseRail` ranks on the median.

Arc being empty is correct rather than broken, and it is the condition worth
rehearsing: with no observations there, the choice falls to the fallback that
announces itself.

### #209 — Hedera

- [ ] `packages/providers/x402-blocky402` implementing `X402Facilitator`.
- [x] Find Hedera testnet USDC and probe it for EIP-3009. **Answered, and the
      answer is no.** Circle's USDC there is HTS token `0.0.429274`
      (`0x…068cda`): 147 bytes of facade, no `version()`, so no EIP-712 domain
      and no EIP-3009. Permit2 _is_ deployed at its canonical address (9152
      bytes). So the permit2 path applies, and it is not a small job — the
      facilitator and reader in `packages/providers/x402-local` are EIP-3009
      only, and `x402ExactPermit2Proxy` still has to be deployed. Decide between
      building that and letting Blocky402's facilitator carry Hedera before
      spending a day on it.
- [x] `GET /x402/fx/quote`, gated by `requirePayment` — the endpoint exists and
      prices through the same rate provider a payment uses. Still has to be
      **publicly reachable** on the testnet deployment for judging.

**The gap that blocked every one of these.** `X402ResourceRepository.save` had no
caller — no route, no script, no seed — so a running deployment could not be
given a resource at all, and nothing could serve a `402`. `POST
/admin/x402/resources` is that seam. The body names tokens and never their
EIP-712 domain or transfer method: both are probed off the contract, so a
resource cannot be created advertising terms no payer could sign.

- [ ] Measure `eth_getLogs` through HashIO before running `SettlementIndexer`
      against it.
- [ ] Contracts verified on HashScan; video ≤5 min showing a paid request execute.

### #211 — Uniswap

- [ ] Widen `SwapVenue` to a `SwapRequest` with an `exact-output` direction; 0x
      and LiFi throw `ConfigurationError` for a direction they cannot serve.
- [ ] Post payer surplus through a balanced ledger entry — never absorb it.
- [ ] `FEEDBACK.md`, the Developer Feedback Form, and a README naming the exact
      contracts and lines to read.

### #210 — Privy

- [ ] `packages/providers/privy` implementing `WalletProvider` — organization
      wallets, policies, key quorums, intents.
- [ ] The **`AgentWallet` port** — new, in core. `WalletProvider` structurally
      cannot express "sign this payload" and that refusal is deliberate; see
      `packages/core/wallet/src/provider.ts`. A closed intent union, and the
      adapter builds the typed data.
- [ ] The policy shown refusing an over-limit payment — #232 depends on it.

Confirmed: Privy server wallets sign arbitrary EIP-712 via `eth_signTypedData_v4`.
Privy's prizes are published; _Ledger_ is the one still "coming soon".

### #232 — The demo agent

- [ ] `scripts/demo-agent.ts` emitting the trace above from real execution.
- [ ] The refusal run (`--amount 500`), stopping at the policy check.
- [ ] The no-key `curl` sequence, recorded separately, under 30 seconds.
- [ ] Six cuts from one run, each opening on the right decision.
- [ ] Verify by deletion: remove each sponsor's step once and confirm the trace
      visibly changes, before recording.

### Submission, 14–16 September

Two full days of work, not slack. Six videos at different angles, an architecture
diagram for Arc, `FEEDBACK.md` and the developer form for Uniswap, HashScan
verification for Hedera, and a README per submission separating pre-existing work
from work done in the window. This is what most often sinks an ETHGlobal entry —
not the code.

---

## Known risks

**The Arbitrum Buildathon overlap is a conflict, not a scheduling detail.** Its
window is 14 September – 1 October and §7.1 requires headline work inside it, so
ETHOnline work done 4–13 September counts for ETHOnline and **not** for Arbitrum.
Separately, its staged payout makes the second and third tranches conditional on
building **exclusively on an Arbitrum chain** — which deploying to Arc and Hedera
contradicts. Taken knowingly.

**Agent-to-agent commerce is currently aspirational.** Four example flows, no
implementation. Either build the smallest real version — the FX quote endpoint is
already a service, so make the buyer a second agent and have the seller pay its
own upstream from what it earned, roughly half a day — or leave it out of the
pitch. A claim a judge can ask to see and we cannot show costs more than it wins.

**Third parties in the critical path of a judged demo** — Blocky402, HashIO,
Circle, Subgraph Studio. Record fixtures early so tests never depend on a live
service, record the canonical demo run early, and keep a fallback narrative.

**Who pays gas for micro-payments.** In the `exact` scheme the payer signs and the
facilitator broadcasts, so Mayarin's treasury funds gas on every call. At sub-cent
resources that inverts. Not solved; it must at least be measured and posted so the
loss is visible rather than silent.

**Broadcast serialisation.** One operator key signs every settlement and a nonce
belongs to the key, not to a payment. `LocalX402Facilitator` serialises broadcasts
for this reason. The treasury executor meets this once per payment; an x402 rail
meets it once per API call.

---

## Not entered

**1inch Aqua** ($7,000) needs a DeFi position on SwapVM; Mayarin is not a position
product. **Hedera tokenization and harness** ($8,000) is ERC-3643 territory.
**Ledger** ($5,000) has not published its prizes — worth watching.

Cut for capacity and worth revisiting after the event: **ENS** ($5,000) — merchant
and agent namespaces on ENSv2; **World** ($7,000) — human-backed agent
authorization, a real question for a rail that lets agents spend money.

---

## Running it

```bash
nvm use                          # Node 22, required by Astro 7
bun install
bun run db:up && bun run db:migrate
bun run check                    # format:check + typecheck + test
```

The Postgres integration suite is opt-in and **truncates every table it touches**
— never point `TEST_DATABASE_URL` at a development database:

```bash
docker exec mayarin-postgres createdb -U mayarin mayarin_test
DATABASE_URL=postgres://mayarin:mayarin@localhost:5433/mayarin_test \
  bun run packages/db/src/migrate.ts
TEST_DATABASE_URL=postgres://mayarin:mayarin@localhost:5433/mayarin_test \
  bun test packages/db
```

`bun run --cwd packages/db migrate` loads the root `.env` and ignores an inline
`DATABASE_URL`; call the script directly, as above.
