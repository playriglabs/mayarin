[← Documentation index](./README.md)

---

# QR Parser

Responsible for decoding payment payloads.

Supported formats:

- QRIS
- EMVCo
- Future QR Standards

Decoding is split in two: an EMVCo TLV decoder that knows only the encoding, and
a scheme profile that gives tags their meaning. A new QR standard is a new
profile, not a fork of the decoder. Checksums are verified before anything else
is read.

Example

```ts
{
  scheme: "QRIS",
  isStatic: false,
  merchantName: "Warung Kopi Mayarin",
  merchantId: "ID1020017611473",
  merchantCity: "Jakarta",
  countryCode: "ID",
  currency: "IDR",
  amount: { amount: 5_000_000n, asset: "IDR" },
  merchantAccounts: [...],
  additionalData: { referenceLabel: "INV-001" },
  raw: "00020101021226..."
}
```

---

## Related

- [Payment Intent](./payment-intent.md)
- [REST API](./api.md)

[← Documentation index](./README.md)
