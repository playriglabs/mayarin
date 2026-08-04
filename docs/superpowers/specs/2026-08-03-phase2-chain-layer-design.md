# Phase 2A — Chain Layer

> **Historical design record — 2026-08-03.** This documents Phase 2 as shipped.
> The product has since pivoted to crypto-commerce infrastructure with on-chain
> execution (Phase 3, `PaymentRouter.sol`) as the primary path. The deposit-
> matching path described here is the **fallback**; the ledger, stablecoin
> registry, and chain client remain load-bearing. See [Roadmap](../../roadmap.md).

Design record for the first of Phase 2's five subsystems: per-intent deposit
addresses, an EVM wallet watcher, and the confirmation and reorg policy that
decides when a payer's asset counts as received.

Status: design approved, not yet implemented.

---

## Why this is subsystem A of five

`docs/roadmap.md` lists Phase 2 as one block. It is five subsystems with a
dependency order, and building them as one unit would produce a spec too coarse
to review:

| #   | Subsystem                                                                                                   | Depends on         |
| --- | ----------------------------------------------------------------------------------------------------------- | ------------------ |
| A   | **Chain layer** — deposit address derivation, wallet watcher, asset receipt detection, confirmations, reorg | nothing            |
| B   | **Stablecoin assets** — chain-qualified asset registry (USDC on Base is not USDC on Ethereum)               | A                  |
| C   | **Liquidity Router** — real `RateProvider`, price discovery, swap execution, slippage                       | B                  |
| D   | **Settlement Engine** — treasury, stable inventory, settlement balance, rebalancing, deposit sweeps         | ledger (shipped)   |
| E   | **Dashboard** — payment explorer, transaction timeline, settlement status                                   | read-only over A–D |

A is load-bearing: B, C and E all read from it, and it is what makes the POS
crypto checkout flow in `docs/roadmap.md` real. Each subsystem gets its own
spec, plan and implementation cycle.

---

## What A delivers

An intent can name the asset and chain its payer intends to send. From that,
Mayarin derives a deposit address unique to the payment, quotes the exact amount
the payer must send, watches the chain for it, applies a confirmation and reorg
policy, and drives the `PAYMENT_PENDING → ASSET_RECEIVED` transition that
already exists.

The clearing engine gains no new state. `ASSET_RECEIPT_MODE=auto` — Phase 1's
stand-in — is replaced by something that observes reality.

---

## Decisions

Eight decisions shape everything below. Each is recorded with the alternative it
was chosen over, so a later change is a decision rather than a drift.

### 1. Ports in `core`, viem in `providers`

`packages/core/chain` defines ports and holds the confirmation and reorg policy
as pure functions. It imports no chain library and opens no socket.
`packages/providers/evm` implements the ports with viem. This is the same
constraint the rest of the repo runs on, and it is what lets the entire policy
be tested against a scripted fake chain with no network.

### 2. HD derivation from a watch-only xpub

Deposit addresses come from BIP-32/44 at `m/44'/60'/0'/0/<index>`, where
`index` is a monotonic counter allocated once per clearing transaction.

The API holds only the extended **public** key. It derives addresses without
ever being able to spend from them — a bug in the watcher cannot move funds,
because the process has no key to move them with. Signing is a separate concern
with separate custody, and it belongs to D.

