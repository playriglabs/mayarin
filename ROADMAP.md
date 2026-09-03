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

An AI agent receives a payment intent — _buy this API call_, _pay this invoice_,
_settle $50 USDC to this merchant_ — and Mayarin handles authorization, quote,
route, swap, settlement and receipt. The agent never learns what a chain is,
where liquidity comes from, or what gas costs.

This is the backbone, not a bounty. Every sponsor below occupies a position it
actually needs filled.

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

- [ ] Deploy `PaymentRouter`, `TimelockController`, `DepositForwarderFactory` to
      Arc testnet; verify. Throwaway v0 — the address must not reach the SDK, the
      docs, or a demo link.
- [ ] Configure `CHAIN_RPC_URLS`, `CHAIN_ASSETS`, `CHAIN_NATIVE_ASSETS`,
      `CHAIN_CONFIRMATIONS` for `arc-testnet`; set `X402_ENABLED=true`.
- [ ] **Call `EvmAssetCapabilityProbe` from the composition root at boot.**
      Written, tested and verified against real contracts — and nothing calls it
      yet. The one loose end inside the merged work.
- [ ] Audit the native-decimal assumption at the four sites `docs/chain.md`
      names, before trusting any Arc balance.
- [ ] Circle Agent Stack as the payer, spending under a Circle policy — including
      the policy refusing an over-limit payment.
- [ ] Architecture diagram, video, documentation, repo.

### #231 — The Graph

- [ ] Subgraph over `PaymentCompleted` / `ResidueRefunded`, deployed to Studio for
      `base-sepolia` **first** — it needs nothing from #208 and de-risks the whole
      Graph story.
- [ ] Same subgraph for `arc-testnet` once #208 deploys there.
- [ ] `chooseRail` in `packages/core/x402/src/rail.ts` — pure, one test per rule,
      including the fallback that announces itself.
- [ ] Subgraph MCP in front of it, so the agent asks in natural language.
- [ ] `SettlementSource` port so `SettlementIndexer` can read the subgraph instead
      of polling `eth_getLogs` — this is the production argument, and it fixes the
      2.5-blocks-per-tick bottleneck.
- [ ] Seed both testnets with real settlements before recording, or the fallback
      fires on camera.

### #209 — Hedera

- [ ] `packages/providers/x402-blocky402` implementing `X402Facilitator`.
- [ ] Find Hedera testnet USDC and probe it for EIP-3009. If absent, `permit2` is
      the fallback and `x402ExactPermit2Proxy` has to be deployed there.
- [ ] Host `GET /x402/fx/quote` gated and publicly reachable for judging.
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
