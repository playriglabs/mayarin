# ETHOnline 2026 — Mayarin Agent Rail

**Event: 4–16 September 2026. Track: Continuity.**

This file is the working state of Mayarin's ETHOnline entry, written so an agent
or a person arriving cold can act without re-deriving anything. For the
product's own phase plan, see [`docs/roadmap.md`](./docs/roadmap.md) — this file
does not replace it and does not describe Mayarin outside the hackathon.

Governance lives in [`AGENT.md`](./AGENT.md). Read it first; the ports-and-adapters
rule it describes constrains everything below.

---

## The entry, in one paragraph

**Mayarin Agent Rail** is an [x402](https://github.com/coinbase/x402) payment
rail: an AI agent requests a resource, receives `402 Payment Required` with
machine-readable terms, signs an authorization for exactly the stated amount,
retries, and gets the resource. It never registered, never held an API key,
never saw a checkout page. The merchant is priced in their own currency and
settled in a stablecoin, exactly as they are today.

Six sponsors are entered, and each occupies a position the rail actually needs
filled — a chain, a wallet, a swap direction, a price guard, a discovery
surface. None is a wrapper written for a prize.

| RFC                                                       | Sponsor      | Role in the flow                                      | Pool    |
| --------------------------------------------------------- | ------------ | ----------------------------------------------------- | ------- |
| [#207](https://github.com/playriglabs/mayarin/issues/207) | —            | The spine: x402 v2 over the clearing engine           | —       |
| [#208](https://github.com/playriglabs/mayarin/issues/208) | Arc (Circle) | USDC-native settlement rail; agent wallets            | $10,000 |
| [#209](https://github.com/playriglabs/mayarin/issues/209) | Hedera       | Second rail; the live gated service, via Blocky402    | $6,000  |
| [#210](https://github.com/playriglabs/mayarin/issues/210) | Privy        | Merchant organization wallet; payer-side signing port | $5,000  |
| [#211](https://github.com/playriglabs/mayarin/issues/211) | Uniswap      | Exact-output swap, so the merchant is paid exactly    | $5,000  |
| [#212](https://github.com/playriglabs/mayarin/issues/212) | Bazantic     | Discovery — how an agent finds the rail at all        | $3,000  |
| [#213](https://github.com/playriglabs/mayarin/issues/213) | Chainlink    | The reference price that can refuse an execution      | $500    |

Umbrella: [#214](https://github.com/playriglabs/mayarin/issues/214).

**Cut order if the window tightens:** Chainlink, then Bazantic, then Uniswap.
Arc, Hedera and #207 are not cut.

---

## Shipped

Twelve PRs, all merged to `main`. The spine is done; what remains is adapter
work on a rail that exists and is tested.

### The rail

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
| [#226](https://github.com/playriglabs/mayarin/pull/226) | The HTTP surface: `requirePayment`, discovery, facilitator endpoints |

### Repository health, fixed along the way

| PR                                                      | What landed                                                          |
| ------------------------------------------------------- | -------------------------------------------------------------------- |
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

`packages/core/x402` imports only `@mayarin/chain` and `@mayarin/shared`. Keep
it that way; the layout in `AGENT.md` exists to protect exactly that.

---

## What a new agent most needs to know

Seven facts that are expensive to rediscover and cheap to state.

**1. `X402_ENABLED` is off by default.** Nothing in the rail runs until it is
true _and_ `OPERATOR_PRIVATE_KEY` is set. Without a key there is nothing to
broadcast an authorization with, so the container returns `undefined` and the
routes answer 404 — absent rather than broken.

**2. A facilitator's `success: true` is a claim, not a settlement.** Never
advance a payment on an HTTP response. `confirmSettlement` reads the transaction
back off the chain and checks it is _this_ payment — right token, right
recipient, full amount. A real transfer of one atomic unit of some other token
would otherwise settle an invoice.

**3. The payer's echo is never the source of requirements.** A `PaymentPayload`
carries back the requirements it chose; `selectRequirements` reads it for two
fields only — which network, which asset — and returns our own copy for
everything else. Verifying against the echo would verify a payment against its
own claims.

**4. `maxTimeoutSeconds` is derived from the quote lock, never configured beside
it.** `X402_QUOTE_TTL_SECONDS` is the only knob. The other arrangement is one
this repository has already paid for: a quote TTL shorter than the deadline it
was paired with produced `ASSET_RECEIVED` after expiry, an `ExpiredOrder`
revert, and eventually `EXECUTION_EXHAUSTED`.

**5. Ask the chain, not the documentation.** Arc's own docs describe its USDC
interface as `transferFrom`, `approve` and allowances and mention EIP-3009
nowhere; the contract implements it, and EIP-2612 besides. `EvmAssetCapabilityProbe`
reads it, and calls an invented selector first — a contract that _answers_ that
is refused rather than described, because the probe cannot tell truth from noise
there.

**6. Every execution-path branch used to ask `!== "on-chain-contract"`.** That
was right with two paths and silently wrong with three. Use
`usesDepositAddress` and `awaitsFacilitatorSettlement`. `usesDepositAddress(undefined)`
is `true` on purpose — the field's own default is deposit-match.

**7. Hand-written migrations must also be registered in
`packages/db/migrations/meta/_journal.json`.** A `.sql` file the journal does
not name is skipped: the migrator prints "Migrations applied", records a row,
exits zero, and creates nothing. `packages/db/test/journal.test.ts` now catches
it.

### Measured, not assumed

Read off Arc testnet on 3 September 2026 and worth not re-deriving:

| Fact                     | Value                                                                                                       |
| ------------------------ | ----------------------------------------------------------------------------------------------------------- |
| Arc testnet chain id     | `5042002`                                                                                                   |
| Hedera testnet / mainnet | `296` / `295`                                                                                               |
| Arc USDC                 | `0x3600000000000000000000000000000000000000` — `FiatTokenV2` behind an EIP-1967 proxy, **not** a precompile |
| Arc USDC capability      | `eip3009` ✓ · `eip2612` ✓ · domain `{USDC, 2}`                                                              |
| Arc EURC                 | `0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a` — `eip3009` ✓ · domain `{EURC, 2}`                             |
| Arc Permit2              | deployed · `x402ExactPermit2Proxy` **not** deployed                                                         |
| Arc decimals             | native view 18, ERC-20 view 6 — **one balance**, factor 10^12                                               |
| Arc mainnet              | not live at time of writing; absent from `CHAIN_IDS` on purpose                                             |

**The Arc decimal split is the one fact that corrupts accounting rather than
display.** Two `AssetCode`s for one Arc balance counts the same money twice, and
every reconciliation afterwards is wrong _while still balancing_.

---

## Next

### Immediately, before writing code

- [ ] **Confirm Continuity registration with each of the six sponsors, in the
      form that sponsor requires.** Arc states it outright. Answers take hours;
      send first. A submission filed against the wrong track is a
      disqualification discovered at judging.
- [ ] Bazantic account (owner: ky) — least documented sponsor, longest lead time.

### #208 — Arc

- [ ] Deploy `PaymentRouter`, `TimelockController`, `DepositForwarderFactory` to
      Arc testnet; verify. Throwaway v0 — the address must not reach the SDK,
      the docs, or a demo link.
- [ ] Configure `CHAIN_RPC_URLS`, `CHAIN_ASSETS`, `CHAIN_NATIVE_ASSETS`,
      `CHAIN_CONFIRMATIONS` for `arc-testnet`; set `X402_ENABLED=true`.
- [ ] **Call `EvmAssetCapabilityProbe` from the composition root at boot.** It
      is written, tested and verified against real contracts, and nothing calls
      it yet. This is the one loose end inside the merged work.
- [ ] Audit the native-decimal assumption at the four sites `docs/chain.md`
      names, before trusting any Arc balance.
- [ ] Register a merchant resource; pay it with an agent, end to end.
- [ ] Circle Agent Stack as the payer, spending under a Circle policy — and show
      the policy refusing an over-limit payment.
- [ ] Architecture diagram, demo video, README (Arc submission requirements).

Open questions recorded in #208: DEX liquidity on Arc testnet, whether Pyth and
Chainlink feeds exist there, and the right confirmation depth for a new L1.

### #209 — Hedera

- [ ] `packages/providers/x402-blocky402` implementing `X402Facilitator`.
- [ ] Find Hedera testnet USDC and probe it for EIP-3009. If absent, the
      `permit2` method is the fallback and `x402ExactPermit2Proxy` has to be
      deployed there.
- [ ] Host `GET /x402/fx/quote` gated and publicly reachable for judging.
- [ ] Demo agent script under `scripts/` — no API key anywhere in it. That
      absence _is_ the demo.
- [ ] Measure `eth_getLogs` through HashIO before running `SettlementIndexer`
      against it.
- [ ] Contracts verified on HashScan; video ≤5 min showing a paid request
      execute.

### #210 — Privy

- [ ] `packages/providers/privy` implementing `WalletProvider` (organization
      wallets, policies, key quorums, intents).
- [ ] The **`AgentWallet` port** — new, in core. `WalletProvider` structurally
      cannot express "sign this payload" and that refusal is deliberate; see
      `packages/core/wallet/src/provider.ts`. A closed intent union, and the
      adapter builds the typed data.
- [ ] Circle implements the same port (#208), which is what proves it is not a
      Privy-shaped hole.

Confirmed already: Privy server wallets sign arbitrary EIP-712 via
`eth_signTypedData_v4`.

### #211 — Uniswap

- [ ] Widen `SwapVenue` to a `SwapRequest` with an `exact-output` direction.
- [ ] Implement it in `packages/providers/swap-uniswap`; 0x and LiFi throw
      `ConfigurationError` for a direction they cannot serve.
- [ ] Post payer surplus through a balanced ledger entry — never absorb it.
- [ ] `FEEDBACK.md`, the Uniswap Developer Feedback Form, and a README naming
      the exact contracts and lines to read.

### #212 — Bazantic

- [ ] x402/MPP Gateway over the public API, with **scoped** credentials.
- [ ] Three recipes; the continuity one is an A/B with the recipe as the only
      variable. Report the difference honestly, including if it is small.

### #213 — Chainlink

- [ ] On-chain deviation guard in `PaymentRouter` — the current Chainlink use is
      off-chain and does **not** qualify for the track.
- [ ] Sequence with #12: two `Order` struct changes, one redeploy.

### Submission, 14–16 September

Two full days of work, not slack. Six videos at different angles, an
architecture diagram for Arc, `FEEDBACK.md` and the developer form for Uniswap,
three screen recordings for Bazantic, HashScan verification for Hedera, and a
README per submission separating pre-existing work from work done in the window.

---

## Known risks

**The Arbitrum Buildathon overlap is a conflict, not a scheduling detail.** Its
window is 14 September – 1 October and §7.1 requires headline work inside it, so
ETHOnline work done 4–13 September counts for ETHOnline and **not** for
Arbitrum. Separately, its staged payout makes the second and third tranches
conditional on building **exclusively on an Arbitrum chain** — which deploying
to Arc and Hedera contradicts. Taken knowingly.

**Third parties in the critical path of a judged demo** — Blocky402, Bazantic,
HashIO, Circle. Record fixtures early so tests never depend on a live service,
and keep a fallback narrative for each.

**Who pays gas for micro-payments.** In the `exact` scheme the payer signs and
the facilitator broadcasts, so Mayarin's treasury funds gas on every call. At
sub-cent resources that inverts. Not solved; it must at least be measured and
posted so the loss is visible rather than silent.

**Broadcast serialisation.** One operator key signs every settlement and a nonce
belongs to the key, not to a payment. `LocalX402Facilitator` serialises
broadcasts for this reason. The treasury executor meets this once per payment;
an x402 rail meets it once per API call.

---

## Not entered

**1inch Aqua** ($7,000) needs a DeFi position on SwapVM; Mayarin is not a
position product. **Hedera tokenization and harness** ($8,000) is ERC-3643
territory.

Cut for capacity rather than fit, and worth revisiting after the event
regardless of the prize: **The Graph** ($15,000) — a settlement subgraph would
replace `SettlementIndexer`'s `eth_getLogs` polling and fix a known bottleneck;
**ENS** ($5,000) — merchant and agent namespaces on ENSv2; **World** ($7,000) —
human-backed agent authorization, a real question for a rail that lets agents
spend.

---

## Running it

```bash
nvm use                          # Node 22, required by Astro 7
bun install
bun run db:up && bun run db:migrate
bun run check                    # format:check + typecheck + test
```

The Postgres integration suite is opt-in and **truncates every table it
touches** — never point `TEST_DATABASE_URL` at a development database:

```bash
docker exec mayarin-postgres createdb -U mayarin mayarin_test
DATABASE_URL=postgres://mayarin:mayarin@localhost:5433/mayarin_test \
  bun run packages/db/src/migrate.ts
TEST_DATABASE_URL=postgres://mayarin:mayarin@localhost:5433/mayarin_test \
  bun test packages/db
```

`bun run --cwd packages/db migrate` loads the root `.env` and will ignore an
inline `DATABASE_URL`; call the script directly, as above.
