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

// Rp 50.000,00
{ amount: 5_000_000n, asset: "IDR" }
```

The asset registry is the single source of truth for decimals, so the same type
holds 2-decimal fiat and 18-decimal ERC-20 balances. On the wire, minor units
travel as a string — JSON has no bigint.

---

## Rendering

An amount has a machine form and a human form, and they are not the same string.

`toDecimalString` produces the machine form: ungrouped, always dot-separated,
and parseable back to the exact same minor units. `formatMoneyLocale` produces
the human form, following the market's own conventions.

That distinction matters most in Indonesia, where `.` groups thousands and `,`
marks the decimal — the reverse of the machine form:

```ts
const amount = money(5_043_200n, "IDR");

toDecimalString(amount); // "50432.00"
formatMoneyLocale(amount); // "Rp 50.432,00"
formatMoneyLocale(amount, { trimZeroFraction: true }); // "Rp 50.432"
formatMoneyLocale(amount, { locale: "en-US" }); // "Rp 50,432.00"

parseMoneyLocale("Rp 50.432", "IDR"); // { amount: 5_043_200n, asset: "IDR" }
```

`Rp 50.432` is fifty thousand four hundred thirty-two rupiah, not fifty rupiah
and change. Reading it any other way is a factor-of-a-thousand error, which is
why `parseMoneyLocale` requires a group separator to actually group: `"50.43"`
is rejected rather than guessed at.

Formatting runs on the digit string, never on a `number`. An 18-decimal ERC-20
balance would not survive `Intl.NumberFormat`, and a rounded balance is a wrong
balance.

An asset with a conventional symbol is prefixed with it; one without is suffixed
with its code:

```ts
formatMoneyLocale(money(5_043_200n, "IDR")); // "Rp 50.432,00"
formatMoneyLocale(money(5_043_200n, "IDRX")); // "50.432,00 IDRX"
```

---

## Related

- [Payment Intent](./payment-intent.md)
- [Double Entry Ledger](./ledger.md)

[← Documentation index](./README.md)
