import { describe, expect, test } from "bun:test";
import { LedgerImbalanceError, money, ValidationError } from "@mayarin/shared";
import {
  ACCOUNT_KIND_LIST,
  ACCOUNT_KINDS,
  accountCode,
  accountName,
  parseAccountCode,
} from "../src/accounts.ts";
import { computeBalance } from "../src/balance.ts";
import { assertBalanced, buildTransaction, totalsByAsset } from "../src/transaction.ts";
import type { DraftEntry, LedgerAccount } from "../src/types.ts";
import { normalBalanceOf } from "../src/types.ts";

const NOW = new Date("2026-01-01T00:00:00.000Z");

function account(code: string, type: LedgerAccount["type"], id: string): LedgerAccount {
  const asset = parseAccountCode(code).asset;
  return { id, code, name: code, type, asset, createdAt: NOW };
}

const TREASURY = account("TREASURY:USDC", "ASSET", "lacc_treasury");
const PAYABLE = account("MERCHANT_PAYABLE:USDC", "LIABILITY", "lacc_payable");
const FEES = account("FEE_REVENUE:USDC", "REVENUE", "lacc_fees");

const ACCOUNTS = new Map([
  [TREASURY.code, TREASURY],
  [PAYABLE.code, PAYABLE],
  [FEES.code, FEES],
]);

function draftEntry(
  code: string,
  direction: DraftEntry["direction"],
  minorUnits: bigint,
): DraftEntry {
  return { accountCode: code, direction, amount: money(minorUnits, "USDC") };
}

/** 5.000000 USDC received, split into a 0.025000 fee and 4.975000 payable. */
const RECEIPT_ENTRIES: DraftEntry[] = [
  draftEntry(TREASURY.code, "DEBIT", 5_000_000n),
  draftEntry(PAYABLE.code, "CREDIT", 4_975_000n),
  draftEntry(FEES.code, "CREDIT", 25_000n),
];

describe("accountCode", () => {
  test("round-trips through parseAccountCode", () => {
    const code = accountCode("TREASURY", "USDC");
    expect(code).toBe("TREASURY:USDC");
    expect(parseAccountCode(code)).toMatchObject({ kind: "TREASURY", asset: "USDC" });
  });

  test("rejects unknown kinds and assets", () => {
    expect(() => parseAccountCode("NOPE:USDC")).toThrow(/account kind/);
    expect(() => parseAccountCode("TREASURY:XYZ")).toThrow(/asset/);
  });
});

describe("MERCHANT_HOLDING account kind", () => {
  test("is declared as a liability", () => {
    expect(ACCOUNT_KINDS.MERCHANT_HOLDING.type).toBe("LIABILITY");
    expect(ACCOUNT_KIND_LIST).toContain("MERCHANT_HOLDING");
  });

  test("round-trips through parseAccountCode", () => {
    const parsed = parseAccountCode("MERCHANT_HOLDING:USDC");
    expect(parsed.kind).toBe("MERCHANT_HOLDING");
    expect(parsed.asset).toBe("USDC");
    expect(parsed.definition.type).toBe("LIABILITY");
  });

  test("accountName includes the asset", () => {
    expect(accountName("MERCHANT_HOLDING", "USDC")).toBe("Merchant holding (USDC)");
  });
});

describe("assertBalanced", () => {
  test("accepts a balanced multi-entry posting", () => {
    expect(() => assertBalanced(RECEIPT_ENTRIES)).not.toThrow();
  });

  test("rejects an unbalanced posting", () => {
    const unbalanced = [
      draftEntry(TREASURY.code, "DEBIT", 5_000_000n),
      draftEntry(PAYABLE.code, "CREDIT", 4_975_000n),
    ];
    expect(() => assertBalanced(unbalanced)).toThrow(LedgerImbalanceError);
  });

  test("rejects a single-sided posting", () => {
    expect(() => assertBalanced([draftEntry(TREASURY.code, "DEBIT", 1n)])).toThrow(
      LedgerImbalanceError,
    );
  });

  test("rejects negative or zero amounts", () => {
    const negative = [
      draftEntry(TREASURY.code, "DEBIT", -1n),
      draftEntry(PAYABLE.code, "CREDIT", -1n),
    ];
    expect(() => assertBalanced(negative)).toThrow(ValidationError);
  });

  test("requires every asset to balance on its own", () => {
    const crossAsset: DraftEntry[] = [
      { accountCode: "TREASURY:USDC", direction: "DEBIT", amount: money(100n, "USDC") },
      { accountCode: "MERCHANT_PAYABLE:USDC", direction: "CREDIT", amount: money(100n, "USDC") },
      { accountCode: "TREASURY:USDT", direction: "DEBIT", amount: money(50n, "USDT") },
    ];
    expect(() => assertBalanced(crossAsset)).toThrow(/does not balance in USDT/);
  });

  test("accepts a cross-asset posting where each asset balances", () => {
    const crossAsset: DraftEntry[] = [
      { accountCode: "TREASURY:USDC", direction: "DEBIT", amount: money(100n, "USDC") },
      { accountCode: "MERCHANT_PAYABLE:USDC", direction: "CREDIT", amount: money(100n, "USDC") },
      { accountCode: "TREASURY:USDT", direction: "DEBIT", amount: money(50n, "USDT") },
      { accountCode: "MERCHANT_PAYABLE:USDT", direction: "CREDIT", amount: money(50n, "USDT") },
    ];
    expect(() => assertBalanced(crossAsset)).not.toThrow();
  });
});

