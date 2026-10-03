[← Documentation index](./README.md)

# Payment Documents & Export

Every payment has an **invoice**, and every completed payment has a **receipt**,
both downloadable as PDFs (#293). The checkout success screen and the dashboard
payment detail each offer the two buttons.

```
GET /v1/payments/:id/invoice.pdf
GET /v1/payments/:id/receipt.pdf    409 until the payment is COMPLETED
```

Both are public by unguessable payment id — the same rule the status read
(`GET /v1/payments/:id`) and the checkout page already follow — and the pay host
forwards them under its existing `GET /v1/payments/*` rule.

## Derived, never stored

A document is built on request by `@mayarin/documents` (pure) and drawn by
`apps/api/src/services/document-pdf.ts` (`pdf-lib`). Every input is already a
snapshot: the intent's `MerchantSnapshot`, its `metadata.cart` lines, the invoice
it was minted from (`metadata.invoiceId`), and the clearing transaction's locked
rate and amounts. So there is no table and no blob store, and a re-render prints
the same document.

| Part           | Source                                                                    |
| -------------- | ------------------------------------------------------------------------- |
| Invoice number | The invoice's own number, else derived from the payment id (`XXXX-XXXX`)  |
| Receipt number | Derived from the clearing transaction id                                  |
| Bill to        | The invoice's buyer, else the payer's address when the rail recorded one  |
| Lines          | Invoice lines, else the cart snapshot, else one line for the whole amount |

A link or cart payment has no invoice series to belong to, which is why its
number is derived rather than allocated: there is no counter to agree with.

## Merchant logo

A merchant that uploaded a logo (dashboard Settings → General, see
[api.md](./api.md#merchant-profile-and-logo)) gets it top-right on both PDFs,
level with the title. It is the one input that is **not** a snapshot: the logo
is read from the merchant at render time, because it is branding, not a term of
the payment. A logo that cannot be fetched within 3 s is left off rather than
failing the document — the invoice is the document, the logo decoration on it.
Only PNG and JPEG are drawn. No logo, no image: the PDF never falls back to
Mayarin's mark.

## The receipt's proof

Where a card receipt prints "Visa - 2778", this one prints what the chain
recorded: the asset and amount the payer sent, the network, the rate, the
settled amount, the fee, what the merchant received, and the transaction hash
(shortened) with a clickable "View on explorer" link. The hash is the
contract-path transaction, else an x402 settlement reference, else the confirmed
deposit on the deposit-match path. A settlement reference that is not a
transaction hash is never printed as one.

The rate is `clearedRate`: derived from the two amounts clearing froze — the
merchant's price and the settlement amount — as `1 HKD = 0.127446 USDG`. It is
not read off `ClearingTransaction.rate`, which on the deposit path can name the
settlement-to-payer leg (`USDG → USDG`) and carries the `RATE_SCALE` factor. A
payment priced in the settlement asset itself prints no rate.

Money is printed in the human form (`formatMoneyLocale`, `en-US`). The standard
Helvetica faces cover Latin-1; a character outside it prints as `?` rather than
failing the render.

## Emails

Every Mayarin email is one card plus a shared footer, both in
`packages/core/documents/src/email.ts`: the logo opens the card, and the footer
(`EMAIL_FOOTER`, plain-text twin `EMAIL_FOOTER_TEXT`) carries X, LinkedIn and
email icons, the tagline and the contact line. Images travel as inline
attachments (`EMAIL_ATTACHMENTS`, referenced by `cid:`), not remote URLs, so a
client that blocks remote images still shows them.

Whose logo opens the card depends on who the email is from:

| Email                                             | Logo                           |
| ------------------------------------------------- | ------------------------------ |
| Invoice, subscription bill (merchant → buyer)     | The merchant's, else Mayarin's |
| Verification code, "You got paid", dispute notice | Mayarin's                      |

`merchantEmailAttachments(logoUrl)` swaps the merchant's logo in behind the same
`cid:`, as a `path` attachment Resend fetches, with the merchant's name as alt
text. The footer stays Mayarin's either way: Mayarin is still who delivered it.

## CSV export

`GET /payments/export.csv` on the dashboard API (#294) streams every payment the
list filters match — same query as `GET /payments` minus `limit` and `cursor`,
same merchant scope. It walks the intents 200 at a time and resolves each page's
clearing transactions in one query.

Amounts are the **machine form** (`toDecimalString`) with the asset in its own
column: the human form would be read as a different number by a spreadsheet in
half the world's locales. Timestamps are ISO-8601 UTC. `rate` is settlement-asset
units per one whole unit of the priced currency (`clearedRate`). A cell a
merchant typed that starts with `=`, `+`, `-` or `@` is prefixed with `'`, so a
spreadsheet reads it as text rather than running it. The file opens with a
byte-order mark so Excel reads it as UTF-8.

Columns: `payment_id, created_at, completed_at, status, merchant_reference,
invoice_id, customer_id, amount, currency, paid_asset, paid_amount, network,
rate, rate_source, settlement_asset, settlement_amount, fee, net_amount,
transaction_hash, failure_reason`.
