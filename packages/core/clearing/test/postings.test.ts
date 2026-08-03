import { describe, expect, test } from "bun:test";
import { LedgerImbalanceError, money } from "@mayarin/shared";
import { internalSettledPosting, postingIdempotencyKey } from "../src/postings.ts";
import type { ClearingTransaction } from "../src/types.ts";

const NOW = new Date("2026-01-01T00:00:00.000Z");

/** A transaction with locked amounts, in IDRX (2 dp): 50,000.00 in, 250.00 fee, 49,750.00 net. */
function pricedTransaction(): ClearingTransaction {
  return {
    id: "clr_01J8Z3K4M5N6P7Q8R9S0T1U2V3",
    paymentIntentId: "pint_01J8Z3K4M5N6P7Q8R9S0T1U2V3",
    state: "SETTLING",
    merchant: { id: "M-1", name: "Warung Kopi", city: "Jakarta", countryCode: "ID" },
    sourceAmount: money(5_000_000n, "IDR"),
    settlementAsset: "IDRX",
    provider: "stablecoin",
    settlementAmount: money(5_000_000n, "IDRX"),
    fee: money(25_000n, "IDRX"),
    netAmount: money(4_975_000n, "IDRX"),
    createdAt: NOW,
    updatedAt: NOW,
    version: 5,
  };
}

describe("internalSettledPosting", () => {
  test("debits settlement in flight and credits merchant holding for the net", () => {
    const posting = internalSettledPosting(pricedTransaction());
    expect(posting.idempotencyKey).toBe(postingIdempotencyKey(pricedTransaction(), "SETTLED"));
    expect(posting.reference).toBe("clr_01J8Z3K4M5N6P7Q8R9S0T1U2V3");
    expect(posting.entries).toEqual([
      {
        accountCode: "SETTLEMENT_IN_FLIGHT:IDRX",
        direction: "DEBIT",
        amount: money(4_975_000n, "IDRX"),
      },
      {
        accountCode: "MERCHANT_HOLDING:IDRX",
        direction: "CREDIT",
        amount: money(4_975_000n, "IDRX"),
      },
    ]);
  });

  test("throws when amounts are not locked", () => {
    const { settlementAmount: _s, fee: _f, netAmount: _n, ...rest } = pricedTransaction();
    void _s;
    void _f;
    void _n;
    expect(() => internalSettledPosting(rest)).toThrow(LedgerImbalanceError);
  });
});