Rejected: CREATE2 deposit proxies (needs a deployed factory per chain and gas
per sweep) and a pre-generated address pool (reuse means a late transfer from an
old payer lands on a stranger's intent).

### 3. A is watch-only

No private key, no signing, no gas, anywhere in the subsystem. Sweeping deposits
into treasury needs a hot key, a gas balance, nonce management and a rebalancing
policy — all Settlement Engine concerns. Deferred to D.

Consequence worth stating plainly: after A ships, funds sit at their deposit
addresses. A is correct about _what arrived_; it is D that moves it.

### 4. Accumulate, confirm at ≥ expected

Every confirmed transfer to a watched address is recorded as its own row. The
cumulative confirmed total for an address reaching the expected deposit amount
is what funds the intent. Below it, the intent stays `PAYMENT_PENDING` until its
existing TTL expires.

This is not leniency, it is the common case: an exchange withdrawal often
arrives net of a withdrawal fee, and a payer topping up a short send produces
two transfers. Strict equality would leave a paying customer unfunded.

Excess is recorded as an observed fact and nothing more. Refunding it, and
expiring an underpaid intent, are Phase 3's _Underpayment & Overpayment
Handling_. A must not silently keep an overpayment.

### 5. The payer's asset is a third leg on the intent

Phase 1 models two assets: `sourceAmount` (what the merchant quoted, IDR) and
`settlementAsset` (what the merchant is paid, IDRX). The payer's asset is not
modelled at all — `PRICE_LOCKED` converts the quote straight into the payout.

A deposit address needs an expected amount in the payer's asset on a specific
chain, so the intent gains a third leg. At `PRICE_LOCKED` the engine quotes
twice off the same `sourceAmount`:

```
sourceAmount ──quote→settlement──> settlementAmount, fee, netAmount   (Phase 1, unchanged)
             └─quote→payment─────> deposit.amount                      (new)
```

Both rates are locked in the same step, so neither the payer's quote nor the
merchant's payout can drift mid-payment.

Rejected: deriving the deposit amount from `settlementAmount` at watch time.
That stacks two roundings and lets the figure the payer was shown drift from the
figure that was locked.

When the payer's asset equals the settlement asset the two quotes coincide and
the liquidity router has nothing to convert — the skip `docs/roadmap.md`
describes, falling out of the model rather than being special-cased.

### 6. Confirmation depth is the finality line

A deposit below the configured depth is `PENDING`: recorded, visible, and
touching nothing. It cannot fund an intent and has posted nothing to the ledger,
so a reorg that drops it is a status change and a total that goes back down.

At depth it becomes `CONFIRMED` and only then can it fund.

If a `CONFIRMED` deposit is later orphaned, the watcher records the fact and
flags the payment. It does **not** auto-reverse. By then the merchant payout may
be irreversibly out the door, and posting a compensating entry would create a
negative treasury position with nothing funding it. `SETTLED → unsettled` is
also not a legal transition in a state machine whose entire value is being
forward-only. Recovering an orphaned-after-confirmed deposit is a treasury
decision, and treasury is D.

Rejected: full automatic rollback (above), and ignoring post-depth reorgs
entirely (the one case that costs real money would pass with no record).

### 7. A pure `tick()`, driven by an interval in `apps/api`

`WalletWatcher.tick()` performs one complete pass and returns what it did. The
API runs it on a configured interval and exposes an admin route to force a pass.

Tests call `tick()` directly against the fake chain — no timers, no sleeping, no
flake. This mirrors `ClearingEngine.resumeStuck()`, which `apps/api/src/index.ts`
already calls on boot.

Rejected: a separate `apps/watcher` process (doubles the deploy surface for a
monorepo running one app; revisit at volume) and endpoint-triggered only (a
deployment nobody cron'd would silently never confirm a payment).

### 8. No indexer

An indexer framework such as Ponder declares what it indexes at configuration
time. Per-intent HD addresses are created continuously and derived off-chain, so
neither a static address filter nor a factory pattern that derives children from
an on-chain event covers them. The remaining option — index every `Transfer` on
the token contract and filter in the indexing function — means backfilling
millions of transfers to find the tens of addresses that matter.

An indexer also wants to be the application: its own process, config file, CLI
and database tables with their own reorg bookkeeping. It does not sit behind a
port; it replaces the layer. And the reorg policy above is a business rule, not
infrastructure — it is exactly the part worth owning.

What the watcher actually needs per pass is a handful of RPC calls:
`eth_blockNumber`, one `eth_getLogs` over a cursor-bounded range filtered to the
watched addresses, and `eth_getBlockByNumber` for the reorg probe. Should a case
for an indexer appear later — historical on-chain analytics over fixed contracts
in E — it is another `ChainClient` implementation, not a redesign.

---

## Architecture

```
packages/core/chain              ports, policy, watcher algorithm — pure
packages/providers/evm           viem ChainClient + HD address deriver
packages/providers/mock-chain    scriptable fake chain for tests
packages/db                      Drizzle + in-memory deposit repositories
apps/api                         config, container wiring, interval, admin route
```

`core/chain` does not import `core/clearing`. The watcher speaks to an
`AssetReceiptSink` port; the composition root wires that to
`engine.recordAssetReceived`. The dependency runs one way, and the watcher can
be tested with no clearing engine in the picture at all.

`providers/mock-chain` mirrors `packages/providers/mock`, which is where the
mock settlement adapter already lives. A fake chain is a provider double, not a
repository, so it does not belong in `packages/db`.

### Ports

```ts
export type ChainId = "base" | "base-sepolia";

export interface BlockRef {
  readonly number: bigint;
  readonly hash: string;
}

export interface TransferLog {
  readonly chain: ChainId;
  readonly asset: AssetCode;
  readonly txHash: string;
  readonly logIndex: number;
  readonly blockNumber: bigint;
  readonly blockHash: string;
  readonly from: string;
  readonly to: string;
  /** Raw token amount in the asset's minor units. */
  readonly amount: bigint;
}

export interface TransferQuery {
  readonly chain: ChainId;
  readonly asset: AssetCode;
  readonly fromBlock: bigint;
  readonly toBlock: bigint;
  readonly addresses: readonly string[];
}

export interface ChainClient {
  head(chain: ChainId): Promise<BlockRef>;
  /** `null` when the height is beyond the current head. Drives the reorg probe. */
  blockHash(chain: ChainId, number: bigint): Promise<string | null>;
  transfers(query: TransferQuery): Promise<TransferLog[]>;
}

export interface DepositAddressDeriver {
  derive(index: number): string;
}

export interface AssetReceiptSink {
  fund(clearingTransactionId: string): Promise<void>;
}
```

`DepositAddressDeriver` is a port so that secp256k1 and BIP-32 stay out of
`core`. `providers/evm` implements it with viem's `HDKey`.

### Repository ports

```ts
export interface WatchedAddress {
  readonly clearingTransactionId: string;
  readonly chain: ChainId;
  readonly asset: AssetCode;
  readonly address: string;
  readonly requiredAmount: Money;
  /** False once the clearing transaction is terminal; late transfers are still recorded. */
  readonly fundable: boolean;
}

export interface DepositAddressRepository {
  /** Idempotent: a second call for the same transaction returns the same address. */
  allocate(input: AllocateDepositAddress): Promise<DepositAddress>;
  findByClearingTransactionId(id: string): Promise<DepositAddress | null>;
  /** `retainTerminalSince` keeps recently-terminated payments in the watch set. */
  listWatched(
    chain: ChainId,
    retainTerminalSince: Date,
  ): Promise<WatchedAddress[]>;
}

export interface DepositRepository {
  /** Upsert on `(chain, txHash, logIndex)`. Replaying a log cannot double-count. */
  record(deposits: readonly ObservedTransfer[]): Promise<void>;
  listByAddress(chain: ChainId, address: string): Promise<Deposit[]>;
  listProbable(chain: ChainId, maxConfirmations: number): Promise<Deposit[]>;
  updateStatuses(updates: readonly DepositStatusUpdate[]): Promise<void>;
  confirmedTotal(chain: ChainId, address: string): Promise<Money>;
}

export interface WatcherCursorRepository {
  get(chain: ChainId, asset: AssetCode): Promise<bigint | null>;
  set(chain: ChainId, asset: AssetCode, block: bigint): Promise<void>;
}
```

---

## Data model

Both aggregate changes are optional fields, so every Phase 1 intent and clearing
transaction remains valid and every existing test keeps passing.

### `PaymentIntent`

```ts
/** The rail the payer intends to pay on. Absent for a fiat-only intent. */
readonly payment?: {
  readonly asset: AssetCode;
  readonly chain: ChainId;
};
```

### `ClearingTransaction`

```ts
/** Set at PRICE_LOCKED when the intent names a payment rail. */
readonly deposit?: {
  readonly asset: AssetCode;
  readonly chain: ChainId;
  readonly address: string;
  /** What the payer must send, in the payment asset. */
  readonly amount: Money;
  /** Quote asset → payment asset, frozen at PRICE_LOCKED. */
  readonly rate: LockedRate;
};
```

Grouped rather than flattened into five optional fields: they are set together
or not at all, and the type should say so. Database columns are flat.

### Tables

```
deposit_addresses
  id                          text pk
  clearing_transaction_id     text not null  → clearing_transactions.id
  derivation_index            integer not null
  chain                       text not null
  asset                       text not null
  address                     text not null
  created_at                  timestamptz not null

  unique (clearing_transaction_id)     -- one address per payment
  unique (chain, address)              -- never hand the same address out twice
  unique (derivation_index)            -- the index is the address's identity

chain_deposits
  id                text pk
  chain             text not null
  tx_hash           text not null
  log_index         integer not null
  address           text not null
  asset             text not null
  amount            numeric(78,0) not null
  block_number      numeric(78,0) not null
  block_hash        text not null
  status            text not null            -- PENDING | CONFIRMED | ORPHANED
  first_seen_at     timestamptz not null
  confirmed_at      timestamptz
  orphaned_at       timestamptz

  unique (chain, tx_hash, log_index)   -- the natural idempotency key
  index (chain, address)

watcher_cursors
  chain             text not null
  asset             text not null
  last_block        numeric(78,0) not null
  updated_at        timestamptz not null

  primary key (chain, asset)
```

`derivation_index` comes from a dedicated Postgres sequence. Persisting it is
what makes every address re-derivable from the xpub alone after a restore.

No deposit touches a ledger account. Deposits are observations; the ledger
posting for a funded payment is the existing `assetReceivedPosting`, unchanged.

### Orphaned-after-confirmed is derived, not a flag

A deposit with both `confirmed_at` and `orphaned_at` set is one that was counted
and then reorged away — the case that needs human attention.

It is deliberately _not_ recorded as a `clearing_events` row. That table's
`sequence` equals the transaction's `version`, and both count applied
transitions; appending an event with no transition would break the invariant.
Nor is a `review_required` column added to `clearing_transactions`, because
writing to an aggregate outside its transition mechanism defeats the optimistic
locking the version exists for.

Instead the condition is derived from the two timestamps, surfaced on the
payment DTO as `deposit.reviewRequired`, and published to the domain event bus
as `chain.deposit.orphaned` through the existing `EventPublisher`.

---

## Price lock

`ClearingEngine.#lockPrice` gains a second quote and an address allocation. Both
happen before the state is persisted, which is the engine's existing ordering
rule: side effects first, both idempotent, so a crash in between means the
resumed step repeats a no-op and then records the state.

```
1. quote(source → settlement)   -> settlementAmount, fee, netAmount   [Phase 1]
2. if intent.payment is set:
     quote(source → payment)    -> deposit.amount
     depositAddresses.allocate(transaction.id)  -> address    (idempotent)
3. transition to PRICE_LOCKED with both legs in the patch
```

With no `intent.payment`, step 2 is skipped and the transaction behaves exactly
as it does today.

`StaticRateProvider` serves both quotes in A. Real price discovery is C, through
the same `RateProvider` port — the reason the port was shaped that way.

---

## Watcher

One `tick()` is one pass over one `(chain, asset)` pair. The API iterates the
configured pairs.

```
1. cursor = cursors.get(chain, asset) ?? deployment start block
   head   = client.head(chain)
   from   = cursor + 1
   to     = min(head.number, from + blockRange)
   if from > to: nothing new, return

2. watched = depositAddresses.listWatched(chain, clock.now() - retentionSeconds)
   if watched is empty: advance cursor to `to` and return

3. logs = client.transfers({ chain, asset, from, to, addresses: watched })
   deposits.record(logs)                       -- upsert, status PENDING

4. reclassify:
   for each deposit in deposits.listProbable(chain, depth * reorgWatchWindow):
     confirmations = head.number - deposit.blockNumber + 1
     actual        = client.blockHash(chain, deposit.blockNumber)   -- batched by height

     if actual !== deposit.blockHash          -> ORPHANED
        (if it was CONFIRMED, publish chain.deposit.orphaned)
     else if confirmations >= depth(chain)    -> CONFIRMED

5. fund:
   for each address in watched where fundable:
     if deposits.confirmedTotal(chain, address) >= requiredAmount:
       sink.fund(clearingTransactionId)

6. cursors.set(chain, asset, to)
```

Three properties this ordering buys:

**The cursor is written last.** A crash mid-pass re-scans the range rather than
skipping it, and re-scanning is free because step 3 upserts on
`(chain, txHash, logIndex)`.

**Funding is idempotent without a guard.** `recordAssetReceived` already returns
early when the transaction is not in `PAYMENT_PENDING`, so a second tick over an
already-funded address does nothing.

**Accumulation is not a feature.** Two half-sends, a fee-deducted withdrawal and
an exact payment are all the same code path — rows that sum to a total.

### Bounding the reorg probe

Probing every deposit forever is unbounded work. Step 4 probes only deposits
within `depth × reorgWatchWindow` confirmations of the head (default
`reorgWatchWindow = 2`). Past that window a deposit is treated as final and is
no longer probed.

This is the finality assumption made explicit and bounded, rather than left
implicit. Probes are batched by distinct block height, so N deposits in one
block cost one call.

### The watch set

`listWatched` returns addresses whose clearing transaction is non-terminal
(`fundable: true`) plus those whose transaction went terminal more recently than
`retainTerminalSince` (`fundable: false`).

Retention is measured in time rather than blocks: a terminated transaction has
an `updatedAt`, not a block height, and inventing a block reference for it would
mean writing chain state onto an aggregate that has nothing to do with a chain.

The retention window is what stops a late transfer from vanishing. It is
recorded as a deposit and shows on the payment, but it can never fund a terminal
transaction. Without it, a payer who sends twice would have the second transfer
observed by nothing at all — which is exactly the outcome decision 4 says A must
not produce.

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
DEPOSIT_DERIVATION_PATH=m/44'/60'/0'/0
WATCHER_INTERVAL_MS=15000
WATCHER_BLOCK_RANGE=2000
WATCHER_RETENTION_SECONDS=86400
WATCHER_REORG_WATCH_WINDOW=2
ADMIN_TOKEN=...
```

Validated in `apps/api/src/config.ts` the way `EXCHANGE_RATES` already is: a
deployment with `CHAIN_ENABLED=true` and no xpub, no RPC URL, or a token address
missing for a configured asset fails to boot rather than failing on its first
payment.

`WATCHER_INTERVAL_MS=0` disables the timer, leaving only the admin route.

### Composition root

`apps/api/src/container.ts` gains a nullable `chain` block:

- **Off** — the container is exactly Phase 1's, and `assetReceiptMode` governs
  asset receipt as it does today.
- **On** — `EvmChainClient`, `HdDepositAddressDeriver`, the Drizzle deposit
  repositories and a `WalletWatcher` are constructed, and `assetReceiptMode` is
  required to be `manual`. `auto` alongside a live watcher would fund payments
  nobody paid; the combination is a `ConfigurationError` at boot, not a runtime
  surprise.

`apps/api/src/index.ts` starts the interval after the existing `resumeStuck()`
call, guarded by `WATCHER_INTERVAL_MS > 0`.

---

## API

| Route                      | Change                                                      |
| -------------------------- | ----------------------------------------------------------- |
| `POST /payment-intents`    | optional `payment: { asset, chain }` in the body            |
| `GET /payments/:id`        | response gains a `deposit` block when the intent has a rail |
| `POST /admin/watcher/tick` | forces one pass, returns `{ scanned, recorded, funded }`    |

```jsonc
"deposit": {
  "address": "0x…",
  "chain": "base-sepolia",
  "asset": "USDC",
  "amount":   { "amount": "3210000", "formatted": "3.210000", "display": "3.21 USDC" },
  "received": { "amount": "3210000", "formatted": "3.210000", "display": "3.21 USDC" },
  "confirmations": 4,
  "required": 6,
  "reviewRequired": false,
  "deposits": [
    {
      "txHash": "0x…",
      "amount": { "amount": "3210000", "formatted": "3.210000", "display": "3.21 USDC" },
      "status": "PENDING",
      "confirmations": 4
    }
  ]
}
```

`received` counts `CONFIRMED` deposits only — it is the number the funding rule
uses, so showing anything else would explain a payment incorrectly. `deposits[]`
is the per-transfer record that makes a half-paid payment diagnosable.

Money renders through the existing `MoneyDto` — `amount` to calculate,
`formatted` to parse, `display` to show. No new money formatting anywhere.

The admin route is guarded by an `ADMIN_TOKEN` bearer check and is not
registered at all when the variable is unset, so an unconfigured deployment
returns 404 rather than exposing an unauthenticated trigger.

---

## Errors

No additions to the taxonomy in `packages/shared/src/errors.ts`.

| Condition                                   | Error                | Retryable |
| ------------------------------------------- | -------------------- | --------- |
| RPC unreachable, rate-limited, malformed    | `ProviderError`      | yes       |
| Missing RPC URL, token address, or xpub     | `ConfigurationError` | no        |
| Address allocated concurrently for one tx   | `ConcurrencyError`   | yes       |
| Unsupported `(chain, asset)` pair on intent | `ValidationError`    | no        |

`ProviderError` is already `retryable = true`, so an RPC failure during
`#lockPrice` leaves the transaction in place for `resumeStuck` — the existing
branch in `ClearingEngine.#advance` handles it with no change.

---

## Testing

`packages/providers/mock-chain` is scriptable and fully deterministic:

```ts
chain.mine(3);
chain.transfer({ asset: "USDC", to: address, amount: 3_210_000n });
chain.reorg({ depth: 2 }); // re-mines from a fork point with new hashes
```

Every policy test runs against it. No network, no timers, no `Date.now()` —
`FixedClock` as elsewhere in the repo.

Cases `packages/core/chain` must cover:

- a deposit below depth stays `PENDING` and does not fund
- a deposit reaching depth funds exactly once; a second `tick()` funds nothing
- two half-sends accumulate and fund on the second
- an overpayment funds, and the excess is recorded rather than absorbed
- a reorg below depth marks `ORPHANED`, the confirmed total drops back, nothing
  was ever funded
- a reorg above depth marks `ORPHANED`, sets both timestamps, publishes
  `chain.deposit.orphaned`, and posts nothing to the ledger
- the same log seen twice produces one row
- a crash mid-pass re-scans its range and produces no duplicates
- a transfer arriving after the transaction is terminal is recorded but does not
  fund
- a deposit past the reorg watch window is no longer probed

Cases `packages/core/clearing` must cover:

- an intent with no `payment` leg behaves exactly as it does today
- an intent with a `payment` leg locks both rates and allocates an address
- `allocate` is idempotent across a replayed `PRICE_LOCKED` step

`packages/providers/evm` gets a thin integration test behind `CHAIN_RPC_URLS`,
skipped when the variable is unset — the pattern
`packages/db/test/postgres.test.ts` already uses for `DATABASE_URL`.

`packages/db` gets deposit repository tests under the same guard, plus in-memory
implementations used by everything above.

---

## Out of scope

Each deferral has a named home. None is a loose end.

| Deferred                                                    | Home    |
| ----------------------------------------------------------- | ------- |
| Sweeping deposits into treasury, key custody, gas           | D       |
| Refunding an overpayment, expiring an underpaid intent      | Phase 3 |
| Recovering an orphaned-after-confirmed deposit              | D       |
| Chain-qualified asset registry beyond a minimal map         | B       |
| Real rate discovery — `StaticRateProvider` quotes both legs | C       |
| Native ETH deposits — ERC-20 only in A                      | later   |
| Non-EVM chains (TRON, Solana)                               | Phase 4 |
| Address QR rendering (EIP-681)                              | Phase 3 |

---

## Documentation to update on completion

`docs/` is the design record and is expected to stay in sync with the code:

- `docs/roadmap.md` — mark Phase 2's Blockchain items shipped, remove the
  `ASSET_RECEIPT_MODE` stand-in note
- `docs/clearing-engine.md` — the third asset leg and the two rate locks
- `docs/architecture.md` — the chain packages and where they sit
- a new `docs/chain.md` — deposit addresses, the watcher, confirmation and reorg
  policy
- `CLAUDE.md` — the Phase 1 stand-ins section, now that one of the two is gone

---

## Related

- [Roadmap](../../roadmap.md)
- [Clearing Engine](../../clearing-engine.md)
- [Liquidity & Routing](../../liquidity-routing.md)
- [Settlement](../../settlement.md)
