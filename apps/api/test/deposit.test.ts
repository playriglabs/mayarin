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

  test("builds a native request for POL on Polygon, with no token address", () => {
    expect(
      depositUri(
        {
          address: "0xc017aff14743c7be2d80370f4df152744f292e3e",
          amount: { amount: 11_500_000_000_000_000_000n, asset: "POL" },
          asset: "POL",
          chain: "polygon",
        },
        undefined,
      ),
    ).toBe("ethereum:0xc017aff14743c7be2d80370f4df152744f292e3e@137?value=11500000000000000000");
  });

  test("names nothing transferable for BTC on an EVM chain", () => {
    expect(
      depositUri(
        {
          address: "0xc017aff14743c7be2d80370f4df152744f292e3e",
          amount: { amount: 1n, asset: "BTC" },
          asset: "BTC",
          chain: "polygon",
        },
        undefined,
      ),
    ).toBeNull();
  });
});
