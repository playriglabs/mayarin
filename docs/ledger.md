[← Documentation index](./README.md)

---

# Double Entry Ledger

Every balance movement is recorded.

Nothing mutates balances directly. The ledger is append-only: a correction is a
new transaction that reverses the original, never an edit. Balances are always
summed from entries, never read from a cached column.

A posting is valid only if, for every asset it touches, debits equal credits.
Cross-asset postings are allowed; each asset must balance on its own.

Chart of accounts — created on demand per asset, so a new settlement asset needs
no migration:

| Account                          | Type      | Holds                                                |
| -------------------------------- | --------- | ---------------------------------------------------- |
| `TREASURY:<asset>`               | Asset     | Settlement assets Mayarin holds                      |
| `MERCHANT_PAYABLE:<asset>`       | Liability | Cleared value owed to merchants                      |
| `SETTLEMENT_IN_FLIGHT:<asset>`   | Liability | Value handed to a rail, awaiting confirmation        |
| `MERCHANT_HOLDING:<asset>`       | Liability | Stablecoin balances credited to merchants (Phase 2D) |
| `FEE_REVENUE:<asset>`            | Revenue   | Clearing fees retained by Mayarin                    |
| `PAYER_ASSET_HELD:<asset>`       | Asset     | Payer asset received, not yet converted              |
| `PAYER_ASSET_OBLIGATION:<asset>` | Liability | Payer assets held against an unconverted payment     |
| `FX_RESULT:<asset>`              | Revenue   | Locked price vs the swap achieved; debit is a loss   |
| `GAS_EXPENSE:<asset>`            | Expense   | Network fees Mayarin pays on a payer's behalf        |
| `OPERATOR_GAS:<asset>`           | Asset     | Native balance the executor spends gas from          |
| `PAYER_SURPLUS:<asset>`          | Liability | Change an exact-output swap did not spend, owed back |

