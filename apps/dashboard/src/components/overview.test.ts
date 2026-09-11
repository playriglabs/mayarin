import { describe, expect, test } from "bun:test";
import { todayMovement } from "./overview.tsx";

const day = (date: string, total: bigint) => ({ date, total });

describe("todayMovement", () => {
  test("goes up when today beats yesterday, with the whole-percent change", () => {
    expect(todayMovement([day("2026-09-10", 4_000_000n), day("2026-09-11", 5_000_000n)])).toEqual({
      today: 5_000_000n,
      yesterday: 4_000_000n,
      changePercent: 25,
      direction: "up",
    });
  });

  test("goes down when today is quieter than yesterday", () => {
    const movement = todayMovement([day("2026-09-10", 10_000_000n), day("2026-09-11", 4_000_000n)]);
    expect(movement.direction).toBe("down");
    expect(movement.changePercent).toBe(-60);
  });

  test("offers no percentage when yesterday sold nothing", () => {
    // Any figure against zero is infinite, and "+∞%" tells a merchant nothing.
    const movement = todayMovement([day("2026-09-10", 0n), day("2026-09-11", 3_000_000n)]);
    expect(movement.direction).toBe("up");
    expect(movement.changePercent).toBeNull();
  });

  test("is flat with nothing on either day", () => {
    expect(todayMovement([])).toEqual({
      today: 0n,
      yesterday: 0n,
      changePercent: null,
      direction: "flat",
    });
  });
});
