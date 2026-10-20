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

| `ChainId`          | EIP-155 id | Explorer                       |
| ------------------ | ---------- | ------------------------------ |
| `ethereum`         | 1          | `https://etherscan.io`         |
| `ethereum-sepolia` | 11155111   | `https://sepolia.etherscan.io` |
| `base`             | 8453       | `https://basescan.org`         |
| `base-sepolia`     | 84532      | `https://sepolia.basescan.org` |
| `arbitrum`         | 42161      | `https://arbiscan.io`          |
| `arbitrum-sepolia` | 421614     | `https://sepolia.arbiscan.io`  |
| `arc-testnet`      | 5042002    | `https://testnet.arcscan.app`  |
| `polygon-amoy`     | 80002      | `https://amoy.polygonscan.com` |
| `bsc-testnet`      | 97         | `https://testnet.bscscan.com`  |
| `polygon`          | 137        | `https://polygonscan.com`      |
| `bsc`              | 56         | `https://bscscan.com`          |

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

`@mayarin/provider-viem-chains` holds one copy of the `ChainId → viem Chain` map,
so a price adapter can import a chain fact without pulling a signer's dependency
tree behind it, and a chain cannot be defined two slightly different ways in two
adapters. The test beside it asserts each viem `id` equals the `EVM_CHAIN_IDS`
entry: viem broadcasts with its own id, so a typo there would send a transaction
to the wrong network while every check against the domain table still passed.

The [Arc audit](./arc.md) records native-decimal regression coverage and the
payer-submitted contract-path evidence.

### A scale belongs to a chain and an asset

Two stablecoins on one chain can disagree. DAI and USDS carry 18 decimals on Ethereum
and Arbitrum, next to USDC, USDT and USDG at 6, so a scale per chain cannot hold:
`chainUnitScale(chain, asset)` takes both. A chain whose stablecoins all differ from
the registry (BNB Smart Chain, all 18) is one entry; a token that differs from its
siblings (DAI and USDS on Ethereum and Arbitrum) is another. Every conversion names
its asset: the order's `minOut` and `fee` use the settlement asset, the settlement
indexer reads the asset out of the `PaymentCompleted` log and refuses a token the
deployment does not list, and an order being renewed carries its settlement asset.
The decimals in `token-units.ts` are what `decimals()` returned on each chain when the
token was admitted; read them back again before adding a stablecoin.

### BNB Smart Chain, the first chain whose stablecoins are not 6 decimals

USDT and USDC on BNB Smart Chain carry 18 decimals. The domain keeps counting
every stablecoin in 6 (`assetDecimals`), so the ledger, the quote and the signed
order's `minOut`/`fee` are unchanged and `engine.ts` still compares them with the
settlement amount. `packages/core/chain/src/token-units.ts` is the only place
that crosses to what the token contract says, at five boundaries:

| Boundary                                     | Direction                            |
| -------------------------------------------- | ------------------------------------ |
| `EvmChainClient.transfers` / `balances`      | contract → domain (`fromChainUnits`) |
| `EvmChainClient.settlements`                 | contract → domain                    |
| `EvmWalletBalanceReader`                     | contract → domain                    |
| order signing and the order in the call DTO  | domain → contract (`toChainUnits`)   |
| `EvmTreasuryExecutionPort` permit and output | both                                 |

Anything finer than one domain minor unit is dropped on the way in, as it is for
Arc's native view. The payer's own wallet must size a Permit2 amount in token
units: `payerEstimate` is a `Money` in the asset's 6-decimal units.

Not carried over, on purpose: x402 (`services/x402.ts`), the cross-asset settler
and escrow take amounts straight from `Money`. Configure no facilitator, swap
venue or escrow factory for `bsc-testnet`.

### Arc, the first chain whose native asset is not ETH

Arc is the first chain here whose native asset is not ETH — its own currency is
USDC. `EvmChainClient` already takes a `nativeAssets` map rather than assuming,
so this is configuration; the failure it prevents is a native transfer scanned
as if it were ETH, which is a wrong balance rather than an error.

