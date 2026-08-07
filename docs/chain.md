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
> waits for `recordPaymentCompleted`; the indexer that calls it (#8) and the
> deployed contract (#29) are what remain.

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
`settlementAsset` (what the merchant is paid, IDRX). The payer's asset was not
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

**The cursor is written last.** A crash mid-pass re-scans the range rather than
skipping it, and re-scanning is free because recording upserts on
`(chain, txHash, logIndex)`. **Funding is idempotent without a guard:**
`recordAssetReceived` already returns early when the transaction is not in
`PAYMENT_PENDING`, so a second tick over an already-funded address does nothing.

There is deliberately no indexer **on this path**. (The contract path is the
opposite case — a single known address emitting `PaymentCompleted`, which is
exactly what an indexer is for; see #8.) Per-intent HD addresses are created
continuously and derived off-chain, so neither a static address filter nor a
factory pattern covers them, and indexing every `Transfer` on a token contract
means backfilling millions to find the tens that matter. What the watcher
actually needs per pass is a handful of RPC calls — `eth_blockNumber`, one
cursor-bounded `eth_getLogs`, and `eth_getBlockByNumber` for the reorg probe.
Should a case for an indexer appear later, it is another `ChainClient`
implementation, not a redesign.

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

---

## Related

- [Clearing Engine](./clearing-engine.md)
- [Architecture](./architecture.md)
- [Roadmap](./roadmap.md)

[← Documentation index](./README.md)
