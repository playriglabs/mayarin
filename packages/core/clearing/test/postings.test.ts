import { describe, expect, test } from "bun:test";
import { assertBalanced, type DraftEntry } from "@mayarin/ledger";
import { LedgerImbalanceError, money } from "@mayarin/shared";
import {
  depositAssetReceivedPosting,
  gasPosting,
  internalSettledPosting,
  postingIdempotencyKey,
  swapPosting,
} from "../src/postings.ts";
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

// ---------------------------------------------------------------------------
// The deposit path: receipt and swap are separate postings, in different assets.
// ---------------------------------------------------------------------------

/**
 * A deposit-path transaction settling in USDC (6 dp) against an ETH deposit
 * (18 dp): 3.00 USDC locked, 0.01 fee, 2.99 net, 0.00105 ETH expected in.
 */
function depositTransaction(): ClearingTransaction {
  return {
    ...pricedTransaction(),
    settlementAsset: "USDC",
    settlementAmount: money(3_000_000n, "USDC"),
    fee: money(10_000n, "USDC"),
    netAmount: money(2_990_000n, "USDC"),
    executionPath: "deposit-match",
    deposit: {
      asset: "ETH",
      chain: "base-sepolia",
      address: "0x9ec7b9ccbd9feb765eb0da23c166f5006a0b2343",
      amount: money(1_050_000_000_000_000n, "ETH"),
      rate: {
        from: "IDR",
        to: "ETH",
        minorUnitsPerWholeUnit: 2_857_142_857n,
        source: "test",
        lockedAt: NOW,
      },
    },
  };
}

/** Sums debits and credits per asset, the way `assertBalanced` does. */
function balanceByAsset(posting: { entries: readonly DraftEntry[] }) {
  const totals = new Map<string, { debits: bigint; credits: bigint }>();
  for (const entry of posting.entries) {
    const asset = entry.amount.asset;
    const current = totals.get(asset) ?? { debits: 0n, credits: 0n };
    if (entry.direction === "DEBIT") current.debits += entry.amount.amount;
    else current.credits += entry.amount.amount;
    totals.set(asset, current);
  }
  return totals;
}

describe("depositAssetReceivedPosting", () => {
  test("books the asset actually held, and touches no settlement account", () => {
    const posting = depositAssetReceivedPosting(depositTransaction());

    expect(posting.entries).toEqual([
      {
        accountCode: "PAYER_ASSET_HELD:ETH",
        direction: "DEBIT",
        amount: money(1_050_000_000_000_000n, "ETH"),
      },
      {
        accountCode: "PAYER_ASSET_OBLIGATION:ETH",
        direction: "CREDIT",
        amount: money(1_050_000_000_000_000n, "ETH"),
      },
    ]);
    // The correction this posting exists for: no USDC is claimed before a swap.
    expect(posting.entries.some((e) => e.amount.asset === "USDC")).toBe(false);
  });

  test("shares the ASSET_RECEIVED key, so it cannot double-post with the contract path's", () => {
    expect(depositAssetReceivedPosting(depositTransaction()).idempotencyKey).toBe(
      postingIdempotencyKey(depositTransaction(), "ASSET_RECEIVED"),
    );
  });

  test("throws for a transaction with no deposit leg", () => {
    expect(() => depositAssetReceivedPosting(pricedTransaction())).toThrow(LedgerImbalanceError);
  });
});