Arc needs one thing said explicitly, because it is the only chain here where
getting it wrong corrupts the ledger rather than a display. **Arc has one USDC
balance behind two interfaces**: the native view used for gas and `msg.value`
carries 18 decimals, and the ERC-20 contract at
`0x3600000000000000000000000000000000000000` is a 6-decimal view of the same
balance, a factor of 10^12 apart, with the native side canonical. They are not
two holdings. Modelling them as two `AssetCode`s would count the same money
twice, and every reconciliation afterwards would be wrong while still balancing.

The deposit watcher follows from that. A wallet sends Arc USDC as the gas coin:
a plain value transfer, which writes a `Transfer` only on the native view at
`0xffff…fffe`. A call to the ERC-20 contract writes one on both views. Scanning
the token's logs therefore missed every wallet payment, silently.
`EvmChainClient.transfers` reads Arc USDC from the native view instead, which
sees each movement exactly once, and divides by 10^12 into the six-decimal
amount `balanceOf` reports. USDC stays an ERC-20 asset everywhere else,
balances included.

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

The settlement indexer reads `PaymentCompleted` logs directly from each chain
RPC on its own clock, `INDEXER_INTERVAL_MS` (60s by default). It advances a
persisted cursor in bounded ranges. A failing pass doubles its delay up to
`INDEXER_MAX_BACKOFF_MS`, and a 429 carrying `Retry-After` wins when it asks for
longer. `INDEXER_INTERVAL_MS=0` turns settlement indexing off.

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

Ethereum Sepolia (chain id 11155111), deployed 2026-09-10 from block 11671894.
All three contracts are verified on Etherscan.

| Contract                  | Address                                      |
| ------------------------- | -------------------------------------------- |
| `PaymentRouter`           | `0xE54E800bfFD1fBb5756B7c5E6A4aa40Dd09210E7` |
| `TimelockController`      | `0x04CD74e77ac145B18d61c6C8D7939e3241DBB60A` |
| `DepositForwarderFactory` | `0xCa83514c0bef26B642f7A69b2ab529c2ab5d7958` |

USDC (`0x1c7D…7238`) is the only settlement asset. Native ETH, USDC, EURC
(`0x0821…94D4`) and PYUSD (`0xCaC5…3bB9`) can be payer assets. V3 SwapRouter02
(`0x3bFA…e48E`) and V2 Router02 (`0xeE56…CfE3`) are whitelisted DEX routers.
The local test configuration routes ETH and EURC through V3 and PYUSD through
V2 into USDC. The V2 router was added through the existing zero-delay timelock
in block 11672131, without redeploying any contract. Sepolia liquidity is thin
and its observed prices can be far from market, so
`QUOTE_UNGUARDED_TESTNET_PAIRS` explicitly self-references ETH/USDC and
PYUSD/USDC for integration testing. The engine refuses this escape hatch on a
mainnet; these routes are not production liquidity claims.

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

Arbitrum Sepolia (chain id 421614), deployed 2026-09-29 in block 313961067.
**Throwaway v0** in the same sense as Arc: #201 changes the `Order` struct, and
that redeploy is the address of record.

| Contract                  | Address                                      |
| ------------------------- | -------------------------------------------- |
| `PaymentRouter`           | `0xEe7c5B5a9eeAf667A6EFb217A8a77534C873f7a9` |
| `TimelockController`      | `0x0c006FC14063e3F78271312B975231e4BD6e8B00` |
| `DepositForwarderFactory` | `0x4b96E74B963efa7Ab7D7497854Fc87220Bd092C4` |

Router and timelock collide with Base Sepolia's and Arc's for the reason above:
same deployer, same nonces. The factory carries the shared `INIT_CODE_HASH`
`0xee0569965b5f80efbe628375129a0db290a6d9476366befecb3529b51c25be89`, read back
from the deployed contract. Settlement and input asset is Circle USDC
`0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d`; the whitelisted DEX router is
Uniswap v3 SwapRouter02 `0x101F443B4d1b059569D643917553c771E1b9663E`, quoted
through QuoterV2 `0x2779a0CC1c3e0E44D2542EC3e79e3864Ae93Ef0B` against the
WETH/USDC 0.3% pool. Each address was checked on chain (code present, factory
and `WETH9` agree) before it was whitelisted. The deploying key holds no
`CONFIG_ROLE`; the timelock does.

