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

| Account                        | Type      | Holds                                                |
| ------------------------------ | --------- | ---------------------------------------------------- |
| `TREASURY:<asset>`             | Asset     | Settlement assets Mayarin holds                      |
| `MERCHANT_PAYABLE:<asset>`     | Liability | Cleared value owed to merchants                      |
| `SETTLEMENT_IN_FLIGHT:<asset>` | Liability | Value handed to a rail, awaiting confirmation        |
| `MERCHANT_HOLDING:<asset>`     | Liability | Stablecoin balances credited to merchants (Phase 2D) |
| `FEE_REVENUE:<asset>`          | Revenue   | Clearing fees retained by Mayarin                    |

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

---

## Related

- [Clearing Engine](./clearing-engine.md)
- [Money](./money.md)

[← Documentation index](./README.md)