`PAYER_SURPLUS` exists because of the cross-asset x402 path. `exact` gives the
payer one signature and no way to top it up, so the amount they sign is the
exact-output quote plus a slippage bound, and that bound is also the ceiling the
swap may consume. Whatever it does not consume is theirs. Above the asset's
`dustThreshold` it is credited here, a liability owed back to the address that
signed; below it, returning the change would cost more than the change — an
ERC-20 transfer the operator pays gas for and a liability row somebody
reconciles — so it goes to `FEE_REVENUE` and the receipt event says so. Neither
case absorbs it into a balance nothing explains, which is the property; the
threshold only decides which account carries it. See
[Agent Payments](./x402.md#cross-asset-the-agent-pays-with-what-it-holds).

Three postings describe a payment end to end. The first two are the same for
every settlement; the SETTLED posting depends on whether the rail takes value
_out_ of Mayarin (`external`) or keeps it _in_ as a merchant balance (`internal`):

```
ASSET_RECEIVED   Dr TREASURY               settlement amount
                 Cr MERCHANT_PAYABLE       net
                 Cr FEE_REVENUE            fee

CLEARING         Dr MERCHANT_PAYABLE       net
                 Cr SETTLEMENT_IN_FLIGHT   net

SETTLED (external)   Dr SETTLEMENT_IN_FLIGHT   net
                     Cr TREASURY               net

SETTLED (internal)   Dr SETTLEMENT_IN_FLIGHT   net
                     Cr MERCHANT_HOLDING       net
```

Net effect: treasury keeps the fee, the merchant's claim is extinguished only
once the rail confirms delivery, and value in flight is visible at all times.
An external settlement returns the net to treasury (the rail paid the merchant
outside Mayarin); an internal settlement credits the net to a merchant holding
liability the merchant can withdraw on-chain, so treasury retains the full
settlement amount.

### Derived from on-chain _(Phase 3)_

The postings above are the shipped off-chain path. Once `PaymentRouter.sol`
executes on-chain, the ledger becomes a **derived view** of on-chain truth: an
indexer consumes `PaymentCompleted` events and posts the entries, keyed
idempotently by `(chain, txHash, logIndex)`. The double-entry invariant is
unchanged; what changes is the source — the chain is truth, the ledger is a
derived, reconciled projection. Divergence (missed event, reorg, indexing lag,
under/over payment) is detected and surfaced, not silently absorbed.

**Two events, two kinds of refund.** `PaymentCompleted` is the settlement
signal and is what advances a payment — the indexer keys off it alone. But it
does not describe everything the payer got back. Its `refundAmount` is the
excess **in the settlement asset**, the `output − minOut` left over after the
merchant and treasury are paid. The contract also emits

```solidity
event ResidueRefunded(
  bytes32 indexed intentId, address indexed asset, address indexed to, uint256 amount
);
```

when a route partially fills (unconsumed input returned to `refundTo`) or an
exact-output native route hands back the unspent remainder — **in whatever
asset arrived**, which is usually not the settlement asset, and `address(0)`
for native. Reconciling settlement needs only `PaymentCompleted`; a complete
picture of what the payer received back needs both, and the two cannot be
summed because they are denominated differently.

---

## The deposit path books receipt and swap separately

The three postings above assume the settlement asset is acquired at the moment
the payer's asset is confirmed. That holds on the contract path, where receive,
swap and settle are one atomic transaction.

On the deposit path they are seconds apart. The payer's ETH sits at a deposit
address until the treasury executor converts it, and booking `TREASURY` at
receipt would state a settlement balance that does not exist while the asset
actually held is recorded nowhere. So the deposit path splits the receipt:

```
ASSET_RECEIVED   Dr PAYER_ASSET_HELD:ETH        deposit amount
                 Cr PAYER_ASSET_OBLIGATION:ETH  deposit amount

SWAPPED          Dr PAYER_ASSET_OBLIGATION:ETH  deposit amount
                 Cr PAYER_ASSET_HELD:ETH        deposit amount
                 Dr TREASURY:USDC               swap output, measured on-chain
                 Cr MERCHANT_PAYABLE:USDC       net
                 Cr FEE_REVENUE:USDC            fee
                 Cr FX_RESULT:USDC              output − settlement, when the swap beat the lock

GAS              Dr GAS_EXPENSE:ETH             gas the operator paid
                 Cr OPERATOR_GAS:ETH            gas the operator paid
```

`CLEARING` and `SETTLED` are unchanged — `MERCHANT_PAYABLE` is credited by the
swap instead of the receipt, one step later.

**The split is conditional on the lock, not on the process.** The two postings
are a pair: the receipt stops crediting `MERCHANT_PAYABLE` and the swap starts.
A payment splits when its lock signed an order, which the lock does only in a
deployment with an executor. A lock that signed nothing keeps the original
posting, where settlement genuinely is acquired at receipt; splitting without
converting would leave `CLEARING` debiting a payable nothing had credited. The
persisted order, not the wiring of the process that advances the payment, makes
the decision — two differently wired processes on one database must agree on
the scheme, and a process with no executor parks an order-carrying payment for
one that has an executor (#104).

**The merchant's net and the fee are always the locked figures.** A swap that
underperformed debits `FX_RESULT` rather than paying the merchant less; one that
beat the lock credits it. One account whose sign carries the direction, rather
than two that must be netted to find out which way the exposure went. This is
the exposure `threat-model.md` depends on being visible — absorbing it into
treasury is what made it invisible.

**What "balanced" means here needed no new rule.** `assertBalanced` already sums
debits and credits per asset, so the requirement is not that ETH equal USDC —
no rate could make that true at the instant a rate is what is being discovered.
It is that each asset balance within itself: the payer-asset legs cancel
exactly, and the settlement-asset legs sum to what the swap actually delivered.

**A failed swap leaves the position visible.** If execution cannot meet `minOut`
within its attempt bound, nothing is booked: the payer's asset stays in
`PAYER_ASSET_HELD`, denominated in what is actually held, against an obligation
that has not been discharged. Before these accounts existed, the same failure
recorded a settlement balance that never existed.

---

## Related

- [Clearing Engine](./clearing-engine.md)
- [Money](./money.md)

[← Documentation index](./README.md)