Paxos USDG (Global Dollar, 6 decimals) `0xFFC95faa3d63Cde504a05B567C600B78C0b41892`
was added after the deploy as both an input and a settlement asset, through the
zero-delay timelock (execute tx
`0x9208b2c5e207d28df54921718d02fe7e1e99de52e76274eb4d37615113284124`). No
contract was redeployed. A payer on Arbitrum Sepolia can therefore bring ETH
(native, swapped through the WETH/USDC pool), USDC or USDG.

A merchant chooses its settlement asset per chain
(`merchants.settlement_asset_by_chain`, migration 0034): the merchant-wide
`settlement_asset` is the default, and a chain may override it — a chain with no
USDC venue can settle USDG while every other chain settles USDC.

No venue converts between USDC and USDG on Arbitrum Sepolia, so a payer there
pays in the asset the merchant settles in.

PYUSD (`0x637A1259C6afd7E3AdF63993cA7E58BB438aB1B1`, 6 decimals, read back on
chain) was added on Arbitrum Sepolia as input and settlement asset in one
timelock batch (schedule tx
`0x3b8090a4dbbddd4688c998c640b2d894b7451e8aa2de734882bb2c660973b61d`, execute tx
`0xd97a8d2c3ebfa089140fe5d2409db5a1be05aca3ff8a9a3fc609eeaa7b4d860c`). Circle
publishes no EURC on Arbitrum Sepolia.

### Solana devnet Orca

SOL payments can settle to official devnet USDC through Orca Whirlpool
`5GPCnpWwoDayCP5FVCJT1cS7dePufC5FrjPTVvPoUYnm` (wrapped SOL
`So11111111111111111111111111111111111111112`, USDC
`4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`). The quote layer uses the
same configured pool as the transaction builder, so rail availability reflects
an executable exact-output quote rather than a reference price. This devnet pool
has thin liquidity: availability remains amount-dependent and a 1 SOL trade can
fail even though smaller quotes succeed.

The payment router already admits wrapped SOL as an input asset and Orca as a
router. Address lookup table `ER6ChWqataQCj91wbqAWnY92rf33VyjdUQHxHyLtu6z4`
contains the current SOL/USDC, devUSDG/USDC, devUSDT/USDC, and PYUSD/devUSDC
route accounts. The stable-pool accounts were added in tx
`5fKo8DovV3dDrhWTMghddoQNdNvgXsTXeJSsDE5f28yoH6MQkGfVvg9TuCzfDvH2b25CYScQPah2pSCKoWMX2Yym`.

Official devnet USDG `4F6PM96JJxngmHnZLBh9n58RH4aTVNWvDs2nuwrT5BP7` cannot
currently be paired permissionlessly with official devnet USDC on Orca. It is a
Token-2022 mint with extensions that require an Orca TokenBadge, and Orca's SDK
reports it as unsupported. Creating and seeding USDG/USDC therefore requires
Orca's token-badge authority, or a different swap venue; it is not only a faucet
or liquidity task. Raydium CLMM/CPMM and Meteora DAMM v2 apply equivalent
admin allowlisting to the unsupported extensions carried by this mint, so they
do not provide a permissionless escape hatch. The ready-to-send authority
request is in [`docs/orca-usdg-token-badge-request.md`](./orca-usdg-token-badge-request.md).

Devnet integration instead uses clearly identified, fixed-supply surrogates.
They are not issuer tokens and must not be treated as such:

| Asset label | Mint                                           | Orca splash pool                               |
| ----------- | ---------------------------------------------- | ---------------------------------------------- |
| `devUSDG`   | `H1hMJToegAs8mXt23eVuwKJb17fz4N5emZBCzAvmBF6R` | `LkKtkAzT4kjfwv6objWTRXo4pLpBUmdEJyJ9Uy2zHsM`  |
| `devUSDT`   | `8PtqaCwyS3JT1JfJgkKsFnYRkftQLpRc2kvxebxMUuus` | `6L9dVPZZbvm4jGxPCgrKfiGsnJaQTS5562UEGcRVZyow` |

