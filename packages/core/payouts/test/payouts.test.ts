import { describe, expect, test } from "bun:test";
import { money } from "@mayarin/shared";
import { payoutTotals, unmatchedRows } from "../src/batch.ts";
import { MAX_PAYOUT_ROWS, parsePayouts } from "../src/parse.ts";

const ALICE = `0x${"a1".repeat(20)}`;
const BOB = `0x${"b2".repeat(20)}`;
const SAFE = `0x${"5a".repeat(20)}`;
const assets = ["USDC", "USDG"] as const;

describe("parsePayouts", () => {
  test("reads rows, skipping a header and blank lines", () => {
    const { rows, errors } = parsePayouts(
      `address,amount,asset,note\n${ALICE},12.50,usdc,September, design\n\n${BOB},3,USDG\n`,
      { assets },
    );

    expect(errors).toEqual([]);
    expect(rows).toEqual([
      { line: 2, to: ALICE, amount: money(12_500_000n, "USDC"), note: "September, design" },
      { line: 4, to: BOB, amount: money(3_000_000n, "USDG") },
    ]);
  });

  test("reports every bad line with its number", () => {
    const { rows, errors } = parsePayouts(
      [
        "0x123,1,USDC",
        `0x${"0".repeat(40)},1,USDC`,
        `${ALICE},1,DAI`,
        `${ALICE},1.1234567,USDC`,
        `${ALICE},0,USDC`,
        `${BOB},1,USDC`,
      ].join("\n"),
      { assets },
    );

    expect(rows.map((row) => row.line)).toEqual([6]);
    expect(errors.map((error) => error.line)).toEqual([1, 2, 3, 4, 5]);
  });

  test("an empty file is an error, not an empty batch", () => {
    expect(parsePayouts("address,amount,asset\n", { assets }).errors).toHaveLength(1);
  });

  test(`refuses more than ${MAX_PAYOUT_ROWS} recipients`, () => {
    const text = Array.from({ length: MAX_PAYOUT_ROWS + 1 }, () => `${ALICE},1,USDC`).join("\n");
    expect(parsePayouts(text, { assets }).errors.at(-1)?.message).toContain("at most");
  });
});

describe("payoutTotals", () => {
  test("sums per asset", () => {
    const { rows } = parsePayouts(`${ALICE},1.5,USDC\n${BOB},2,USDG\n${BOB},0.5,USDC`, { assets });
    expect(payoutTotals(rows)).toEqual([money(2_000_000n, "USDC"), money(2_000_000n, "USDG")]);
  });
});

describe("unmatchedRows", () => {
  const { rows } = parsePayouts(`${ALICE},1,USDC\n${ALICE},1,USDC\n${BOB},2,USDG`, { assets });
  const out = (to: string, amount: ReturnType<typeof money>) => ({ from: SAFE, to, amount });

  test("every row matched by its own transfer out of the Safe", () => {
    const transfers = [
      out(ALICE, money(1_000_000n, "USDC")),
      out(BOB, money(2_000_000n, "USDG")),
      out(ALICE, money(1_000_000n, "USDC")),
    ];
    expect(unmatchedRows(rows, transfers, SAFE.toUpperCase().replace("0X", "0x"))).toEqual([]);
  });

  test("one transfer cannot pay two identical rows", () => {
    const transfers = [out(ALICE, money(1_000_000n, "USDC")), out(BOB, money(2_000_000n, "USDG"))];
    expect(unmatchedRows(rows, transfers, SAFE).map((row) => row.line)).toEqual([2]);
  });

  test("a transfer from somewhere else is not the Safe paying", () => {
    const transfers = [
      { from: BOB, to: ALICE, amount: money(1_000_000n, "USDC") },
      out(ALICE, money(1_000_000n, "USDC")),
      out(BOB, money(2_000_000n, "USDG")),
    ];
    expect(unmatchedRows(rows, transfers, SAFE).map((row) => row.line)).toEqual([2]);
  });
});
