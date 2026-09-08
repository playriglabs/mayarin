# ETHOnline 2026 — Mayarin Agentic Payments

**Event: 4–16 September 2026. Track: Continuity.**
**Submissions close Sunday 13 September, 12:00 EDT — 23:00 WIB.** 14–16 September
is judging, not working time. An earlier version of this file read those two days
as slack for videos and write-ups; they do not exist.

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

**A submission selects at most three partners.** Not three prizes — three
partners, each carrying every track it offers. That cap, and not capacity, is
what decided the list below.

Mayarin has prior code, so the Classic pool is closed to it and only tracks open
to Continuity count. Chosen 6 September:

| RFC                                                       | Sponsor      | Position in the flow                                        | Open to us           |
| --------------------------------------------------------- | ------------ | ----------------------------------------------------------- | -------------------- |
| [#207](https://github.com/playriglabs/mayarin/issues/207) | —            | The spine: x402 v2 over the clearing engine — **shipped**   | —                    |
| [#231](https://github.com/playriglabs/mayarin/issues/231) | The Graph    | Agent payment intelligence — choose the rail from live data | **$10,000**, 6 slots |
| [#208](https://github.com/playriglabs/mayarin/issues/208) | Arc (Circle) | Stablecoin clearing and settlement rail                     | **$3,166**, 2 slots  |
| [#211](https://github.com/playriglabs/mayarin/issues/211) | Uniswap      | Autonomous liquidity execution — pay with what you hold     | **$2,000**, 2 slots  |
| [#232](https://github.com/playriglabs/mayarin/issues/232) | —            | The demo agent — makes all of the above legible             | —                    |

The Graph is the best slot in the set and its two open tracks are worth reading
literally:

- **AI Tooling or AI Use Case (Continuity), $5,000, three placements.** Judged in
  its own pool against other Continuity projects, not against net-new ones. Its
  description names "x402 payment tooling", "new or extended MCP servers" and
  "let your agent pay per query autonomously with x402" — the deliverable this
  repository already half owns.
- **Composable or Standardized Graph Products, $5,000, three placements.** No
  pool badge, so Continuity qualifies. It requires **two or more Graph products**
  and states that querying one Subgraph without composition does not qualify —
  which is exactly what we do today, so this track is worth nothing until the
  Subgraph MCP lands.

**Cut, and closed as not planned:**
[#209](https://github.com/playriglabs/mayarin/issues/209) Hedera,
[#210](https://github.com/playriglabs/mayarin/issues/210) Privy,
[#212](https://github.com/playriglabs/mayarin/issues/212) Bazantic and
[#213](https://github.com/playriglabs/mayarin/issues/213) Chainlink. Each carries
its reasoning on the issue. See **Why Hedera and Privy lost their slots** below.

**One thing was closed that should not stay closed.** The `AgentWallet` core port
lived inside #210 and has product value independent of any sponsor —
`WalletProvider` structurally cannot express "sign this payload", and that refusal
is deliberate (`packages/core/wallet/src/provider.ts`). No open issue represents
it now. Reopen it on its own after the event.

Umbrella: [#214](https://github.com/playriglabs/mayarin/issues/214).

### Why Hedera and Privy lost their slots

**Hedera** splits its pool so that the $6,000 agentic-payments track carries no
Continuity pool and a separate Continuity track carries $1,000. So the realistic
figure is $1,000, and reaching it is the largest piece of engineering left in the
batch: Hedera's USDC is HTS token `0.0.429274`, 147 bytes of facade with no
`version()`, therefore no EIP-712 domain and no EIP-3009. Permit2 is deployed,
but `x402ExactPermit2Proxy` is not, and both facilitator and reader in
`packages/providers/x402-local` are EIP-3009 only. Worst ratio in the set.

**Privy** has no code at all — a provider package _and_ a new core port, roughly
three days. Those three days come out of the Subgraph MCP, which is what unlocks
$5,000 of Graph. Both Privy tracks pay one winner with no second or third place.
And the adapter is throwaway: Turnkey is already this repository's wallet
provider, so the Privy work dies on 13 September while `CrossAssetSettler`,
exact-output `SwapVenue` and `PAYER_SURPLUS` are merged and stay.

The `AgentWallet` port is still worth building — it is a core port with product
value independent of any sponsor. What was dropped is the Privy adapter behind
it, not the seam.

---

## The demo is the deliverable

Three sponsors, one flow, **four minutes** of a judge's attention. If the demo is
_"an agent pays for an API and gets data"_, then Arc, The Graph and Uniswap are
**invisible** — real, load-bearing, and never on screen. Worse, that sentence
describes a genre: x402 is a theme across four sponsors at this event, so the
_shape_ of our demo will not distinguish it. Only the depth will, and depth does
not render on its own.

So the agent prints its decisions ([#232](https://github.com/playriglabs/mayarin/issues/232)):

```
Agent: I need this FX quote. Price: $0.02.

  → Asking The Graph: which rail settled with the most headroom this hour?
       arc-testnet    58s median headroom, 0 failures  (n=340)
       base-sepolia   12s median headroom, 2 failures  (n=112)
  → Choosing arc-testnet: most headroom, no observed failures.

  → My wallet holds EURC. The merchant is paid in USDC.
       Uniswap exact-output: 2.046810 EURC → 1.000000 USDC
  → Deviation guard: pool 2.05 EURC/USD against oracle 0.93 — within the
       configured bound for testnet. Proceeding.

  → Signing an EIP-3009 authorization for exactly 2.046810 EURC…
  → Settled 0x9f4bf25b… on arc-testnet. Merchant credited 1.000000 USDC.
       0.010236 EURC unspent, owed back to me.

  (no API key was used; this agent has no account with anyone)
```

Every line is a decision the code already makes. The requirement is only that it
**say** what it did.

**It says EURC rather than ETH, and that is not a downgrade to hide.** Native
ETH has no EIP-3009 and WETH9 has no permit at all, so an agent holding either
cannot sign an `exact` authorization — the scheme takes a Circle-style token or
nothing. Writing "holds ETH" described a payment no code could make. EURC into a
USDC merchant is the same claim and a real one: two assets, one signature, and
the payer never touches the merchant's.

Each sponsor is load-bearing in a way a judge can verify by deletion:

| Remove          | What visibly breaks                                                                                              |
| --------------- | ---------------------------------------------------------------------------------------------------------------- |
| The Graph       | The rail choice becomes "first in the array", and the trace admits it                                            |
| Uniswap         | An agent holding only EURC cannot pay a USDC price at all                                                        |
| Arc             | The settlement has nowhere USDC-native to land, and the payer pays gas in a second asset the merchant never sees |
| The rail (#207) | There is no `402`, and the agent needs an account                                                                |

**The refusal comes from a guard Mayarin owns, not from Circle.** Both earlier
plans are dead: Privy lost its slot, and `circle wallet limit set` requires a
mainnet chain while Circle lists Arc on testnet only — so no arrangement of the
demo shows a Circle-enforced refusal, and a `--max-amount` flag in our own script
proves nothing about anybody's policy.

What refuses instead is the **quote deviation guard**. The Arc EURC/USDC pool
prices 1 USD at about 2.05 EURC — roughly 2.2× real FX — which is why
`QUOTE_DEVIATION_BPS=9900` is set that loose on testnet in the first place.
Tighten it for the take and the same payment is refused before the payer signs,
with the pool price and the oracle price both on screen. That is a refusal this
repository actually enforces, on the exact number the demo has already shown, and
it protects the payer rather than the operator. Restore the loose value
afterwards or every later run fails.

The **no-signup moment** (`curl` from a clean machine, no key, `402`, pay,
resource — under 30 seconds) is the other required beat, and it opens the video
rather than closing it.

### What actually scores

Judging is five categories: Technicality, Originality, Practicality, Usability
(UI/UX/DX) and WOW Factor. Honest reading of where this project sits:

| Category     | Where we are | Why                                                                                                      |
| ------------ | ------------ | -------------------------------------------------------------------------------------------------------- |
| Technicality | strong       | Nine-state idempotent engine, double-entry ledger, capability probed off the chain, exact-output swaps   |
| Practicality | strong       | A live public endpoint, clickable transactions on two chains, a ledger that balances                     |
| Originality  | **weakest**  | "An agent pays for an API with x402" is a crowded genre in 2026. The depth is original; the pitch is not |
| Usability/DX | middling     | The `curl` is excellent DX; four minutes of terminal is not. No UI currently appears in the demo         |
| WOW          | **unearned** | Payments do not move on camera, and none of the depth above renders by itself                            |

Two of those are fixed by ordering, not by code.

**The change is the strongest beat in the repository and it is currently buried
in #211.** The swap spent 28208 of the 28351 EURC the payer signed for, and the
143 EURC the pool did not need went somewhere a ledger row names. On the Arc run
the change was 0.010236 EURC and is a liability owed back to the address that
signed; on Base it was 0.000143 and is under the one-cent dust threshold, so it
is taken as revenue and the receipt event says which. Neither is absorbed, and
that is the beat: one ledger row proving the money was accounted for either way.
Almost no entry handles surplus at all. Show it — and show the Arc figure, which
is the one that is owed back.

**Originality is a framing problem, and it is free to fix.** Not "an agent pays
for an API". Instead: an agent paid in a currency the merchant has never heard
of, signed once, never touched the merchant's asset, never saw an address, and
got change. Same code, a different first sentence.

**The announced fallback is worth filming.** Before Arc's fifth settlement it was
not ranked and the system said so. A system that refuses to pretend it knows
enough reads as mature engineering, and it takes eight seconds.

### The four minutes

Only work done inside the event window is judged, so the clearing layer itself is
not being scored — the rail is. Structure follows from that:

| Time      | Beat                                                                                   |
| --------- | -------------------------------------------------------------------------------------- |
| 0:00–0:20 | `curl` from a clean machine. `402`. Pay. Data. No key, no account. No explanation yet  |
| 0:20–1:30 | The agent asks The Graph which rail has headroom, sees real numbers, picks, says why   |
| 1:30–2:30 | Pays EURC into a USDC price. One signature. **The change is owed back** — show the row |
| 2:30–3:10 | The refusal. The deviation guard says no to a pool 2.2× off the oracle                 |
| 3:10–4:00 | Verify by deletion. Pull The Graph out; the trace admits the rail is now arbitrary     |

Not in the video, at any length: ports and adapters, the package tree, the test
count, the nine states. All of it is Q&A material, none of it is demo material.

ETHGlobal's own constraints on the file: **two to four minutes, minimum 720p, and
no AI voice synthesis** — narrate it yourself. Also ruled out: rushed pacing,
background noise, speed-ups to fit the limit, music with text overlays instead of
narration, and phone recording.

For the Q&A question "what challenges did you solve", answer with the two that
are specific and true rather than the generic ones: Arc emits **two** `Transfer`
logs for one payment because its own currency is USDC seen through two
interfaces, so every Arc settlement was ambiguous by construction; and a payment
stranded itself because the order was broadcast, confirm, persist, so a
confirmation that threw destroyed the only pointer to money that had already
moved — it is now broadcast, persist, confirm. Those two prove the thing was run
rather than demonstrated.

---

## Shipped

The original spine landed in twelve PRs. RFC #207 is now closed: the paid
response and accounting fixes were verified by a real Base Sepolia payment, the
Arc confirmation fix by a real Arc one, and all three are deployed and paid for
on the public endpoint. Documentation is deferred until the end.

| PR                                                      | What landed                                                                      |
| ------------------------------------------------------- | -------------------------------------------------------------------------------- |
| [#215](https://github.com/playriglabs/mayarin/pull/215) | Chain facts for `arc-testnet`, `hedera`, `hedera-testnet` (Hedera since removed) |
| [#216](https://github.com/playriglabs/mayarin/pull/216) | Protocol types, HTTP transport, the `exact`/EVM scheme                           |
| [#220](https://github.com/playriglabs/mayarin/pull/220) | Facilitator port, settlement confirmation, the replay key                        |
| [#221](https://github.com/playriglabs/mayarin/pull/221) | Resource registry and the price lock that bounds the payer's window              |
| [#222](https://github.com/playriglabs/mayarin/pull/222) | The `x402` execution path in the clearing engine                                 |
| [#223](https://github.com/playriglabs/mayarin/pull/223) | Local facilitator — Mayarin broadcasts the payer's authorization                 |
| [#224](https://github.com/playriglabs/mayarin/pull/224) | Token capability probe, with a control call                                      |
| [#225](https://github.com/playriglabs/mayarin/pull/225) | Postgres adapter for the resource registry (migration 0026)                      |
| [#226](https://github.com/playriglabs/mayarin/pull/226) | HTTP surface: `requirePayment`, discovery, facilitator endpoints                 |
| [#227](https://github.com/playriglabs/mayarin/pull/227) | Migration-journal guard, three tests rotted since #61, two high CVEs             |
| [#228](https://github.com/playriglabs/mayarin/pull/228) | Astro 5 → 7 and the Node 22 floor it brings                                      |
| [#229](https://github.com/playriglabs/mayarin/pull/229) | `.nvmrc` names the major, so `nvm use` resolves                                  |

### In the window — 4 to 8 September

Everything below was written during the event, which is the distinction each
submission README has to draw. Grouped by what it serves rather than by date; the
per-slot sections further down carry the detail and the evidence.

| Slot               | PRs                                                        | What landed                                                                                                                                                                                                  |
| ------------------ | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Arc** (#208)     | #236, #243, #246, #248, #251, #252, #270                   | Arc testnet deploy, per-chain merchant Safes, one facilitator per chain, deposits derived on their own chain, Circle agent wallet paying through EIP-1271                                                    |
| **Graph** (#231)   | #237, #238, #241, #271, #278                               | Both subgraphs live, `chooseRail` on median headroom, the indexer reading the subgraph clamped to `indexedHead`, its query budget, and the MCP selling rail intelligence per call — paid for on Base Sepolia |
| **Uniswap** (#211) | #258, #262, #263, #264, #265, #266, #267, #268, #275, #276 | Exact-output quoting, cross-asset x402 end to end on two chains, the payer's change and what becomes of it, the interrupted-payment resume, `FEEDBACK.md`                                                    |
| Rail correctness   | #255, #257, #261                                           | Paid quotes delivered, direct settlements reconciled, a broadcast persisted before it is trusted, the estimate priced on the payer's rail                                                                    |
| Product            | #239, #274                                                 | A running deployment can have a resource at all; then merchants register their own, on the API and in the dashboard                                                                                          |
| Tooling, deploy    | #240, #242, #245, #249, #250                               | e2e takes a chain, asks the chain what gas costs, and the Railway sync has a dry run                                                                                                                         |
| The entry itself   | #230, #233, #234, #247, #253, #256, #272                   | This file, the three-slot decision, the corrected deadline, and Hedera removed                                                                                                                               |

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

### #207 validation — 5 September

The first public-endpoint test settled 0.02 USDC but returned HTTP 400 because
the FX handler requested a zero-amount quote. Its ledger also recorded a
0.0001 USDC fee that was never transferred, reducing the recorded net to 0.0199
USDC while the merchant received the full 0.02 USDC.

Both fixes passed a retest through the fixed local API with an isolated Postgres
database and a real Base Sepolia payment:

- [Confirmed transaction](https://sepolia.basescan.org/tx/0x0554b17da3579d152e904e9e67627101778f6d00db394f100a79b40bcb2efdcb),
  block `46404643`: HTTP 200, the USD/USDC FX quote, and a successful
  `PAYMENT-RESPONSE`.
- Intent `pi_01M1QRFSW9J6279DFR89KC6KM1` reached `COMPLETED`; clearing
  `clr_01M1QRFSWR2VDW8WMSKYE8QN62` reached `SUCCESS`.
- The merchant received 0.02 USDC. Postgres recorded 0.02 USDC net, zero fee,
  and the confirmed transaction hash. All three postings balanced, treasury
  cleared to zero, and no fee-revenue or merchant-holding entries were created.

The FX quote is prepared with a positive source amount before charging. The
x402 clearing path requires confirmed chain evidence and records the direct
merchant transfer without sending a second payout. Its fee is zero because
this transfer has no fee leg; operator gas remains a separate cost.

`scripts/e2e-x402.ts` is the repeatable test runner, on any chain `CHAIN_IDS`
names: `--chain` picks the rail the resource must offer, `--check` stops before
anything is signed. It requires an explicit verified `--pay-to` address, caps
payment at 0.02 test USDC, and checks the HTTP response, chain receipt, and
persisted ledger together.

### The same run on Arc — 5 September

Arc has its own way of failing, and the first Arc run found it. The payment
broadcast fine and then the confirmation refused it: `x402 settlement … carries
2 transfers; cannot tell which paid`. Both transfers were the same 0.02 USDC,
from the same payer to the same merchant — Arc's own currency is USDC, so one
movement writes a `Transfer` on the native view (`0xffff…fffe`, 18 decimals) and
another on the ERC-20 view (`0x3600…`, 6). `EvmX402Reader.confirm` read every
`Transfer` in the receipt, so every Arc settlement was ambiguous by
construction; on Base Sepolia, where gas is ETH, there is only ever one.

`SettlementConfirmer.confirm` now takes the asset it is confirming and considers
only that contract's transfers. The ambiguity guard is unchanged and still means
what it says — two transfers _of the settled token_.

The retest, through the fixed local API against an isolated Postgres database:

- [Confirmed transaction](https://testnet.arcscan.app/tx/0x2976f2fcd63900a37c01084088b3059b9c2fb2bb97fe58daff201e89c74ead81),
  block `60519207`: HTTP 200, the USD/USDC FX quote, a successful
  `PAYMENT-RESPONSE`, and the authorization nonce consumed on-chain.
- Intent `pi_01M1QVHT2XA251W6NDZN3K2XV4` reached `COMPLETED` on `arc-testnet`
  via the `x402` execution path; clearing `clr_01M1QVHT3GZH8MJS1VYNXFRS5V`
  reached `SUCCESS` with zero fee and the transaction hash recorded.
- All three postings balanced at 20000 USDC each. Both views of the Arc balance
  agree with each other and with the payment: the payer lost the 0.02 USDC plus
  0.002178825 USDC of gas it paid by broadcasting its own authorization, and the
  merchant gained exactly 0.02 USDC.

### The public deployment, on Arc — 5 September

`core-api`, `dashboard-api` and `chain-worker` deployed from `5a1cb30`, and the
same runner was pointed at the public endpoint with its ledger read through
Railway's Postgres proxy. Nothing local was involved.

- `https://api-testnet.mayarin.xyz/x402/fx/quote` answered `402`, then `200`
  against a signed authorization and no API key.
- [`0xf51d9d71…`](https://testnet.arcscan.app/tx/0xf51d9d7171ba01b21df42ca541edc3c29e2e392de9492a482402a0ca29cc10b9),
  block `60521893`: 20000 USDC delivered, receipt `success`.
- Intent `pi_01M1QWW6PZ432ME8FF2J15HD7R` `COMPLETED` on `arc-testnet` via the
  `x402` path; clearing `clr_01M1QWW6QWDANQRS85XJRG6AAP` `SUCCESS`, zero fee,
  net 20000.
- `ASSET_RECEIVED`, `CLEARING` and `SETTLED` each balanced at 20000 USDC. The
  merchant went from 0.06 to 0.08 USDC; the payer paid the 0.02 plus
  0.002178325 USDC of gas for broadcasting its own authorization.

**#207 criterion 6 is now satisfied on a live public rail**, which is the form
it was always asking for. Criterion 9 — the docs page and the OpenAPI paths —
is still the only one open.

**One payment was stranded on the way there. The hole is now closed.** The
run that hit the ambiguity moved 0.02 USDC on-chain
([`0x215371ed…`](https://testnet.arcscan.app/tx/0x215371edfa343c30083a32107f5cb147d238f43eb4d87a5434e4d3076827abcc))
and left intent `pi_01M1QV9EHN2PH8KQ3QVAGW0E4H` at `PROCESSING` with its
clearing at `PAYMENT_PENDING`. `X402Service.settle` broadcast, then confirmed,
and recorded the hash only after confirmation succeeded — so a confirmation that
threw lost the only pointer to money that had already moved. `resumeStuck` could
not recover it, because nothing was persisted to resume from, and a retry could
not re-broadcast: EIP-3009 had recorded the nonce.

The order is now broadcast, persist, confirm. `ClearingEngine.recordFacilitatorBroadcast`
writes the hash and a `settlement.broadcast` event without moving the
transaction — the one write in the engine that records something and changes no
state, because nothing has been confirmed and a payment that has not been
confirmed has not been received. Three consequences follow:

- **The expiry sweep leaves it alone.** A `PAYMENT_PENDING` transaction holding
  a reference has already had a settlement go out; failing it would bury the
  money it moved. Expiry describes a payer who never paid.
- **`X402Service.recoverBroadcasts` finishes it**, at boot and on the same
  60-second beat as the sweep. The clearing engine cannot do this itself —
  confirming means reading a chain — so the service holding the confirmers
  rebuilds the requirements from what the payer signed — recorded on the
  `settlement.broadcast` event, never re-priced — and confirms the hash it
  already has. A cross-asset payment has two movements, so it also reads whether
  the swap has gone out and either confirms it or sends it. A pass that cannot
  confirm yet leaves the payment where it is and repeats next time.
- **A merchant is not told about it.** `settlement.broadcast` records no state
  change, so `toWebhookEventType` returns nothing for it and the outbox filters
  it in SQL — where `limit` counts only rows a merchant is told about, so a page
  can never come back empty with later events waiting behind it.

Nothing on the testnet deployment was in this state when the fix landed: the
stranded payment was local, and its database is gone.

**RFC #207 is closed; documentation and OpenAPI updates are deferred until the
end.** The successful run used local code, not the public deployment. Deploy
these fixes before relying on the public paid-response flow; the historical
failed payment's ledger has not been rewritten.

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

| Fact                            | Value                                                                                                                                                                                   |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Arc testnet / mainnet chain id  | `5042002` / `5042`                                                                                                                                                                      |
| Arc USDC                        | `0x3600000000000000000000000000000000000000` — `FiatTokenV2` behind Circle's `FiatTokenProxy` (the zeppelinos slot, not EIP-1967), **not** a precompile · validates EIP-1271 signatures |
| Arc USDC capability             | `eip3009` ✓ · `eip2612` ✓ · domain `{USDC, 2}`                                                                                                                                          |
| Arc EURC                        | `0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a` — `eip3009` ✓ · domain `{EURC, 2}`                                                                                                         |
| Arc Permit2                     | deployed · `x402ExactPermit2Proxy` **not** deployed                                                                                                                                     |
| Arc decimals                    | native view 18, ERC-20 view 6 — **one balance**, factor 10^12                                                                                                                           |
| Arc `Transfer` logs             | one payment emits **two** — the native view `0xffff…fffe` and the ERC-20 view — same money, two contracts                                                                               |
| The Graph: `base-sepolia`       | Subgraph Studio ✓ · Firehose ✓ · Substreams ✓                                                                                                                                           |
| The Graph: `arc-testnet`, `arc` | Subgraph Studio ✓                                                                                                                                                                       |

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

**Polling keeps up on Arc. An earlier note here said it could not, and that was
wrong** — it read `CHAIN_LOG_RANGE=10` as the watcher's range per tick. It is the
provider's cap per `eth_getLogs` call, and `EvmChainClient` splits a tick across
as many calls as it needs; the docstring on `logRange` records the day that
distinction was learned. A 200-block tick is 20 calls, and a lagging pair
reschedules after `WATCHER_CATCH_UP_INTERVAL_MS=1000` instead of the usual
minute, so the watcher advances ~200 blocks a second against a chain producing
two.

What is true is the cost: 20 RPC calls per tick per pair on a free tier, against
one GraphQL query for the same range. `SettlementSource` reading the subgraph is
an RPC-budget argument and a resilience one — not an impossibility claim.

**The Arc decimal split is the one fact that corrupts accounting rather than
display.** Two `AssetCode`s for one Arc balance counts the same money twice, and
every reconciliation afterwards is wrong _while still balancing_.

The Graph's registry uses the same CAIP-2 ids `caip2Of` already emits, so network
identity needs no translation. It also corroborates Arc mainnet as `5042` from a
second independent source — the id #215 left out of `CHAIN_IDS` for being
unverifiable against a live endpoint.

---

## Next

**Five days, not nine.** Submissions close 13 September, 12:00 EDT, and it is the
8th. Everything below — code, videos, diagrams, per-submission READMEs — lands
before then.

### Before writing code

- [ ] **Confirm Continuity registration with The Graph, Arc and Uniswap, in the
      form each requires.** Arc states it outright. Answers take hours; send
      first. A submission filed against the wrong pool is a disqualification
      discovered at judging. The Graph's open question is no longer _whether_
      its Composable track admits Continuity — it carries no pool badge, so it
      does — but confirming which pool we are registered in.

### #208 — Arc — **closed 6 September**

The rail is built, deployed, and paid on by a Circle agent wallet. The two boxes
left open below are named rather than ticked because they are real work that did
not make the slot, not because the issue is unfinished.

- [x] Deploy `PaymentRouter`, `TimelockController`, `DepositForwarderFactory` to
      Arc testnet; verified on ArcScan. See **Deployed on Arc** below.
- [x] Configure `CHAIN_RPC_URLS`, `CHAIN_ASSETS`, `CHAIN_CONFIRMATIONS`,
      `PAYMENT_ROUTERS`, `CHAIN_START_BLOCKS` and `DEPOSIT_FORWARDERS` for
      `arc-testnet`. **`CHAIN_NATIVE_ASSETS` is deliberately left without an Arc
      entry**: Arc's native currency is USDC, 18 decimals in the native view and
      6 in the ERC-20 view over one balance, so declaring it native would give
      one balance two `AssetCode`s and count the same money twice.
- [x] `X402_ENABLED=true` on the testnet deployment, with the operator key
      reaching core-api. The key had been excluded from that service on purpose —
      one signer for the chain-worker — and x402 broadcasts the payer's
      authorization from the API process, so excluding it produced a deployment
      where `/x402/*` answered 404 and looked healthy.
- [x] **Call `EvmAssetCapabilityProbe` from the composition root at boot.** Done:
      `AssetCapabilities` (core port + cache) is built in `createX402`, warmed by
      `apps/api/src/index.ts` before traffic, and `X402Service.paymentRequired`
      now takes the token's domain and transfer method from the chain rather
      than from the resource row.
- [x] Audit the native-decimal assumption — done, and the record is
      [`docs/arc.md`](docs/arc.md): one USDC `AssetCode` with the 18-decimal
      native view and the 6-decimal ERC-20 view kept as one holding, Arc
      **rejected** from `CHAIN_NATIVE_ASSETS` before RPC, balances read through
      `balanceOf` with a regression test round-tripping `1.234567 USDC`, and
      the native mirror log kept out of x402 confirmation (#255). Arc balances
      have been trusted on that basis since the 6 September paid runs.
- [x] Merchant wallets can be provisioned on Arc: `SAFE_ARC_TESTNET` (factory,
      singleton and fallback handler all read off Arc, not inherited from Base)
      and one `TurnkeyWalletProvider` per chain in `WALLET_PROVISION_CHAINS`,
      routed by the chain a request names. **A merchant's Arc Safe is a different
      address from their Base one** — the salt is
      `mayarin:wallet:<merchant>:<chain>` — so provisioning has to run per chain
      rather than reusing an address that exists elsewhere.
- [x] One link, many rails: the payer picks chain and asset at checkout, filtered
      per chain ([#244](https://github.com/playriglabs/mayarin/issues/244), closed
      with #258 and #261). Base
      offers ETH and USDC where Arc offers only USDC, and a rail is offered only
      when the merchant can actually be paid on it. Today the chain is whichever
      key comes first in `CHAIN_ASSETS` and the asset list is a union across
      chains — invisible with one chain, wrong with two.
- [x] Surface per-chain balances in the dashboard — shipped with the #244 work:
      `GET /wallets/balance` returns **one entry per chain the deployment
      settles on**, including the chains where this merchant has no address yet,
      because a row that is absent and a row that is empty read the same to a
      merchant and only one of them says there is something to do.
- [x] Circle Agent Stack as the payer. **Done and paid for; the Circle-policy
      half is abandoned rather than pending** — see the note under it: a Circle agent wallet paid the gated endpoint on Arc testnet,
      6 September —
      [`0xe1d37298…`](https://testnet.arcscan.app/tx/0xe1d3729806ea2621f723388550ea88d0b0a07beb518b287f3fdc82fed287fa08),
      intent `pi_01M1V97XNGWB8BPJB5GHPEY3EW` `COMPLETED`, clearing
      `clr_01M1V97XPVFXW0FNQRBAJP3TXF` `SUCCESS`, three balanced postings of
      20000 USDC each, and the payer's gas is **zero**: the operator broadcasts
      what the wallet signed. Evidence in
      [`docs/evidence/arc-x402-circle-208.json`](docs/evidence/arc-x402-circle-208.json).
      An agent wallet is a **contract account**, not a key — its address is
      counterfactual until a first transaction deploys it, and what the CLI
      signs with recovers to the wallet's signer rather than to the wallet. Arc
      USDC takes that signature through EIP-1271, so `EvmX402Reader` asks the
      chain to verify instead of recovering locally; until that fix every agent
      payment was rejected as forged. **The policy half stays blocked**:
      `circle wallet limit set` takes a mainnet chain, and Circle lists Arc on
      testnet only, so no arrangement of Arc shows a Circle-enforced refusal.
      **The refusal beat therefore comes from a refusal Mayarin owns** — the
      quote deviation guard, or a rail the merchant cannot be paid on — not from
      a `--max-amount` flag, which proves nothing about a policy. That is a
      decision, not an open item.
      The same agent wallet also paid on Base Sepolia
      ([`0x9fcad5d8…`](https://sepolia.basescan.org/tx/0x9fcad5d8dc0a5bef55cbbe1e06d147bab81bcd4c120b6292ef15923d70366630),
      [evidence](docs/evidence/base-sepolia-x402-circle-208.json)) — same
      address, same CLI, one extra step: Base charges gas in ETH, so the wallet
      had to hold a second asset the merchant never sees, and the transfer
      failed with "insufficient" until it did. On Arc that step does not exist.
      That is the Arc thesis stated by two runs rather than by a claim.
- [ ] Architecture diagram, video, documentation, repo. Tracked under #232 and
      **Submission** below, not here.

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
- [x] **x402 settlements are not indexed — decided 8 September, with the Arc
      deployment live.** They never touch `PaymentRouter`, so `PaymentCompleted`
      carries none of them, and the token's `AuthorizationUsed` carries no
      `validBefore` — there is no headroom to read off it, and headroom is the
      one number the rail choice reasons over. Indexing them would add sample
      counts that measure nothing the selector ranks on. The rail statistics
      stand on contract-path and deposit-path settlements only, and the agent
      sees that basis rather than assuming it: both MCP tools state their sample
      counts, and `chooseRail` already requires `minSamples` before a rail is
      ranked at all, so a rail whose traffic is all x402 is announced as
      unobserved rather than silently ranked.
- [x] Same subgraph for `arc-testnet`, deployed and indexing.
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
- [x] **The Subgraph MCP, served behind x402.** Shipped: `POST /x402/mcp`, MCP
      over JSON-RPC, with `initialize` and `tools/list` free and `tools/call`
      gated by `requirePayment` on the `rail-intelligence` resource. Two tools —
      `rail_stats` (samples, median headroom, and the worst settlement the median
      hides) and `choose_rail` (the ranked choice with its reason) — both reading
      the **cached** observer the `402` reads, so a pay-per-query tool cannot
      spend the 3,000-a-day account-wide Studio budget. Three refusals never
      charge: arguments the tool rejects, a tool nobody serves, and — the
      deletion test in its useful form — **no settlements observed at all**,
      because charging for "no rail has been observed" is charging an agent for
      our own outage. The resource still has to be registered through
      `POST /admin/x402/resources` on a deployment; that is runtime config, not
      code. Original wording follows.
- [x] **Paid for, on a chain, by an agent wallet — 7 September.** A Circle Agent
      Stack wallet bought one `choose_rail` call on Base Sepolia:
      [`0xdce241e2…`](https://sepolia.basescan.org/tx/0xdce241e203e3de3fd1fcd2e2e421d5a7d97a5ff8174a3df2314a4bf73baf6c8b),
      100000 USDC, intent `pi_01M1WYBY4FM766VPSAWY128JHA` `COMPLETED`, clearing
      `clr_01M1WYBY5R4V0Z4B3FJVTR1V1K` `SUCCESS`, fee zero, postings balanced.
      The answer came back off live Studio data: **`arc-testnet`, median headroom
      936.5s over 12 settlements**. Evidence:
      `docs/evidence/base-sepolia-mcp-231.json`.

  The sentence worth saying on camera is what that payment was _for_: the agent paid ten cents to find out which rail to pay on. Nobody in the entry pool is selling a decision. And the payer's gas was zero — the operator broadcasts what the wallet signed, and the wallet is a contract account whose signature the token accepts through EIP-1271.

- [x] **The submission README requirement — 8 September.** The root README now
      carries the two lists the Continuity pool requires: pre-existing work
      against work done in the window, with the x402 spine (#220–#230, merged
      3 September) listed as pre-existing rather than claimed for the event, and
      a per-partner table whose every claim is a transaction hash or an evidence
      file. `docs/chain.md` carries the Studio query URLs beside the contract
      addresses they index, per this RFC's own spec. The video and the
      per-submission READMEs remain, under **Submission** below.
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
- [x] Seed both testnets with real settlements. Arc has **5**, which is what
      `minSamples` needs before a rail is ranked at all — see **Subgraphs live**
      below. `bun run e2e -- --chain arc-testnet` is the tool, and a deposit
      payment is the only thing that fills an empty rail: x402 never touches
      `PaymentRouter`, so no amount of agent traffic emits a `PaymentCompleted`.

#### Subgraphs live

| Network        | Query URL                                                                   | State          |
| -------------- | --------------------------------------------------------------------------- | -------------- |
| `base-sepolia` | `https://api.studio.thegraph.com/query/1758657/mayarin-base-sepolia/v0.0.2` | 78 settlements |
| `arc-testnet`  | `https://api.studio.thegraph.com/query/1758657/mayarin-arc-testnet/v0.0.2`  | 5 settlements  |

Base's headroom: median 828s, min 28s, max 1797s, none negative. **Three
settlements landed under a minute**, one of them at 28s. That tail is what a mean
would have hidden, and it is the reason `chooseRail` ranks on the median.

Arc is no longer empty. Its five came through the deposit path, which is the only
thing that emits a `PaymentCompleted` on a rail nothing has paid yet — x402 never
touches `PaymentRouter`, so no amount of agent traffic fills that gap.

**Two things to watch when the MCP goes behind x402.** Subgraph Studio allows
**3,000 queries a day, account-wide**, so a pay-per-query MCP exposed bare can be
drained by judges during assessment — give it a per-process budget and a cache.
And x402 never touches `PaymentRouter`, so **no amount of MCP traffic adds
settlements to the subgraph**: Arc stays at five samples unless the deposit path
runs.

```
base-sepolia   78 samples · median 828s
arc-testnet     5 samples · median 942s

→ arc-testnet: median headroom 942s over 5 settlements
```

Arc wins on headroom rather than on novelty, and it entered the ranking only at
the fifth settlement. Before that the announced fallback fired, which is worth
rehearsing on camera too.

### #209 — Hedera — **not entered, issue closed, code removed**

Hedera did not get one of the three slots; see **Why Hedera and Privy lost their
slots** above. [#209](https://github.com/playriglabs/mayarin/issues/209) is closed
as not planned, and the chain itself has been taken back out of the code — the
`hedera` and `hedera-testnet` entries added to `CHAIN_IDS` by
[#215](https://github.com/playriglabs/mayarin/pull/215), their viem definitions,
their HashScan explorer URLs, and the landing page's Hedera lockup. Supporting a
chain nobody settles on is a claim the code was making on its own.

**The one finding worth keeping.** Circle's USDC on Hedera testnet is HTS token
`0.0.429274` (`0x…068cda`): 147 bytes of facade, no `version()`, therefore no
EIP-712 domain and no EIP-3009. Permit2 _is_ deployed at its canonical address
(9152 bytes), so the permit2 path is the only one available — and it is not a
small job, because the facilitator and reader in `packages/providers/x402-local`
are EIP-3009 only and `x402ExactPermit2Proxy` is not deployed there. That is what
made Hedera the worst trade in the batch, and it is why re-entering later means
choosing between building that scheme and letting a third-party facilitator carry
the chain.

### The 402, in public

This landed on **Arc**, not Hedera, and stands on its own now that #209 is out:
`GET /x402/fx/quote`, gated and publicly reachable.

A `curl` from a clean machine, with no account and no key:

```
HTTP/2 402
content-length: 0
payment-required: eyJ4NDAyVmVyc2lvbiI6Mi…
```

```json
{
  "scheme": "exact",
  "network": "eip155:5042002",
  "amount": "20000",
  "asset": "0x3600000000000000000000000000000000000000",
  "payTo": "0xe5dd11a0579c0ab6a60b8263277c174cc8eb675e",
  "maxTimeoutSeconds": 60,
  "extra": { "name": "USDC", "version": "2", "assetTransferMethod": "eip3009" }
}
```

Four of those values are derived rather than configured, which is the whole
point. `assetTransferMethod` and the EIP-712 domain came off the Arc contract
when the resource was registered — Arc's own documentation describes its USDC as
`approve`/`transferFrom` and never mentions EIP-3009. The amount came through the
same quote engine a payment uses. And `maxTimeoutSeconds` is the quote TTL rather
than a second number free to drift from it, which is the arrangement that once
produced `EXECUTION_EXHAUSTED`.

The empty body is the specification's: a client that cannot read the header has
not implemented x402 and would not understand a JSON body either.

**Getting there needed three things nobody had listed.** The database migration
`0026_x402_resources` had never run on testnet — `deploy:testnet` migrates only
with `--migrate` — so the route answered 500 while the rail itself was healthy.
`market_config.stablecoins` is seeded once and never overwritten (#95), so adding
Arc to `CHAIN_ASSETS` changed nothing until the admin API was told; the deployed
registry and the environment are two different sources of truth and both must
agree. And the operator key had to reach core-api, which the env sync had been
excluding on purpose.

**The gap that blocked every one of these.** `X402ResourceRepository.save` had no
caller — no route, no script, no seed — so a running deployment could not be
given a resource at all, and nothing could serve a `402`. `POST
/admin/x402/resources` is that seam. The body names tokens and never their
EIP-712 domain or transfer method: both are probed off the contract, so a
resource cannot be created advertising terms no payer could sign.

- [x] ~~Measure `eth_getLogs` through HashIO before running `SettlementIndexer`
      against it.~~ Not entered: Hedera lost its slot on 6 September and its
      chain entries are out of the code — there is no Hedera `SettlementIndexer`
      to measure for.
- [x] ~~Contracts verified on HashScan; video ≤5 min showing a paid request
      execute.~~ Not entered, same reason — no Hedera contracts exist to verify,
      and the video is the three-slot one under **Submission**.

### Next, in order

**All three slots are built.** Arc (#208) and Uniswap (#211) each have a real
payment on a real chain with evidence committed; The Graph (#231) has both of
its products — the subgraph serving the rail choice, and the MCP paid per call
on Base Sepolia. Five days remain, and what is left is mostly not code:

1. **Continuity registration with The Graph, Arc and Uniswap.** Not code, and
   still first, because answers take hours and a wrong pool is a
   disqualification discovered at judging.
2. **Turn the deployment on**
   ([#231](https://github.com/playriglabs/mayarin/issues/231)). The MCP and the
   subgraph-fed indexer exist but the public deployment has neither configured:
   `SUBGRAPH_ENDPOINTS` has to reach the Railway env (the sync script already
   carries it), the `rail-intelligence` resource has to be registered through
   `POST /admin/x402/resources`, and then the indexer is confirmed running
   against the subgraph source there — the last open box on that RFC.
3. **`scripts/demo-agent.ts`** ([#232](https://github.com/playriglabs/mayarin/issues/232)) —
   the trace, the refusal run, and the no-signup `curl`. The refusal comes from
   the deviation guard or an unpayable rail, not from Circle: `circle wallet
limit set` needs a mainnet chain and Circle lists Arc on testnet only. The
   deletion run — subgraph removed, agent falls back and says so — is #231's
   last load-bearing box and it is filmed here.
4. **Record and cut the video.** Two to four minutes, 720p or better, narrated
   by a person — an AI voice is disqualifying. Film the **Arc cross-asset run**
   under #211: one payment carrying three sponsors, with change that is actually
   owed back. Plus the Arc architecture diagram and a README per submission
   separating pre-existing work from work done in the window — the root README
   carries the two lists as of 8 September; the per-submission ones remain.
5. **Submit the Uniswap Developer Feedback Form.** Five minutes. `FEEDBACK.md`
   is written and the form is a separate deliverable the track names.
6. **Send the payer's refund** ([#211](https://github.com/playriglabs/mayarin/issues/211)),
   if the window allows. It is the last code item on that RFC and the only one
   with real risk left in it — a fourth thing signing with the operator's key,
   with its own nonce, resume and idempotency story. Cuttable: the change is
   already accounted for and owed, which is what the track was shown.
7. **Documentation and OpenAPI updates, if time survives.** Add the x402 page and
   expose its unversioned routes in the generated spec, then run
   `bun run docs:openapi:check`. Deferred work, not a reason to reopen
   [#207](https://github.com/playriglabs/mayarin/issues/207).

**Cut order if the window tightens:** the refund first, then Arc's mainnet push.
The demo agent and the video are never cut — without them all three slots go in
empty.

**Outside the three slots, and not to be pulled into them.**
[#269](https://github.com/playriglabs/mayarin/issues/269) (merchants gating their
own APIs) shipped its first half in #274 — merchant-owned endpoints on
`/v1/x402/resources`, a dashboard page, and `docs/guides/x402` — and is open for
the SDK half. [#273](https://github.com/playriglabs/mayarin/issues/273) (agent
discovery, and paying invoices, links and carts) is a Phase 4 RFC with no
ethonline label. Neither scores a partner prize; both are post-event.

Also still open and not code: moving the dashboard's custom domain, now that it
deploys as a Worker rather than to Pages.

### #211 — Uniswap

- [x] **Exact-output reached `SwapVenue` as a second method, not a
      `SwapRequest`** (#258). `quoteExactOutput` sits beside `quote`, every
      venue implements or refuses it, and `QuoteEngine.#swapLeg` prices at the
      settlement amount rather than a one-unit probe. LiFi refuses exact-output;
      **0x turned out to be able to serve it**, so it does.
- [x] The `402` prices a cross-asset rail backwards, and `register` refuses one
      whose `payTo` is not the operator — the payer's asset has to land
      somewhere swappable, and paying the merchant directly would settle a USDC
      invoice in EURC.
- [x] `CrossAssetSettler` and its EVM adapter: plan before the payer's money
      moves, send, persist the hash, then confirm. A swap has no nonce to stop a
      second one, so the hash is durable before anything is trusted.
- [x] Post payer surplus through a balanced ledger entry — never absorb it.
      `PAYER_SURPLUS`, a **liability**, because it is the payer's change rather
      than an FX result.
- [x] Split the change by whether returning it is worth doing. Above one cent of
      a stablecoin it stays a liability and the receipt event records the
      address it is owed to; at or below, returning it costs more than it is
      worth, so it is taken as `FEE_REVENUE` and the event says `dust`. A
      threshold is declared only for the assets an `exact` authorization can be
      signed in — an asset that has not declared one keeps every amount, because
      keeping somebody's money is a decision and silence is not one.
- [x] **A real EURC → USDC payment on Base Sepolia, end to end.** Block
      `46451061`: authorization `0x254b93ce…` moved 28351 EURC from the payer to
      the operator, swap `0xb1436735…` spent 28208 of it and delivered exactly
      20000 USDC to the merchant, and the 143 EURC the pool did not need was
      accounted for as the payer's change. That run predates the dust threshold
      and credited `PAYER_SURPLUS`; at 0.000143 EURC it is dust under the policy
      now in the code, and the same run today books it to `FEE_REVENUE` with the
      disposition on the receipt event. Intent `COMPLETED`, clearing `SUCCESS`, fee
      zero, treasury netting to zero. `bun run scripts/e2e-x402.ts --pay-with
EURC` is the repeatable form.
- [x] **The same payment on Arc, paid by a Circle agent wallet.** 6 September,
      authorization
      [`0xf08c141d…`](https://testnet.arcscan.app/tx/0xf08c141d2c11de1ac9abc3ca1b4da201bce901250148bd4436b86b421638beba)
      and swap
      [`0x9f4bf25b…`](https://testnet.arcscan.app/tx/0x9f4bf25b74fe3cb18087ff4e93eff22b530b48f2e7a41fbd064280f3abfc1e52):
      the agent signs 2.046810 EURC, the merchant is paid exactly 1.000000 USDC,
      and 0.010236 EURC is the payer's change — above the dust threshold, so it
      is the run where the change is genuinely owed back. Intent
      `pi_01M1VAPDVMSSNWGZXE1YFWS4A0` `COMPLETED`, clearing
      `clr_01M1VAPDW4PAAVG7XV71Q6P9WT` `SUCCESS`. Venue is the `uniswap-v2` fork
      on Arc (`osr21/arc-swap`), since the V3 adapter has no pool there.
      Evidence: `docs/evidence/arc-x402-circle-cross-asset-208.json`. **This is
      the run to film**: three sponsors in one payment, and the pool priced 1 USD
      at 2.05 EURC — roughly 2.2× real FX, which is the testnet pool rather than
      a pricing bug and the reason `QUOTE_DEVIATION_BPS=9900` is deliberately
      loose. Tighten it before anything points at mainnet.
- [x] `FEEDBACK.md` and the README pointing at the contracts and lines to read.
- [x] Resume a cross-asset payment interrupted between its two chain movements.
      `recoverBroadcasts` branches on the `settlement.swap` event: with it the
      swap has gone out and only needs confirming, without it the swap still has
      to be sent. The authorization is confirmed first in both branches — a
      resume has no facilitator response in front of it saying the payer's asset
      landed, and swapping for one that did not spends the operator's own
      balance. What the payer signed is read off the `settlement.broadcast`
      event, because on a cross-asset payment nothing else records it.
- [x] Send the refund. The threshold is set and the address is on the receipt
      event, so above dust the change is a liability with a payee — but no
      transaction returns it yet, and that is a broadcast with its own nonce,
      resume and idempotency story rather than a posting.
- [ ] Submit the Uniswap Developer Feedback Form. `FEEDBACK.md` is written; the
      form itself is not code and is still open.

### #210 — Privy — **not entered, issue closed**

Privy did not get one of the three slots, and
[#210](https://github.com/playriglabs/mayarin/issues/210) is closed as not
planned. The `AgentWallet` port below is still worth building on its own merits
and should be reopened as its own RFC after the event; the Privy adapter behind
it is not, because Turnkey already holds that role in this repository. The spending-policy beat in
[#232](https://github.com/playriglabs/mayarin/issues/232) is served by the Circle
Agent Stack under #208 instead.

- [ ] `packages/providers/privy` implementing `WalletProvider` — organization
      wallets, policies, key quorums, intents. **Deferred past the event.**
- [ ] The **`AgentWallet` port** — new, in core. `WalletProvider` structurally
      cannot express "sign this payload" and that refusal is deliberate; see
      `packages/core/wallet/src/provider.ts`. A closed intent union, and the
      adapter builds the typed data.
- [ ] The policy shown refusing an over-limit payment. **#232 no longer depends
      on this** — the Circle policy under #208 carries that beat.

Confirmed: Privy server wallets sign arbitrary EIP-712 via `eth_signTypedData_v4`.
Privy's prizes are published; _Ledger_ is the one still "coming soon". Neither
fact is load-bearing any more, but both cost time to establish.

### #232 — The demo agent

- [ ] `scripts/demo-agent.ts` emitting the trace above from real execution.
- [ ] The refusal run, stopping at the **deviation guard** — not at a Circle
      policy, which cannot be enforced on a testnet chain, and not at a
      `--max-amount` flag in our own script, which proves nothing. Tighten
      `QUOTE_DEVIATION_BPS` for the take, film the pool price against the oracle
      price, then restore the loose value or every later run fails.
- [ ] The no-key `curl` sequence, recorded separately, under 30 seconds.
- [ ] Six cuts from one run, each opening on the right decision.
- [ ] Verify by deletion: remove each sponsor's step once and confirm the trace
      visibly changes, before recording.
- [ ] Reset the `fx-quote` resource price to `0.02`. It is registered at 1 USD
      from the EURC test, so a same-asset run hits the runner's ceiling.

### Submission — due 13 September, 12:00 EDT

**This is not a separate phase with its own days.** An earlier version of this
file scheduled it for 14–16 September; that window is judging. Everything ships
by 13 September at 23:00 WIB, and the packaging has to be built alongside the
code rather than after it.

What each submission needs: one video of two to four minutes at 720p or better,
narrated by a person and not by a voice model; the Arc architecture diagram;
`FEEDBACK.md` plus the developer form for Uniswap; a public repository; and a
README per submission separating pre-existing work from work done in the window.
Version-control history is itself a requirement — a few large commits risk
disqualification, which the PR-per-change history here already satisfies.

This is what most often sinks an ETHGlobal entry — not the code. It now has less
time than the plan assumed.

### How judging actually pays

Two rounds. The first is asynchronous and screens roughly the bottom 80%; the
top advance to a live session of a four-minute demo and three minutes of Q&A.
Two consequences, both from ETHGlobal's own wording:

- **Round one has no effect on partner prizes**, and partners never see its
  results. The three slots are assessed independently and asynchronously.
- **At most async events the majority of prize money goes to projects that never
  advance to live judging.** So the stage is not the target. The three partner
  slots are.

---

## Known risks

**The Arbitrum Buildathon overlap is a conflict, not a scheduling detail.** Its
window is 14 September – 1 October and §7.1 requires headline work inside it, so
ETHOnline work done 4–13 September counts for ETHOnline and **not** for Arbitrum.
Separately, its staged payout makes the second and third tranches conditional on
building **exclusively on an Arbitrum chain** — which deploying to Arc
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

Three slots exist, and The Graph, Arc and Uniswap hold them. Everything below is
out — several of them for reasons that have nothing to do with their merit.

**Hedera** ($1,000 realistically) and **Privy** ($5,000 nominally) lost on the
slot cap and on cost per day; the reasoning is under **Why Hedera and Privy lost
their slots**. **Chainlink** ($500 on its Continuity track) and **Bazantic**
($1,000) were stretch before the cap and are moot after it.

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
