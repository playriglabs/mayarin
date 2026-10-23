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

  test("builds a token transfer for a payer-only ERC-20 such as WBTC", () => {
    expect(
      depositUri(
        {
          address: "0xc017aff14743c7be2d80370f4df152744f292e3e",
          amount: { amount: 50_000n, asset: "WBTC" },
          asset: "WBTC",
          chain: "polygon",
        },
        "0x1BFD67037B42Cf73acF2047067bd4F2C47D9BfD6",
      ),
    ).toBe(
      "ethereum:0x1BFD67037B42Cf73acF2047067bd4F2C47D9BfD6@137/transfer?address=0xc017aff14743c7be2d80370f4df152744f292e3e&uint256=50000",
    );
  });

  test("does not guess a missing token address for WETH", () => {
    expect(
      depositUri(
        {
          address: "0xc017aff14743c7be2d80370f4df152744f292e3e",
          amount: { amount: 1n, asset: "WETH" },
          asset: "WETH",
          chain: "polygon",
        },
        undefined,
      ),
    ).toBeNull();
  });
  test("builds a token transfer request for a payer-only token once its contract is known", () => {
    const uri = depositUri(
      {
        address: "0x76c14730da6f30a3e4ff826f01419a0b73461f6e",
        amount: { amount: 418_670_590_000_000_000n, asset: "CAKE" },
        asset: "CAKE",
        chain: "bsc",
      },
      "0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82",
    );
    expect(uri).toStartWith("ethereum:0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82@56/transfer?");
    expect(uri).toContain("address=0x76c14730da6f30a3e4ff826f01419a0b73461f6e");
  });
});
