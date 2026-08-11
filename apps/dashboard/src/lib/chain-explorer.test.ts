import { describe, expect, test } from "bun:test";
import { transactionExplorerUrl } from "./chain-explorer";

const HASH = `0x${"ab".repeat(32)}`;

describe("transactionExplorerUrl", () => {
  test("builds Base and Base Sepolia transaction links", () => {
    expect(transactionExplorerUrl("base", HASH)).toBe(`https://basescan.org/tx/${HASH}`);
    expect(transactionExplorerUrl("base-sepolia", HASH)).toBe(
      `https://sepolia.basescan.org/tx/${HASH}`,
    );
  });

  test("does not turn internal references or unsupported chains into links", () => {
    expect(transactionExplorerUrl("base-sepolia", "stl_01KZ")).toBeUndefined();
    expect(transactionExplorerUrl("ethereum", HASH)).toBeUndefined();
  });
});