describe("swapPosting", () => {
  test("a swap that beat the lock credits the difference to FX_RESULT", () => {
    const posting = swapPosting(depositTransaction(), money(3_080_000n, "USDC"));
    const totals = balanceByAsset(posting);

    // Each asset balances within itself — no rate is asserted between them.
    expect(totals.get("ETH")).toEqual({
      debits: 1_050_000_000_000_000n,
      credits: 1_050_000_000_000_000n,
    });
    expect(totals.get("USDC")).toEqual({ debits: 3_080_000n, credits: 3_080_000n });

    const fx = posting.entries.find((e) => e.accountCode === "FX_RESULT:USDC");
    expect(fx).toEqual({
      accountCode: "FX_RESULT:USDC",
      direction: "CREDIT",
      amount: money(80_000n, "USDC"),
    });
  });

  test("a swap that fell short debits FX_RESULT and still pays the merchant the locked net", () => {
    const posting = swapPosting(depositTransaction(), money(2_950_000n, "USDC"));
    const totals = balanceByAsset(posting);

    expect(totals.get("USDC")).toEqual({ debits: 3_000_000n, credits: 3_000_000n });

    expect(posting.entries).toContainEqual({
      accountCode: "FX_RESULT:USDC",
      direction: "DEBIT",
      amount: money(50_000n, "USDC"),
    });
    // The loss is Mayarin's; what the merchant is owed does not move.
    expect(posting.entries).toContainEqual({
      accountCode: "MERCHANT_PAYABLE:USDC",
      direction: "CREDIT",
      amount: money(2_990_000n, "USDC"),
    });
  });

  test("an exact fill posts no FX entry at all", () => {
    const posting = swapPosting(depositTransaction(), money(3_000_000n, "USDC"));

    expect(posting.entries.some((e) => e.accountCode.startsWith("FX_RESULT"))).toBe(false);
    expect(balanceByAsset(posting).get("USDC")).toEqual({
      debits: 3_000_000n,
      credits: 3_000_000n,
    });
  });

  test("discharges the payer-asset legs exactly, leaving no held balance", () => {
    const posting = swapPosting(depositTransaction(), money(3_080_000n, "USDC"));

    expect(posting.entries).toContainEqual({
      accountCode: "PAYER_ASSET_OBLIGATION:ETH",
      direction: "DEBIT",
      amount: money(1_050_000_000_000_000n, "ETH"),
    });
    expect(posting.entries).toContainEqual({
      accountCode: "PAYER_ASSET_HELD:ETH",
      direction: "CREDIT",
      amount: money(1_050_000_000_000_000n, "ETH"),
    });
  });

  test("refuses an output denominated in something other than the settlement asset", () => {
    expect(() => swapPosting(depositTransaction(), money(3_000_000n, "IDRX"))).toThrow(
      LedgerImbalanceError,
    );
  });
});

describe("gasPosting", () => {
  test("books Mayarin's own cost, in the native asset, against the operator balance", () => {
    const posting = gasPosting(depositTransaction(), money(594_366_000_000n, "ETH"));

    expect(posting.idempotencyKey).toBe(postingIdempotencyKey(depositTransaction(), "GAS"));
    expect(posting.entries).toEqual([
      {
        accountCode: "GAS_EXPENSE:ETH",
        direction: "DEBIT",
        amount: money(594_366_000_000n, "ETH"),
      },
      {
        accountCode: "OPERATOR_GAS:ETH",
        direction: "CREDIT",
        amount: money(594_366_000_000n, "ETH"),
      },
    ]);
  });
});

describe("the real imbalance guard accepts the cross-asset posting", () => {
  // The point of the design: no new rule was needed. `assertBalanced` already
  // sums per asset, so a posting naming two assets passes when each side
  // balances within itself.
  test.each([
    ["a gain", 3_080_000n],
    ["a loss", 2_950_000n],
    ["an exact fill", 3_000_000n],
  ])("%s balances under assertBalanced", (_label, output) => {
    expect(() =>
      assertBalanced(swapPosting(depositTransaction(), money(output, "USDC")).entries),
    ).not.toThrow();
  });

  test("receipt and gas postings balance too", () => {
    expect(() =>
      assertBalanced(depositAssetReceivedPosting(depositTransaction()).entries),
    ).not.toThrow();
    expect(() =>
      assertBalanced(gasPosting(depositTransaction(), money(594_366_000_000n, "ETH")).entries),
    ).not.toThrow();
  });
});
