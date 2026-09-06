[← Documentation index](./README.md)

# Chain Layer

The first of Phase 2's five subsystems: per-intent deposit addresses, an EVM
wallet watcher, and the confirmation and reorg policy that decides when a
payer's asset counts as received.

The clearing engine gains no new state for this. `ASSET_RECEIPT_MODE=manual`
already exposes the `recordAssetReceived` seam; the watcher is the thing that
now calls it, replacing the Phase 1 stand-in where `auto` treated a payment as
funded the moment it reached `PAYMENT_PENDING`.

> **Execution paths.** This is the **deposit-matching** path. The **on-chain**
> path routes the customer's payment through `PaymentRouter.sol`, which
> atomically swaps and settles and emits a `PaymentCompleted` event an indexer
> consumes. The chain client and reorg policy below feed both paths. The path is
> selected per intent (`ExecutionPath` on `PaymentIntent`, defaulted from the
> `EXECUTION_PATH` config slot).
>
> **Neither is a fallback for the other — they serve different payers.** The
> contract path needs the payer to _connect_ a wallet: it submits calldata, a
> backend signature and a route, and the signed order's `refundTo` means the
> payer's address must be known before they pay. A payer who **scans a QR** or
> pastes an address — any wallet, and every custodial exchange withdrawal —
> can only do a plain transfer, so deposit-matching is the only path they can
> take. In a retail market that is most payers, not an edge case.
>
> Since #61 the contract path runs end to end up to `PAYMENT_PENDING`, where it
> waits for `recordPaymentCompleted`. Both halves of that are now in place: the
> indexer that calls it (#8) and the deployed contract (#29, addresses below).
> The **deposit** path's trigger is the treasury executor (#69), described
> below, and its accounting is in [`ledger.md`](./ledger.md) (#70).

---

## Per-intent deposit addresses

An exchange withdrawal leaves from an omnibus hot wallet and carries no memo or
calldata, so nothing in the transfer itself says which payment it belongs to.
Matching on amount alone collides the moment two customers owe the same figure.
Deriving a deposit address per payment intent is what makes the match
unambiguous — the address _is_ the assignment.

Addresses come from BIP-32/44 at `m/44'/60'/0'/0/<index>`, where `index` is a
monotonic counter allocated once per clearing transaction. The API holds only
the extended **public** key, so it derives addresses without ever being able to
spend from them: a bug in the watch path cannot move funds, because the process
has no key to move them with. Signing, sweeping and custody are a separate
concern with separate custody — the Settlement Engine's job in Phase 2D.

`derivation_index` is persisted from a dedicated Postgres sequence, so every
address is re-derivable from the xpub alone after a restore.

---

## The third asset leg and the two rate locks

Phase 1 models two assets: `sourceAmount` (what the merchant quoted, IDR) and
`settlementAsset` (what the merchant is paid, USDC). The payer's asset was not
modelled at all — `PRICE_LOCKED` converted the quote straight into the payout.

A deposit address needs an expected amount in the payer's asset on a specific
chain, so the intent gains a third leg (`payment: { asset, chain }`). At
`PRICE_LOCKED` the engine now quotes twice off the same `sourceAmount`:

```
sourceAmount ──quote→settlement──> settlementAmount, fee, netAmount   (Phase 1, unchanged)
             └─quote→payment─────> deposit.amount                      (new)
```

Both rates are locked in the same step, so neither the payer's quote nor the
merchant's payout can drift mid-payment. When the payer's asset equals the
settlement asset the two quotes coincide and the Liquidity Router has nothing
to convert — the skip the roadmap describes, falling out of the model rather
than being special-cased.

---

## The watcher

`WalletWatcher.tick()` performs one complete pass over one `(chain, asset)`
pair and returns what it did. `apps/api` runs it on a configured interval and
exposes an admin route to force a pass. Tests call `tick()` directly against a
scripted fake chain — no timers, no sleeping, no flake — mirroring
`ClearingEngine.resumeStuck()`.

```
1. read the cursor and the head; bound the scan to [cursor+1, min(head, +blockRange)]
2. list the addresses still being watched
3. fetch Transfer logs for those addresses and record them (upsert, status PENDING)
4. reclassify each probable deposit against the current block hashes
5. fund any address whose confirmed total reaches the required amount
6. write the cursor
```

**Native deposits are read from block bodies, not logs.** An ERC-20 transfer
calls a contract and emits `Transfer`, which `eth_getLogs` can filter. The
chain's own currency moves without either, so there is nothing to match — a
native deposit is visible only in the block's transaction list. `transfers()`
branches on `CHAIN_NATIVE_ASSETS`: the named asset is scanned per block, every
other asset takes the log path unchanged.

Balance polling (`eth_getBalance` per deposit address) was the alternative and
was rejected: a balance is a number with no transaction attached, so it yields
no `txHash`, no sender, and no block hash for `classifyDeposit` to probe against.
The confirmation and reorg policy below is reused **unchanged** precisely
because a block body carries all three.

The watcher nevertheless uses confirmed balances as a **downtime
reconciliation**, not as the ordinary transaction scanner. It reads each
watched address at `head - confirmationDepth`; any value not already represented
by a transfer becomes an idempotent synthetic deposit carrying that settled
block's number and hash. Native assets use `eth_getBalance`; with
`WATCHER_TOKEN_BALANCE_CATCH_UP=true`, ERC-20 assets use `balanceOf` at the same
pinned block. A successful reconciliation advances that
asset's cursor to the settled height, leaving the final confirmation window for
the normal scanner. ETH and tokens therefore recover immediately after an outage
without replaying every historical block or log window, while recent value is
still never skipped ahead of finality. Local `dev:all` enables token balance
catch-up; deployed workers remain log-only unless explicitly opted in.

Two limits worth stating. The scan costs one `eth_getBlockByNumber` per block,
where the ERC-20 path costs one `eth_getLogs` for the whole range — so
`WATCHER_BLOCK_RANGE` now has a per-block cost on native chains. And only
**top-level** transfers are seen: ETH moved by a contract, such as an exchange
sweeping through a router, is an internal transaction that no block body shows.
`trace_block` would catch those, and not every provider tier serves it.

A native deposit records `logIndex: -1`. Deposits are unique on
`(chain, txHash, logIndex)` and a real log index is never negative, so the
sentinel cannot be overwritten by an ERC-20 transfer that happens to share the
transaction — which index `0` would have allowed.

**The cursor is written last.** A crash mid-pass re-scans the range rather than
skipping it, and re-scanning is free because recording upserts on
`(chain, txHash, logIndex)`. **Funding is idempotent without a guard:**
`recordAssetReceived` already returns early when the transaction is not in
`PAYMENT_PENDING`, so a second tick over an already-funded address does nothing.

There is deliberately no indexer **on this path**. Per-intent HD addresses are created
continuously and derived off-chain, so neither a static address filter nor a
factory pattern covers them, and indexing every `Transfer` on a token contract
means backfilling millions to find the tens that matter. What the watcher
actually needs per pass is a handful of RPC calls — `eth_blockNumber`, one
cursor-bounded `eth_getLogs`, and `eth_getBlockByNumber` for the reorg probe.
The contract path is the opposite case, and `SettlementIndexer` below is what
it needed — which turned out to be another pass over the same `ChainClient`,
not a redesign.

---

## The settlement indexer

`SettlementIndexer.tick(chain)` is one pass over one chain's `PaymentRouter`,
and it mirrors the watcher above:

```
1. read the cursor and the head; bound the scan to [cursor+1, min(head, +blockRange)]
2. fetch PaymentCompleted logs from the router and record them (upsert, status PENDING)
3. reclassify each recorded settlement against the current block hashes
4. tell the clearing engine about any settlement past the confirmation depth
5. write the cursor
```

**Why this is not a separate indexer service.** The argument above is about
deposit addresses: derived continuously off-chain, so no static filter covers
them. None of it holds for the router, which is **one known address emitting one
event**. A pass costs the same three RPC calls the watcher makes, and
`policy.ts` classifies a settlement with no changes at all — the finality
question is identical. A service with its own datastore would add
infrastructure without adding capability, and would put the reorg policy in two
places.

What differs from a deposit is the matching, and it is simpler: a
`PaymentCompleted` log names its own `intentId`, so there is nothing to match on
amount or address. The cursor is keyed by the router address rather than an
asset, which is why `WatcherCursorRepository` takes a `stream` string.

**Confirmation depth applies here too.** A settlement below the depth has told
the clearing engine nothing and can vanish freely. Only at depth does it advance
a payment. Settling at one confirmation would mean a reorg could unsettle a
payment the merchant had already been told about — and `SETTLED → unsettled` is
not a legal transition.

A settlement reorged away after it completed a payment is published as
`chain.settlement.orphaned` with `wasCompleted: true`: the merchant has been
paid on-chain, so this is a fact for a human, not a state to undo.

**Reconciliation.** The router only emits `PaymentCompleted` for an order this
backend signed, so a confirmed log naming an `intentId` no payment claims means
the chain and the database disagree — money moved for a payment that is not
recorded. That is published as `chain.settlement.unmatched` and **not retried**:
repeating the lookup every pass would bury the finding rather than surface it.

---

## Confirmation depth is the finality line

A deposit below the configured depth is `PENDING`: recorded, visible, and
touching nothing. It cannot fund an intent and has posted nothing to the ledger,
so a reorg that drops it is a status change and a total that goes back down.

At depth it becomes `CONFIRMED` and only then can it fund. Funding is
**accumulate-and-confirm at ≥ expected**: every confirmed transfer to a watched
address is its own row, and the cumulative confirmed total reaching the
expected amount is what funds the intent. This is not leniency, it is the common
case — an exchange withdrawal often arrives net of a withdrawal fee, and a payer
topping up a short send produces two transfers. Strict equality would leave a
paying customer unfunded. Excess is recorded as an observed fact and nothing
more; refunding it is Phase 3's _Underpayment & Overpayment Handling_.

### Orphaned after confirmed

If a `CONFIRMED` deposit is later reorged away, the watcher records the fact and
flags the payment. It does **not** auto-reverse. By then the merchant payout may
be irreversibly out the door, and posting a compensating entry would create a
negative treasury position with nothing funding it. `SETTLED → unsettled` is also
not a legal transition in a state machine whose entire value is being
forward-only.

The condition is derived from two timestamps (`confirmed_at` and `orphaned_at`
both set), surfaced on the payment DTO as `deposit.reviewRequired`, and published
as `chain.deposit.orphaned` through the existing `EventPublisher`. It is
deliberately not a `clearing_events` row — that table's `sequence` equals the
transaction's `version`, and both count applied transitions; appending an event
with no transition would break the invariant. Recovering an
orphaned-after-confirmed deposit is a treasury decision, and treasury is Phase 2D.

### Bounding the reorg probe

Probing every deposit forever is unbounded work. The reorg probe only touches
deposits within `depth × reorgWatchWindow` confirmations of the head (default
`2`). Past that window a deposit is treated as final and is no longer probed —
the finality assumption made explicit and bounded, rather than left implicit.

---

## Supported chains

`CHAIN_IDS` in `packages/core/chain/src/types.ts` is the list, and it is the only
place a network is added. Everything downstream is already keyed by `ChainId` —
RPC URLs, token addresses, confirmation depths, router addresses, quoters — so
widening the union is what makes the compiler enumerate the sites that must grow
with it.

| `ChainId`           | EIP-155 id | Explorer                                       |
| ------------------- | ---------- | ---------------------------------------------- |
| `base`              | 8453       | `https://basescan.org`                         |
| `base-sepolia`      | 84532      | `https://sepolia.basescan.org`                 |
| `arbitrum`          | 42161      | `https://arbiscan.io`                          |
| `arbitrum-sepolia`  | 421614     | `https://sepolia.arbiscan.io`                  |
| `robinhood-testnet` | 46630      | `https://explorer.testnet.chain.robinhood.com` |
| `arc-testnet`       | 5042002    | `https://testnet.arcscan.app`                  |
| `hedera`            | 295        | `https://hashscan.io/mainnet`                  |
| `hedera-testnet`    | 296        | `https://hashscan.io/testnet`                  |

Every id above was read off the network with `cast chain-id`, not copied from a
documentation page. Arc mainnet is missing on purpose: it does not launch until
16 September 2026, so no endpoint can confirm its id, and a chain fact nobody can
check is worse than a missing one. Add it when the network answers.

Which of them a deployment actually watches is configuration: a chain with no
`CHAIN_RPC_URLS` entry is not scanned, and `CHAIN_ASSETS` naming a chain without
an RPC URL is a boot failure rather than a silent skip.

`isMainnetChain` is a chain fact beside the ids, not a comparison against a chain
name. The guard that reads it refuses an in-process quote-signing key on a chain
carrying real value, and a guard written as `chain === "base"` would have called
Arbitrum One a testnet the day it was added.

### Robinhood Chain and the Orbit chains

Robinhood Chain is an Arbitrum Orbit L2 with ETH as its gas token. viem ships no
definition for it, so `@mayarin/provider-viem-chains` defines it — that package
exists to hold one copy of the `ChainId → viem Chain` map, so a price adapter can
import a chain fact without pulling a signer's dependency tree behind it, and so
a chain cannot be defined two slightly different ways in two adapters. The test
beside it asserts each viem `id` equals the `EVM_CHAIN_IDS` entry: viem
broadcasts with its own id, so a typo there would send a transaction to the wrong
network while every check against the domain table still passed.

### Arc, and the first chains whose native asset is not ETH

Arc and Hedera are the first chains here whose native asset is not ETH — USDC on
Arc, HBAR on Hedera. `EvmChainClient` already takes a `nativeAssets` map rather
than assuming, so this is configuration; the failure it prevents is a native
transfer scanned as if it were ETH, which is a wrong balance rather than an
error.

Arc needs one thing said explicitly, because it is the only chain here where
getting it wrong corrupts the ledger rather than a display. **Arc has one USDC
balance behind two interfaces**: the native view used for gas and `msg.value`
carries 18 decimals, and the ERC-20 contract at
`0x3600000000000000000000000000000000000000` is a 6-decimal view of the same
balance, a factor of 10^12 apart, with the native side canonical. They are not
two holdings. Modelling them as two `AssetCode`s would count the same money
twice, and every reconciliation afterwards would be wrong while still balancing.

That contract is not a precompile despite its address. It is Circle's
`FiatTokenV2` behind an EIP-1967 proxy, and — though Arc's documentation
describes only `transferFrom`, `approve` and allowances — it implements EIP-3009
and EIP-2612. Measured on 3 September 2026 against Arc testnet:
`authorizationState(address,bytes32)` and `nonces(address)` both answer, two
invented selectors both revert, and `DOMAIN_SEPARATOR()` equals the value
computed locally for `{name: "USDC", version: "2", chainId: 5042002,
verifyingContract: 0x3600…0000}`.

### Block numbers on an Arbitrum chain

`block.number` read **inside a contract** on an Arbitrum chain returns an
approximate _L1_ block number, not the L2 height. Nothing in the chain layer
depends on that: the watcher and the settlement indexer count confirmations from
block numbers carried by `eth_getBlockByNumber` and the log envelope, both of
which are L2 heights and consistent with each other.

What does change is what a confirmation is worth. Depth is per-chain
(`CHAIN_CONFIRMATIONS`), so an Arbitrum block time is a configuration value
rather than a code change — but `WATCHER_REORG_WATCH_WINDOW` is global, and it
multiplies depth, so one window across chains with different depths is a
different absolute window on each. Sized against the deepest chain it is
conservative everywhere, which is the safe direction.

---

## Configuration

Every variable is optional. The chain layer is off unless `CHAIN_ENABLED=true`,
so an existing deployment boots byte-for-byte unchanged.

```
CHAIN_ENABLED=true
CHAIN_RPC_URLS={"base-sepolia":"https://sepolia.base.org"}
CHAIN_ASSETS={"base-sepolia":{"USDC":"0x036CbD53842c5426634e7929541eC2318f3dCF7e"}}
CHAIN_CONFIRMATIONS={"base-sepolia":6}
CHAIN_START_BLOCKS={"base-sepolia":"0"}
DEPOSIT_XPUB=xpub6...
WATCHER_INTERVAL_MS=15000
WATCHER_BLOCK_RANGE=2000
WATCHER_NATIVE_BLOCK_RANGE=100
WATCHER_RETENTION_SECONDS=86400
WATCHER_REORG_WATCH_WINDOW=2
ADMIN_TOKEN=...
```

Validated at boot the way `EXCHANGE_RATES` already is: a deployment with
`CHAIN_ENABLED=true` and no xpub, no RPC URL, or a token address missing for a
configured asset fails to start rather than failing on its first payment.
Enabling the layer while `ASSET_RECEIPT_MODE=auto` is also a boot failure —
auto confirmation alongside a live watcher would fund payments nobody paid.
`WATCHER_INTERVAL_MS=0` disables the timer, leaving only the admin route.

The settlement indexer runs on its own clock, `INDEXER_INTERVAL_MS` (60s by
default), because it polls a hosted subgraph that bills per query rather than
our own RPC — sharing the watcher's 15s spends a Subgraph Studio day before it
is over. A failing pass doubles its delay up to `INDEXER_MAX_BACKOFF_MS`, and a
429 that carries `Retry-After` wins when it asks for longer.
`INDEXER_INTERVAL_MS=0` turns settlement indexing off and starts no loop at all. See
`packages/subgraph/README.md` for the query arithmetic and why a continuous
deployment belongs on a Graph Network endpoint.

---

## Treasury execution

A deposit address receives **exactly** the quoted amount, so it cannot also pay
the gas to move it. That is why the deposit path detected the payer's asset and
stopped: nothing could call the router on the payer's behalf, and the payer —
who sent a plain transfer from a wallet or an exchange — has no further part to
play.

Three options were possible. Grossing the quote up hides Mayarin's operating
cost in the payer's price. Pre-funding every deposit address costs a transaction
per payment, before the payment, which is worse than the payment it enables for
small amounts. A **counterfactual contract** removes the problem instead of
paying for it, and that is what ships.

```
DepositForwarderFactory.forwarderAddress(salt) -> deposit address
  derived off-chain, with no key and no transaction, before any code exists
  there. The payer sends to it.

executor: sweep(salt) -> deploy the forwarder and move the balance to the
  operator, gas paid by the operator
        → assemble payEth / payERC20 from the persisted signed order
        → submit, measure the output and the gas actually spent
        → post the swap and the gas → SETTLING
```

`DepositForwarder` is `receive()`, `sweepNative`, `sweepToken`, and no
decisions. It does not know about orders, routes, `minOut` or the router.
Everything requiring judgement stays in the executor off-chain; everything
requiring atomicity stays in `PaymentRouter`.

The forwarder takes **no constructor arguments**, so its init-code hash is a
constant and the deposit address is a pure function of the salt. That is
load-bearing: an address that cannot be derived from the salt alone cannot be
shown to a payer before it is funded. Both sides of the derivation are pinned to
the same vectors — Solidity from the CREATE2 formula, TypeScript from viem —
because a divergence would mean payers sending to addresses the factory can
never deploy to.

The sweeps are permissionless. `destination` is immutable on the factory, so an
untrusted caller can only pay gas to move funds where they were always going;
an owner check would buy nothing and add a way to be wrong.

**Gas is the operator's, and it is booked.** See `GAS_EXPENSE` in
[`ledger.md`](./ledger.md).

**`minOut` failure is bounded.** A miss hard-reverts on-chain: it costs gas and
moves nothing, so a retry with a fresh route is cheap and usually right. Past
the attempt bound the failure is terminal — further retries bet that the price
comes back, and while it does not, Mayarin holds the payer's asset against an
obligation it cannot discharge. Nothing is booked when execution never
succeeded, so the held asset stays visible rather than being silently cleared.

The operator momentarily holds the payer's asset between the sweep and the
submission. That is a custody-perimeter change and is recorded in
[`threat-model.md`](./threat-model.md).

When execution is wired the deposit path is priced and signed by the **same
planner the contract path uses**, rather than by `RateProvider`. Running both
would be two prices for one payment, free to disagree; running the planner
alone also produces the amount the payer must send, since `ContractLock` already
carries the slippage-grossed `payerEstimate`. `refundTo` is the treasury: this
path has no payer address, the payer sent a fixed quoted amount, and the excess
is Mayarin's — the same reasoning `FX_RESULT` encodes for a shortfall.

**Proven on Base Sepolia.** A payer sent ETH to an address holding no code; the
operator deployed the forwarder at that exact address, swept it, and settled
through the router in one further transaction. Both paths:

| Path                  | Transaction                                                                                                         | Merchant received |
| --------------------- | ------------------------------------------------------------------------------------------------------------------- | ----------------- |
| ETH deposit, swapped  | [`0xc6fb73d9…`](https://sepolia.basescan.org/tx/0xc6fb73d96a2a78dad0dbee788f0c45740ba4238165eab647328f6a4a5f40492b) | 0.099 USDC        |
| USDC deposit, no swap | [`0x36560d7d…`](https://sepolia.basescan.org/tx/0x36560d7d9312bedac416c1e99914afea2700891fbf0cf96bf16cb2b1ce13656b) | 0.099 USDC        |

Both settled `minOut − fee` to the merchant, the fee to the treasury, and the
excess above `minOut` to `refundTo`. The same-asset payment skipped the DEX
entirely, as the contract's no-op path intends.

---

## Deployed addresses

Base Sepolia (chain id 84532), deployed 2026-08-07 in block 45164044. Both
contracts are verified on Basescan.

| Contract                  | Address                                      |
| ------------------------- | -------------------------------------------- |
| `PaymentRouter`           | `0xEe7c5B5a9eeAf667A6EFb217A8a77534C873f7a9` |
| `TimelockController`      | `0x0c006FC14063e3F78271312B975231e4BD6e8B00` |
| `DepositForwarderFactory` | `0x598F64551456BCa2536386ED54A24412E3e32fCe` |

A second factory with byte-identical code and the same `INIT_CODE_HASH` sits at
`0x69c72C5191149e85CD862FCcccC2A6F699E9582F`, and that is the one
`DEPOSIT_FORWARDERS` currently names for Base Sepolia. Either serves; a deposit
address derives from whichever the deriver is given, so what matters is that the
configuration and the sweeper agree — not which of the two is listed here.

`DepositForwarderFactory` sweeps to `0x616e2B9Bc83D60790E70CbaAc6c8612AFc6A7896`
and its `INIT_CODE_HASH` is
`0xee0569965b5f80efbe628375129a0db290a6d9476366befecb3529b51c25be89` — the value
`DEPOSIT_FORWARDER_INIT_CODE_HASH` must carry, since every deposit address
derives from it. Verified against the deployed factory: the TypeScript deriver
and `forwarderAddress(salt)` agree for indices 0, 1, 42 and 999.

Arc testnet (chain id 5042002), deployed 2026-09-04 in block 60392299 and
verified on ArcScan. **Throwaway v0**: these addresses must not reach the SDK,
the documentation of a released version, or a demo link.

| Contract                  | Address                                      |
| ------------------------- | -------------------------------------------- |
| `PaymentRouter`           | `0xee7c5b5a9eeaf667a6efb217a8a77534c873f7a9` |
| `TimelockController`      | `0x0c006fc14063e3f78271312b975231e4bd6e8b00` |
| `DepositForwarderFactory` | `0x04cd74e77ac145b18d61c6c8d7939e3241dbb60a` |

**Two address collisions live in that table, and both are the same phenomenon.**
The router and timelock carry Base Sepolia's addresses exactly, because the same
deployer used the same nonces — `CREATE` is a function of those two and nothing
else. It is harmless on chain, since the EIP-712 domain carries `chainId`, and
misleading everywhere else: an address no longer identifies a chain, so read the
chain key in `PAYMENT_ROUTERS` rather than the address.

The second collision is worse to read. Arc's factory sits at the address Base
calls **superseded below** — and on Arc it is the _current_ contract, deployed
today from current source, with `INIT_CODE_HASH`
`0xee0569965b5f80efbe628375129a0db290a6d9476366befecb3529b51c25be89`. Same
address, different chain, different bytecode, opposite status.

An earlier factory at `0x04CD74e77ac145B18d61c6C8D7939e3241DBB60A` is
**superseded**. The security pass (#83) moved `destination` into the forwarder's
own bytecode, which changed the forwarder's creation code and therefore
`INIT_CODE_HASH` — so that factory can no longer deploy to any address derived
from the current deriver. This is precisely the hazard the deploy script warns
about, playing out where it is cheap: every address it issued was a test deposit
and every one was swept before the change. On mainnet the same sequence would
have stranded funds, which is why the audit belongs before the deployment payers
are pointed at.

On-chain configuration as deployed:

| Setting             | Value                                                               |
| ------------------- | ------------------------------------------------------------------- |
| `permit2`           | `0x000000000022D473030F116dDEE9F6B43aC78BA3` (canonical, immutable) |
| settlement asset    | USDC `0x036CbD53842c5426634e7929541eC2318f3dCF7e`                   |
| input asset         | USDC (same)                                                         |
| DEX router          | SwapRouter02 `0x94cC0AaC535CCDB3C01d6787D6413C739ae12bc4`           |
| `CONFIG_ROLE`       | the timelock, and nothing else                                      |
| `GUARDIAN_ROLE`     | the guardian, separate from config authority                        |
| timelock `minDelay` | 0 — testnet only; mainnet keeps the 48h default                     |

`CHAIN_START_BLOCKS` should name the deploy block (45164044) rather than `0`,
or the settlement indexer's first pass walks the chain from genesis.

The deploying key retained no privilege: it holds neither `CONFIG_ROLE` nor
`DEFAULT_ADMIN_ROLE`, both of which live only on the timelock. That is the
property the admin model exists to produce, so it is worth re-checking after
any redeploy rather than assuming the constructor did it.

A redeploy changes the EIP-712 domain — `verifyingContract` is part of it — so
every previously signed order becomes invalid, not merely aimed at the old
address. Cheap on testnet, a migration on mainnet.

---

## Related

- [Clearing Engine](./clearing-engine.md)
- [Architecture](./architecture.md)
- [Roadmap](./roadmap.md)

[← Documentation index](./README.md)