describe("totalsByAsset", () => {
  test("sums each side per asset", () => {
    expect(totalsByAsset(RECEIPT_ENTRIES)).toEqual([
      { asset: "USDC", debits: money(5_000_000n, "USDC"), credits: money(5_000_000n, "USDC") },
    ]);
  });
});

describe("buildTransaction", () => {
  const transaction = buildTransaction(
    {
      description: "Payment received",
      reference: "clr_01J8Z3K4M5N6P7Q8R9S0T1U2V3",
      idempotencyKey: "clr_01J8Z3K4M5N6P7Q8R9S0T1U2V3:ASSET_RECEIVED",
      entries: RECEIPT_ENTRIES,
    },
    ACCOUNTS,
    NOW,
  );

  test("assigns ids and resolves accounts", () => {
    expect(transaction.id).toMatch(/^ltxn_/);
    expect(transaction.entries).toHaveLength(3);
    for (const entry of transaction.entries) {
      expect(entry.id).toMatch(/^lent_/);
      expect(entry.transactionId).toBe(transaction.id);
    }
    expect(transaction.entries[0]?.accountId).toBe(TREASURY.id);
  });

  test("carries the reference and idempotency key", () => {
    expect(transaction.reference).toBe("clr_01J8Z3K4M5N6P7Q8R9S0T1U2V3");
    expect(transaction.idempotencyKey).toBe("clr_01J8Z3K4M5N6P7Q8R9S0T1U2V3:ASSET_RECEIVED");
  });

  test("rejects an entry whose account was not resolved", () => {
    expect(() =>
      buildTransaction(
        {
          description: "Unknown account",
          entries: [
            draftEntry("TREASURY:USDC", "DEBIT", 1n),
            draftEntry("SETTLEMENT_IN_FLIGHT:USDC", "CREDIT", 1n),
          ],
        },
        ACCOUNTS,
        NOW,
      ),
    ).toThrow(ValidationError);
  });

  test("rejects an entry whose asset does not match its account", () => {
    const mismatched = new Map(ACCOUNTS);
    mismatched.set("TREASURY:USDC", { ...TREASURY, asset: "USDT" });
    expect(() =>
      buildTransaction({ description: "Mismatch", entries: RECEIPT_ENTRIES }, mismatched, NOW),
    ).toThrow(/does not match account/);
  });
});

describe("computeBalance", () => {
  const transaction = buildTransaction(
    { description: "Payment received", entries: RECEIPT_ENTRIES },
    ACCOUNTS,
    NOW,
  );

  test("signs a debit-normal account by debits minus credits", () => {
    expect(normalBalanceOf("ASSET")).toBe("DEBIT");
    const balance = computeBalance(TREASURY, transaction.entries);
    expect(balance.debits).toEqual(money(5_000_000n, "USDC"));
    expect(balance.credits).toEqual(money(0n, "USDC"));
    expect(balance.balance).toEqual(money(5_000_000n, "USDC"));
  });

  test("signs a credit-normal account by credits minus debits", () => {
    expect(normalBalanceOf("LIABILITY")).toBe("CREDIT");
    expect(computeBalance(PAYABLE, transaction.entries).balance).toEqual(money(4_975_000n, "USDC"));
    expect(computeBalance(FEES, transaction.entries).balance).toEqual(money(25_000n, "USDC"));
  });

  test("ignores entries belonging to other accounts", () => {
    const balance = computeBalance(
      account("SETTLEMENT_IN_FLIGHT:USDC", "LIABILITY", "lacc_inflight"),
      transaction.entries,
    );
    expect(balance.balance).toEqual(money(0n, "USDC"));
  });
});
