import { describe, expect, test } from "bun:test";
import { chooseRail } from "../src/rail.ts";

describe("chooseRail", () => {
  test("uses the first accepted rail", () => {
    expect(chooseRail(["base-sepolia", "arc-testnet"])).toEqual({
      chain: "base-sepolia",
      reason: "base-sepolia: first accepted rail in merchant configuration",
    });
  });

  test("refuses an empty list", () => {
    expect(() => chooseRail([])).toThrow(/at least one accepted rail/);
  });
});
