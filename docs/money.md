[← Documentation index](./README.md)

---

# Money

Every amount is an exact integer count of an asset's minor units. Floating point
never touches a balance.

```ts
type Money = {
  amount: bigint; // minor units
  asset: AssetCode; // IDR, IDRX, USDC, ETH, ...
};

// 50,000.00 IDR
{ amount: 5_000_000n, asset: "IDR" }
```

The asset registry is the single source of truth for decimals, so the same type
holds 2-decimal fiat and 18-decimal ERC-20 balances. On the wire, minor units
travel as a string — JSON has no bigint.

---

## Related

- [Payment Intent](./payment-intent.md)
- [Double Entry Ledger](./ledger.md)

[← Documentation index](./README.md)
