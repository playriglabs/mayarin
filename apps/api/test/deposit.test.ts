import { describe, expect, test } from "bun:test";
import { depositUri } from "../src/dto/deposit.ts";

describe("depositUri", () => {
  test("builds a Solana Pay transfer request for an SPL token", () => {
    expect(
      depositUri(
        {
          address: "56qSN5FG1utffJucpRiSm71y5dLBqDMS8XynpZVuuD6f",
          amount: { amount: 10_000n, asset: "USDC" },
          asset: "USDC",
          chain: "solana-devnet",
        },
        "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
      ),
    ).toBe(
      "solana:56qSN5FG1utffJucpRiSm71y5dLBqDMS8XynpZVuuD6f?amount=0.010000&spl-token=4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
    );
  });

  test("builds a native SOL request without a token mint", () => {
    expect(
      depositUri(
        {
          address: "56qSN5FG1utffJucpRiSm71y5dLBqDMS8XynpZVuuD6f",
          amount: { amount: 25_000_000n, asset: "SOL" },
          asset: "SOL",
          chain: "solana-devnet",
        },
        undefined,
      ),
    ).toBe("solana:56qSN5FG1utffJucpRiSm71y5dLBqDMS8XynpZVuuD6f?amount=0.025000000");
  });

  test("does not guess a missing SPL token mint", () => {
    expect(
      depositUri(
        {
          address: "56qSN5FG1utffJucpRiSm71y5dLBqDMS8XynpZVuuD6f",
          amount: { amount: 10_000n, asset: "USDC" },
          asset: "USDC",
          chain: "solana-devnet",
        },
        undefined,
      ),
    ).toBeNull();
  });
});
