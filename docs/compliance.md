[← Back to the docs index](./README.md)

# Compliance

The audit trail: what Mayarin can prove about a payment, and how it proves it.

Package: `packages/core/compliance`. Adapter: `packages/db`
(`DrizzleAuditQueryRepository`). HTTP: `GET /audit` and `GET /audit/:id` on the
dashboard API.

---

## The position

Mayarin does no KYC. That is a decision, not a gap — the MVP is crypto-only and
the merchant is self-custodial from the moment of payment. But an issuer can
freeze a stablecoin, and an acquirer or a regulator can ask what happened to one
payment. The architecture answers those questions cheaply because every record it
needs is already append-only:

| Source             | Answers                         | Append-only because           |
| ------------------ | ------------------------------- | ----------------------------- |
| `clearing_events`  | how the payment got where it is | the engine only ever appends  |
| ledger postings    | what value moved                | a correction is a new posting |
| chain deposits     | what the payer actually sent    | a log is a fact about a block |
| `PaymentCompleted` | what the merchant actually got  | the same                      |

So the compliance layer **writes nothing**. It is a read that joins four records
that already exist. There is no compliance table, and therefore no second copy of
the truth that can drift from the first.

---

## The record

`ComplianceService.record(merchantId, clearingTransactionId)` returns everything
recorded about one payment: the intent, the clearing transaction, the full state
history, every ledger posting, every deposit seen at the payment's address, and
the `PaymentCompleted` log if the payment took the contract path.

Unconfirmed and orphaned deposits are included. An audit that shows only what
succeeded cannot explain why a payment did not.

### Reconciliation

Assembling both records proves nothing on its own — two records can sit side by
side and disagree. `reconcile` is the check that turns the record into evidence:

```
ledger   credits to MERCHANT_PAYABLE  ==  PaymentCompleted.settledAmount
         credits to FEE_REVENUE       ==  PaymentCompleted.fee
```

Credits only. `MERCHANT_PAYABLE` is credited when the merchant's claim arises and
debited again when it goes to a rail, so a net balance reads zero for a settled
payment — correct bookkeeping, wrong number for this question.

The verdict is a tagged union with three cases, and the third one matters:

- `MATCHED` — checked, and they agree.
- `MISMATCHED` — checked, and here are the figures that differ.
- `NO_ON_CHAIN_RECORD` — **nobody checked.** No confirmed `PaymentCompleted` log
  exists: the deposit path, or the indexer has not reached it yet.

A settlement below the confirmation depth counts as no record, the same finality
line the indexer draws before it completes a payment. Collapsing "not checked"
into "fine" is how an unverified payment later reads as a verified one.

---

## Scope

Every audit read is scoped to one merchant, and there is no "all merchants"
value. `AuditFilter.merchantId` is required; `record` takes a merchant id and
raises `NotFoundError` for another tenant's payment — the same error an absent id
raises, so a response cannot be used to probe whether a payment exists elsewhere.

The rule lives in the domain service, not at the HTTP edge, so a future caller
cannot reach an unscoped read. The route takes the merchant from the verified
session, so a caller cannot name one.

`asset` filters on the **settlement** asset, what the merchant was paid in. The
payer's asset is a property of one leg and is carried inside the record. A filter
that means two different things depending on the leg makes a compliance answer
unreliable.

Time windows are `[from, to)` — inclusive lower bound, exclusive upper — so two
adjacent windows cover every payment exactly once.

---

## Screening (didit)

`ScreeningProvider` is a port with one implementation, `disabledScreening`, and
**nothing in the payment flow calls it.** That is the intended shape while KYC is
a Non-Goal. Adding a vendor later is one adapter in `packages/providers` plus a
line in the composition root, not a new concept threaded through clearing.

`disabledScreening` returns `NOT_SCREENED`, never `CLEAR`, for the same reason
`NO_ON_CHAIN_RECORD` exists: "nobody looked" is a different fact from "somebody
looked and found nothing".

---

## What this does not do

- **No freeze handling.** An issuer freezing a settlement asset is a real event
  with no path through this layer yet.
- **No export format.** The record is JSON shaped for a dashboard, not a
  regulator's schema.
- **No retention policy.** Nothing expires, which is currently the right default
  and is not the same as having decided one.

See [RFC #16](https://github.com/playriglabs/mayarr/issues/16) and
[Threat Model](./threat-model.md).
