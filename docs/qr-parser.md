[← Documentation index](./README.md)

---

# QR Parser

Responsible for decoding payment payloads.

Supported formats:

- QRIS
- EMVCo
- Crypto address URIs _(Phase 3)_
- Future QR Standards

Decoding is split in two: an EMVCo TLV decoder that knows only the encoding, and
a scheme profile that gives tags their meaning. A new QR standard is a new
profile, not a fork of the decoder. Checksums are verified before anything else
is read.

Decoding only, for now. Phase 3's QR SDK adds the other direction — EMVCo and
QRIS _generation_, static and dynamic — reusing the same profiles, so a tag is
described once and both read and written from that description.

## Two payload families

A crypto address QR is not another EMVCo profile. EMVCo is TLV with a CRC; an
address URI is `ethereum:0x…@1/transfer?address=…&uint256=…` (EIP-681) or its
BIP-21 equivalent. They share no encoding, and a scanner speaks one or the other
— an exchange app has never heard of QRIS, and a QRIS app has never heard of a
chain id.

What they share is the far side. Both decode into a normalized shape a
`PaymentIntent` is built from, so nothing downstream of the parser has to know
which family a payment arrived on. Phase 3 adds address-URI encoding for POS
crypto checkout, where Mayarin writes the QR rather than reads it.

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
