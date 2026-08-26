[← Documentation index](./README.md)

---

# Money

Every amount is an exact integer count of an asset's minor units. Floating point
never touches a balance.

```ts
type Money = {
  amount: bigint; // minor units
  asset: AssetCode; // IDR, USD, USDC, ETH, ...
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
formatMoneyLocale(money(50_432_000_000n, "USDC")); // "50.432,000000 USDC"
```

## Payer precision

An asset's `decimals` is what it can represent. `payerDecimals` is what a person
is ever asked for, and for ETH the two are eighteen and eight.

The gap is not cosmetic. Converting $12.50 at a live rate gives
`0.004166666666666663 ETH` — a figure no one types correctly and a good many
wallets refuse outright, since their manual-entry fields stop at eight decimals.
A payer who enters it short has underpaid, and an underpaid deposit never funds:
the watcher waits for the confirmed total to **reach** what is owed.

So an amount asked of a payer is rounded **up** to `payerDecimals` where it is
decided — at price lock, and in the indicative quote that previews it — not
where it is displayed:

```ts
roundUpToPayerPrecision(money(4_166_666_666_666_663n, "ETH"));
// 4_166_670_000_000_000n — "0,00416667 ETH"
```

Up, never down, because the direction is the safety property: rounding down
produces a figure a payer can enter in full and still fall short. The dust given
up is under `1e-8` ETH, far below the fee of the transfer carrying it.

Because the rounding happens at the source, the QR, the screen and the field the
payer types into all carry **one** number. A value rounded for display alone
would disagree with the one in the code, which is the same class of bug as
rendering money through a float.

`trimTrailingZeros` then drops zeros past two decimals for display —
`12,50 USDC` rather than `12,500000 USDC`. That is lossless: it removes zeros
and nothing else, and the exact value stays in `amount`.

---

## Related

- [Payment Intent](./payment-intent.md)
- [Double Entry Ledger](./ledger.md)

[← Documentation index](./README.md)
