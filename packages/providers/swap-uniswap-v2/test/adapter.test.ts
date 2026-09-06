import { describe, expect, test } from "bun:test";
import { money, ValidationError } from "@mayarin/shared";
import { type UniswapV2Pair, UniswapV2SwapVenue } from "../src/adapter.ts";

// Arc testnet: EURC, USDC, and the osr21/arc-swap UniswapV2Router02.
const EURC = "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a";
const USDC = "0x3600000000000000000000000000000000000000";
const ROUTER = "0xe27d5d256b370604f1ff060fb489c6a8e3f8a6d9";

const EURC_USDC_PAIR: Record<string, UniswapV2Pair> = {
  "EURC/USDC": { chain: "arc-testnet", tokenIn: EURC, tokenOut: USDC },
};

const ONE_EURC = money(1_000_000n, "EURC");

describe("UniswapV2SwapVenue configuration", () => {
  test("a pair with no configured pair throws ConfigurationError", async () => {
    const venue = new UniswapV2SwapVenue({ rpcUrls: {}, routers: {}, pairs: {} });

    expect(venue.quote("EURC", "USDC", ONE_EURC)).rejects.toThrow(/No Uniswap V2 pair/i);
  });

  test("a pair on a chain with no router throws ConfigurationError", async () => {
    const venue = new UniswapV2SwapVenue({
      rpcUrls: { "arc-testnet": "https://arc-testnet.example" },
      routers: {},
      pairs: EURC_USDC_PAIR,
    });

    expect(venue.quote("EURC", "USDC", ONE_EURC)).rejects.toThrow(/No Uniswap V2 router/i);
  });
});

describe("UniswapV2SwapVenue chain", () => {
  // The pricing twin of `UniswapV2RouteSource`'s refusal: a pair on another
  // chain must not price a payment that will execute here.
  test("a pair on another chain refuses rather than pricing", async () => {
    const venue = new UniswapV2SwapVenue({
      rpcUrls: { "arc-testnet": "https://arc-testnet.example" },
      routers: { "arc-testnet": ROUTER },
      pairs: EURC_USDC_PAIR,
    });

    expect(venue.quote("EURC", "USDC", ONE_EURC, "base-sepolia")).rejects.toThrow(
      /is on arc-testnet, not base-sepolia/i,
    );
  });

  test("the pair's own chain prices as before", async () => {
    const venue = new UniswapV2SwapVenue({
      rpcUrls: {},
      routers: { "arc-testnet": ROUTER },
      pairs: EURC_USDC_PAIR,
    });

    // Reaches the RPC-URL check, which is past the chain guard.
    expect(venue.quote("EURC", "USDC", ONE_EURC, "arc-testnet")).rejects.toThrow(/No RPC URL/i);
  });
});

describe("UniswapV2SwapVenue.quoteExactOutput", () => {
  const ONE_USDC = money(1_000_000n, "USDC");

  test("a pair with no configured pair throws ConfigurationError", async () => {
    const venue = new UniswapV2SwapVenue({ rpcUrls: {}, routers: {}, pairs: {} });

    expect(venue.quoteExactOutput("EURC", "USDC", ONE_USDC)).rejects.toThrow(/No Uniswap V2 pair/i);
  });

  test("a pair on another chain refuses rather than pricing", async () => {
    const venue = new UniswapV2SwapVenue({
      rpcUrls: { "arc-testnet": "https://arc-testnet.example" },
      routers: { "arc-testnet": ROUTER },
      pairs: EURC_USDC_PAIR,
    });

    expect(venue.quoteExactOutput("EURC", "USDC", ONE_USDC, "base-sepolia")).rejects.toThrow(
      /is on arc-testnet, not base-sepolia/i,
    );
  });

  test("the exact output must be in the buy asset", async () => {
    const venue = new UniswapV2SwapVenue({
      rpcUrls: { "arc-testnet": "https://arc-testnet.example" },
      routers: { "arc-testnet": ROUTER },
      pairs: EURC_USDC_PAIR,
    });

    expect(venue.quoteExactOutput("EURC", "USDC", money(1_000_000n, "EURC"))).rejects.toThrow(
      ValidationError,
    );
  });
});