Each mint has 1,000 units of fixed supply, six decimals, no freeze authority,
and no remaining mint authority. Each pool was seeded at 1:1 with 0.25 units per
side. Pool creation transactions were
`yJkwPLSTLBcQq4yd8QuRz6nFmMSpkNe3tEenKC8qKHZfGkqmrpNJZinUvGz4m89vk1UJnXM3ZUzZzwqK1W2u7g5`
(devUSDG) and
`4FJjAbgFoAsDHrco3WM6K2hzEiULxCg4Qdig3tTxGxZk1N6zyveboteywmVMuTjQwhVQD3R87exvdVj87qU8kZBw`
(devUSDT); liquidity was opened in
`5XGS1o2STcmaYVdvUgMsiphsAKutrPQB3vTJfwrGPSfRbG1Zv8WbQ93BjKm6HyfaxDi7sAuVAZfZpyn7voLAWr64`
and
`5wbKsqrYusnNZM1UxsZF9jSZnofLZtboG2UL487EZoZJCuHSLt1A3NPmUXJwqhZCpvrGeRuqBfPzFaD3HH9RLVf8`.
The PaymentRouter input allowlist was updated in tx
`26fTx9YyszZcUHfbkgsARWrXzuhEjLnwbr7UBfKFTKt74AtjfS5jMSvgs2vFrhy6UXWy9burdRtXyjoFNgGcnXTF`.
Liquidity is deliberately small, so exact-output quote failure remains the rail
availability boundary.

Both routes settled through the deployed PaymentRouter end to end on 2026-10-08:

- 0.010000 devUSDG produced 0.009522 official devnet USDC (tx
  `eio7PyxhGnvEx3QuGTupUbKQuFrY3Vv62xbGbYogCsbDS1BZW5S5xbeWxtYVAMrF5beuQaafyjy4qx5hqiEBnfS`).
- 0.010000 devUSDT produced 0.009522 official devnet USDC (tx
  `5zYPi8trhEqNYAutSY9JwrF7yNWrEVgDzfHnkcHjj7zN4C418NLKa5scUKEEPV5sr5XwZuMJz4EwPo6yH7amYaaz`).

On-chain configuration as deployed (Base Sepolia):

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

## Redeploy of 20 October 2026 (solc 0.8.37)

