import { describe, expect, test } from "bun:test";
import { raise } from "../src/services/operator-bumper.ts";

describe("raise", () => {
  test("clears the 10% a node demands for a replacement", () => {
    for (const fee of [1n, 7n, 1_000n, 30_000_000_000n]) {
      expect(raise(fee) * 100n).toBeGreaterThanOrEqual(fee * 110n);
    }
  });
});
