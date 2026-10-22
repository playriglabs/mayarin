import { describe, expect, test } from "bun:test";
import { CHANNEL_QUERIES } from "./live-updates";

describe("what the refresh stream re-reads", () => {
  test("the wallet balance is not among it", () => {
    // The stream ticks every three seconds; the balance is an on-chain read across every chain.
    const keys = Object.values(CHANNEL_QUERIES)
      .flat()
      .map((key) => key.join("/"));
    expect(keys).not.toContain("wallets/balance");
  });

  test("the payments list and its analytics still are", () => {
    expect(CHANNEL_QUERIES.payments.map((key) => key.join("/"))).toEqual(["payments", "analytics"]);
  });
});