Every contract was rebuilt with solc 0.8.37 and redeployed, because the 0.8.28
build carries seven entries of the Solidity bug list that explorers show on each
contract (none applies: the source has no transient storage). One low-severity
entry remains on 0.8.37 and is fixed only in the unreleased 0.8.38. The router
now includes the settlement destination registry ([#425](./destination-registry.md)),
enforcement off.

The bytecode changed, so the forwarder `INIT_CODE_HASH` is
`0xa219c31ae3224565c3296b082213133ede259accd1343948460ce1987b315e79` and
`DEPOSIT_FORWARDER_INIT_CODE_HASH` carries it. Addresses issued under the old
hash (`0xee05…be89`) still have to be monitored and swept by the old factories.

| Chain              | `PaymentRouter`                              | `TimelockController`                         | `DepositForwarderFactory`                    | Start block |
| ------------------ | -------------------------------------------- | -------------------------------------------- | -------------------------------------------- | ----------- |
| `polygon-amoy`     | `0xca83514c0bef26b642f7a69b2ab529c2ab5d7958` | `0xe54e800bffd1fbb5756b7c5e6a4aa40dd09210e7` | `0x6cced8eeb0230f7078cff7408fd31d250dfacd54` | 50644188    |
| `bsc-testnet`      | `0xca83514c0bef26b642f7a69b2ab529c2ab5d7958` | `0xe54e800bffd1fbb5756b7c5e6a4aa40dd09210e7` | `0x6cced8eeb0230f7078cff7408fd31d250dfacd54` | 137816590   |
| `base-sepolia`     | `0x5def4dc27a499644c1d2945c78c23aa4f3c15223` | `0xfc883d71375a15d3d3819ae6b21c063f432532a5` | `0x480989f9f3551e64ffbb88dc97f403667b51ba1a` | 48349576    |
| `arbitrum-sepolia` | `0x96fd082f5bbcfec3cfb234f26b347429ecc3f13e` | `0xdd7ba6115c0273f68b25264655f8cc8eaf6647e6` | `0x09dc25cd37e181604b6aba21003b41c9ca781110` | 320934968   |
| `arc-testnet`      | `0x4dd50ba4205e3bcd933067c07b41aaafa478cdd2` | `0x5df26ee8c83f0bbfa4252a8229e08c2e70a89ff8` | `0x7c736def2a82ac8c20a7d1fa63cea19563ae67b1` | 68117930    |
| `ethereum-sepolia` | `0x407f7b9ffc337fa1d6ab65684635893090e5a480` | `0xe510412fe95c3d59245526701ae8d7aff0ab6a66` | `0x69c72c5191149e85cd862fccccc2a6f699e9582f` | 11953088    |

Amoy and BSC share addresses, as do the escrow and batcher contracts below,
because the deployer and nonce match and the others use CREATE2: read the chain
key, not the address. Checked on chain after the deploy: the timelock holds
`CONFIG_ROLE` and `DEFAULT_ADMIN_ROLE`, the deployer holds neither, the guardian
holds `GUARDIAN_ROLE`, and `signer()` equals `SIGNER`. Polygon Amoy and BSC
testnet have no swap venue, so they settle same-asset payments only. Base Sepolia
carries two further routers from failed attempts (`0xef5e…2e64`, `0x0e8e…773c`);
nothing refers to them.

Deterministic singletons, one address on `arbitrum-sepolia`, `base-sepolia`,
`ethereum-sepolia` and `arc-testnet`:

| Contract          | Address                                      | `INIT_CODE_HASH`                                                     |
| ----------------- | -------------------------------------------- | -------------------------------------------------------------------- |
| `EscrowFactory`   | `0xCB6dd0781D36FE95a5ff69248498E48909BB4e1B` | `0x58a2031708a2ba67cb2ff7c005b2e84f308e2ca4b28031ff0859886e71ea75fc` |
| `EscrowFactoryV2` | `0xB14EEab74d84F900132632ff9dAcDe26C5043cad` | `0x8e127716e7db0e6c441573aef490ba60d27dffdbe1c8538c8908b760f9e24c5f` |
| `PayoutBatcher`   | `0x78F0C40E1Aa5a63DD71E58334586461eB3EB6312` | n/a                                                                  |

**Ethereum Sepolia needed extra gas.** Its gas schedule differs from the other
chains': `eth_estimateGas` for the same router creation returns 18.5M there against
2.7M on Base Sepolia, and a plain transfer estimates 15k, not 21k, so forge's own
estimate runs out of gas and the transaction fails with all gas used. It was
deployed with `FORGE_EXTRA_FLAGS="--gas-estimate-multiplier 800"`, and the
configure step needs the same flag (`deploy.sh` now passes it, and
`--configure-only` re-runs that step alone). The escrow factories and batcher were
deployed with the same multiplier. Every contract above is verified on Etherscan,
Basescan, Arbiscan, Polygonscan and BscScan; Arc is not, because ArcScan's
Blockscout answered "too many requests" to the verification calls.

## Mainnet: Polygon and Base (20 October 2026)

First mainnet deploys, from the `mayarin-mainnet-deployer` keystore with
`scripts/deploy.sh`. The multisig and the treasury are the Safes that
`scripts/mainnet-safes.sh` deployed; the order signer and the operator are two
separate AWS KMS keys in `ap-southeast-2` ([operator-signing](./operator-signing.md)).

| Chain     | `PaymentRouter`                              | `TimelockController`                         | `DepositForwarderFactory`                    | Start block |
| --------- | -------------------------------------------- | -------------------------------------------- | -------------------------------------------- | ----------- |
| `polygon` | `0x8f90e9ad0120dd03352a2bc01bdf302447fb2537` | `0xbfc95af1706aa271f0207575cff31cc32ad7656f` | `0x0dc52ff8d7d82d1c43827640de024da88c14224b` | 95861092    |
| `base`    | `0x8F90e9ad0120dd03352a2bC01BdF302447Fb2537` | `0xBFc95Af1706Aa271F0207575CfF31cC32Ad7656f` | `0x0dc52ff8d7d82d1c43827640de024da88c14224b` | 52854178    |

The addresses are the same on both chains because the deployer's nonce was.
Read back from each chain: the timelock holds `CONFIG_ROLE` and
`DEFAULT_ADMIN_ROLE` with a 48 h delay and the multisig as proposer and executor,
the deployer holds nothing, the guardian holds `GUARDIAN_ROLE`, `signer()` is the
KMS order signer, `feeRecipient()` the treasury Safe, and the factory's
`destination()` the KMS operator. `INIT_CODE_HASH` is
`0xa219…5e79`, the same as in `DEPOSIT_FORWARDER_INIT_CODE_HASH`. The deployer's
nonce moved by one between the plan and the deploy (it had sent the operator its
gas), so the addresses in `mainnet-addresses.json` from before the deploy are not
these: read the deploy output, not the prediction.

Base verified on Sourcify (`exact_match` for the router and factory) and Basescan
for the timelock; Polygon on Polygonscan.

### What a payer can bring

Settlement is always the chain's stablecoin: USDC on both chains. A payer's asset
is limited by three separate things, and all three must allow it:

1. **The reviewed list** (`REVIEWED_MAINNET_TOKENS`): on Base USDC, USDT and EURC,
   on Polygon USDC and USDT (USDT0). `CHAIN_ASSETS` may name only these. A merchant
   settles in any of them; a cross-asset payment between two needs a venue, and
   Polygon has none, so there a payer brings the asset the merchant settles in.
2. **A price**: a Uniswap pool in `UNISWAP_POOLS` (seeded into `market_config`)
   and an oracle reference. Nothing is priced without one.
3. **The router's own whitelist**: an input asset for every `payERC20` payer
   (a USDC payer included, not only a swapped one) and a DEX router for every
   swap. Both are `CONFIG_ROLE` acts, so they go through the multisig and the
   48 h timelock. Native ETH needs only the DEX router, not an input asset.

Pools on Base, read from the Uniswap v3 factory
(`0x33128a8fC17869897dcE68Ed026d694621f6FDfD`, from SwapRouter02) and quoted
through QuoterV2 for real execution:

| Pair        | Fee   | Pool                                         | Quote                                             |
| ----------- | ----- | -------------------------------------------- | ------------------------------------------------- |
| WETH9/USDC  | 0.05% | `0xd0b53D9277642d899DF5C87A3966A349A798F224` | 5 ETH gives 11,954 USDC, against 11,905 at 0.3%   |
| cbBTC/USDC  | 0.05% | `0xfBB6Eed8e7aa03B138556eeDaF5D271A5E1e43ef` | 0.1 cbBTC gives 8,150 USDC, against 8,119 at 0.3% |
| cbBTC/WETH9 | 0.05% | `0x7AeA2E8A3843516afa07293a10Ac8E49906dabD1` | not quoted: not a USDC leg                        |

The 0.05% tier is better for a retail-sized payment and the two converge around
100 ETH. The 0.3% WETH/USDC pool holds the most liquidity (a GeckoTerminal
reading, which can be off), but a payer pays its fee on every swap.

Polygon uses the same SwapRouter02 (`0x68b3…Fc45`) and QuoterV2 (`0x61fF…B21e`) as
Arbitrum; both answer with the Uniswap v3 factory `0x1F98…F984` and `WETH9` equal to
WPOL, so a native POL payment routes through the WPOL pools. Quoted for real
execution, USDC out:

| Pair      | Pool picked | Quote                                                   |
| --------- | ----------- | ------------------------------------------------------- |
| WPOL/USDC | 0.05%       | 1,000 POL gives 92.32 USDC, against 91.68 at 0.3%       |
| WETH/USDC | 0.05%       | 1 WETH gives 2,388.89 USDC, against 2,317.73 at 0.3%    |
| WBTC/USDC | 0.3%        | 0.1 WBTC gives 8,071.96 USDC, against 8,052.24 at 0.05% |

WBTC is the exception: its 0.05% pool is shallow and quotes about 0.25% under the
0.3% pool at this size. Polygon's pools are thin next to Base's (WPOL/USDC about
$0.2 million, WETH/USDC and WBTC/USDC under $0.7 million), so a payment there should
carry a ceiling (`MAX_PAYMENT_SETTLEMENT`) until the depth is watched in use.

**Configured now: the native payer assets.** `CHAIN_NATIVE_ASSETS` names ETH on Base
and POL on Polygon, `UNISWAP_POOLS` carries `base:ETH/USDC` and `polygon:POL/USDC`
(both 0.05%, routed through the wrapped native token), and `COINBASE_PRODUCTS` prices
`ETH/USDC` and `POL/USDC` from `ETH-USD` and `POL-USD`. `UNISWAP_SWAP_ROUTERS` and
`UNISWAP_QUOTERS` name SwapRouter02 and QuoterV2 for Base (`0x2626…e481`,
`0x3d4e…B76a`) and Polygon (`0x68b3…Fc45`, `0x61fF…B21e`). `POL` is an `AssetCode`
(18 decimals, payer precision 8), and `isEvmNativeAsset` is the one place that says
ETH and POL are paid with `payEth` and a deposit URI with no token address; the
watcher and the treasury executor already took the native asset from
`CHAIN_NATIVE_ASSETS`. A native payer needs the router's DEX router whitelisted first.

**Payer-only ERC-20s: WETH and cbBTC on Base, WETH and WBTC on Polygon.** They are
`AssetCode`s of their own (`WETH` 18 decimals, `WBTC` and `CBBTC` 8) and
`isTokenizedCrypto` names them. `CHAIN_ASSETS` may list them, because the watcher and
the rails read their addresses from it, but they never join the stablecoin settlement
set: a merchant settles in a stablecoin, and `SETTLEMENT_ASSETS` refuses them. A native
asset is still refused in `CHAIN_ASSETS`. Their on-chain decimals are the domain's, so
`token-units` never scales them. Each is in `REVIEWED_MAINNET_TOKENS` at the address
read back from its chain, and the deposit URI is a token transfer for them.

Prices come from `COINBASE_PRODUCTS` (`WETH/USDC` from `ETH-USD`, `WBTC/USDC` and
`CBBTC/USDC` from `BTC-USD`) and the pools in `UNISWAP_POOLS`: `base:WETH/USDC` and
`base:CBBTC/USDC` and `polygon:WETH/USDC` at 0.05%, `polygon:WBTC/USDC` at 0.3%. The
8-decimal path has not been exercised on chain with value, so send a small amount
before a merchant accepts them. As with native assets, the Coinbase product is the one
reference; a Pyth feed for each would give the deviation guard a second opinion.

### The router configuration still to schedule

Neither router has a DEX router or an input asset yet, so no `payERC20` and no
swap clears on either chain. The settlement asset is already whitelisted by the
constructor. From the multisig, `scheduleBatch` through the timelock, then
`executeBatch` after 48 h:

| Chain     | `DEX_ROUTERS`                                | `INPUT_ASSETS`                        | `SETTLEMENT_ASSETS` |
| --------- | -------------------------------------------- | ------------------------------------- | ------------------- |
| `base`    | `0x2626664c2603336E57B271c5C0b26F421741e481` | Base USDC, USDT, EURC, WETH and cbBTC | Base USDT and EURC  |
| `polygon` | `0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45` | Polygon USDC, USDT, WETH and WBTC     | Polygon USDT        |

Native ETH on Base and native POL on Polygon need only the DEX router: the router
wraps the forwarded value, so neither is an input asset. The payer-only ERC-20s
(WETH, WBTC, cbBTC) are listed as input assets so a payer's swap clears once the 48 h
wait is over; a whitelisted input asset the API does not accept moves nothing.

The constructor whitelisted only USDC as a settlement asset on each chain, so USDT
(both chains) and EURC (Base) are added here as settlement assets, and as input
assets so a payer can bring the same token. Without that, an order whose
`settlementToken` is USDT or EURC reverts `SettlementAssetNotWhitelisted`.

`scripts/ConfigurePaymentRouter.s.sol` prints the transaction to sign and
broadcasts nothing:

```bash
TIMELOCK=<timelock> PAYMENT_ROUTER=<router> DEX_ROUTERS=<routers> \
INPUT_ASSETS=<assets> SETTLEMENT_ASSETS= \
  forge script scripts/ConfigurePaymentRouter.s.sol:ConfigurePaymentRouter \
    --rpc-url $<CHAIN>_RPC_URL --sender <MULTISIG>
```

The `deploy.sh` output names the router in `PAYMENT_ROUTER` and the timelock in
`TIMELOCK`; check the order against the table above, because forge's own summary
labels the two contracts the wrong way round.

## Related

- [Clearing Engine](./clearing-engine.md)
- [Architecture](./architecture.md)
- [Roadmap](./roadmap.md)

[← Documentation index](./README.md)
