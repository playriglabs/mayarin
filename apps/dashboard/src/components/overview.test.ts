import { describe, expect, test } from "bun:test";
import { todaySales } from "./overview.tsx";

const day = (date: string, total: bigint) => ({ date, total });

describe("todaySales", () => {
  test("is the last day of the series, which is today", () => {
    expect(todaySales([day("2026-09-10", 4_000_000n), day("2026-09-11", 5_000_000n)])).toBe(
      5_000_000n,
    );
  });

  test("is zero when nothing has sold today, whatever sold before", () => {
    expect(todaySales([day("2026-09-10", 4_000_000n), day("2026-09-11", 0n)])).toBe(0n);
  });

  test("is zero with no series at all", () => {
    expect(todaySales([])).toBe(0n);
  });
});
