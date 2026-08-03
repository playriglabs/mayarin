import { describe, expect, test } from "bun:test";
import { classifyDeposit, confirmationsOf, isWithinReorgWatch } from "../src/policy.ts";

const policy = { depth: 6, reorgWatchWindow: 2 } as const;

describe("confirmationsOf", () => {
  test("a transaction in the head block has one confirmation", () => {
    expect(confirmationsOf(100n, 100n)).toBe(1);
  });

  test("counts inclusively from the deposit's block to the head", () => {
    expect(confirmationsOf(95n, 100n)).toBe(6);
  });

  test("a block above the head has no confirmations yet", () => {
    expect(confirmationsOf(101n, 100n)).toBe(0);
  });
});

describe("classifyDeposit", () => {
  test("stays PENDING below the configured depth", () => {
    expect(
      classifyDeposit({
        current: "PENDING",
        blockNumber: 96n,
        blockHash: "0xaa",
        headNumber: 100n,
        canonicalHash: "0xaa",
        policy,
      }),
    ).toBe("PENDING");
  });

  test("becomes CONFIRMED at exactly the configured depth", () => {
    expect(
      classifyDeposit({
        current: "PENDING",
        blockNumber: 95n,
        blockHash: "0xaa",
        headNumber: 100n,
        canonicalHash: "0xaa",
        policy,
      }),
    ).toBe("CONFIRMED");
  });

  test("a hash mismatch orphans the deposit whatever its depth", () => {
    expect(
      classifyDeposit({
        current: "CONFIRMED",
        blockNumber: 95n,
        blockHash: "0xaa",
        headNumber: 100n,
        canonicalHash: "0xbb",
        policy,
      }),
    ).toBe("ORPHANED");
  });

  test("a height the chain has not reached leaves the deposit PENDING", () => {
    expect(
      classifyDeposit({
        current: "PENDING",
        blockNumber: 101n,
        blockHash: "0xaa",
        headNumber: 100n,
        canonicalHash: undefined,
        policy,
      }),
    ).toBe("PENDING");
  });

  test("an already-orphaned deposit is terminal", () => {
    expect(
      classifyDeposit({
        current: "ORPHANED",
        blockNumber: 95n,
        blockHash: "0xaa",
        headNumber: 100n,
        canonicalHash: "0xaa",
        policy,
      }),
    ).toBe("ORPHANED");
  });

  test("a confirmed deposit is not unwound by a missing canonical hash", () => {
    expect(
      classifyDeposit({
        current: "CONFIRMED",
        blockNumber: 95n,
        blockHash: "0xaa",
        headNumber: 100n,
        canonicalHash: undefined,
        policy,
      }),
    ).toBe("CONFIRMED");
  });
});

describe("isWithinReorgWatch", () => {
  test("watches up to depth times the window", () => {
    expect(isWithinReorgWatch(12, policy)).toBe(true);
  });

  test("stops probing past the window", () => {
    expect(isWithinReorgWatch(13, policy)).toBe(false);
  });
});
