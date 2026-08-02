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

| Account                        | Type      | Holds                                         |
| ------------------------------ | --------- | --------------------------------------------- |
| `TREASURY:<asset>`             | Asset     | Settlement assets Mayarr holds                |
| `MERCHANT_PAYABLE:<asset>`     | Liability | Cleared value owed to merchants               |
| `SETTLEMENT_IN_FLIGHT:<asset>` | Liability | Value handed to a rail, awaiting confirmation |
| `FEE_REVENUE:<asset>`          | Revenue   | Clearing fees retained by Mayarr              |

Three postings describe a payment end to end:

```
ASSET_RECEIVED   Dr TREASURY               settlement amount
                 Cr MERCHANT_PAYABLE       net
                 Cr FEE_REVENUE            fee

CLEARING         Dr MERCHANT_PAYABLE       net
                 Cr SETTLEMENT_IN_FLIGHT   net

SETTLED          Dr SETTLEMENT_IN_FLIGHT   net
                 Cr TREASURY               net
```

Net effect: treasury keeps the fee, the merchant's claim is extinguished only
once the rail confirms delivery, and value in flight is visible at all times.

---

## Related

- [Clearing Engine](./clearing-engine.md)
- [Money](./money.md)

[← Documentation index](./README.md)
