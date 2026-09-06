import { describe, expect, test } from "bun:test";
import { money, RATE_SCALE, ValidationError } from "@mayarin/shared";
import { type UniswapPool, UniswapSwapVenue } from "../src/adapter.ts";
import { scaleSwapRate } from "../src/quoter.ts";

// Base mainnet addresses: WETH, native USDC, QuoterV2.
const WETH = "0x4200000000000000000000000000000000000006";
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const QUOTER = "0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a";

const ETH_USDC_POOL: Record<string, UniswapPool> = {
  "ETH/USDC": { chain: "base", tokenIn: WETH, tokenOut: USDC, fee: 500 },
};

const ONE_ETH = money(10n ** 18n, "ETH");

describe("scaleSwapRate", () => {
  test("a whole-unit sell is the amount out itself", () => {
    expect(scaleSwapRate(10n ** 18n, 3_700_000_000n, 18)).toBe(3_700_000_000n * RATE_SCALE);
  });

  test("a partial sell scales up to the whole-unit rate", () => {
    expect(scaleSwapRate(5n * 10n ** 17n, 1_850_000_000n, 18)).toBe(3_700_000_000n * RATE_SCALE);
  });

  test("the division floors, never overstating the rate", () => {
    // 10 minor units out for 3 minor units in, 0-decimal from: 10/3 -> 3.
    // 10/3 floors at RATE_DECIMALS: 3.333333333, never 3.333333334.
    expect(scaleSwapRate(3n, 10n, 0)).toBe(3_333_333_333n);
  });
});

describe("UniswapSwapVenue configuration", () => {
  test("a pair with no configured pool throws ConfigurationError", async () => {
    const venue = new UniswapSwapVenue({ rpcUrls: {}, quoters: {}, pools: {} });

    expect(venue.quote("ETH", "USDC", ONE_ETH)).rejects.toThrow(/No Uniswap pool/i);
  });

  test("a pool on a chain with no quoter throws ConfigurationError", async () => {
    const venue = new UniswapSwapVenue({
      rpcUrls: { base: "https://mainnet.base.org" },
      quoters: {},
      pools: ETH_USDC_POOL,
    });

    expect(venue.quote("ETH", "USDC", ONE_ETH)).rejects.toThrow(/No Uniswap quoter/i);
  });

  test("a pool on a chain with no RPC URL throws ConfigurationError", async () => {
    const venue = new UniswapSwapVenue({
      rpcUrls: {},
      quoters: { base: QUOTER },
      pools: ETH_USDC_POOL,
    });

    expect(venue.quote("ETH", "USDC", ONE_ETH)).rejects.toThrow(/RPC URL/i);
  });

  test("a malformed token address throws before any network call", async () => {
    const venue = new UniswapSwapVenue({
      rpcUrls: { base: "https://mainnet.base.org" },
      quoters: { base: QUOTER },
      pools: { "ETH/USDC": { chain: "base", tokenIn: "not-an-address", tokenOut: USDC, fee: 500 } },
    });

    expect(venue.quote("ETH", "USDC", ONE_ETH)).rejects.toThrow();
  });
});

describe("UniswapSwapVenue validation", () => {
  test("an amount in a different asset than the sell asset is refused", async () => {
    const venue = new UniswapSwapVenue({ rpcUrls: {}, quoters: {}, pools: ETH_USDC_POOL });

    expect(venue.quote("ETH", "USDC", money(1_000_000n, "USDC"))).rejects.toThrow(ValidationError);
  });

  test("a non-positive amount is refused", async () => {
    const venue = new UniswapSwapVenue({ rpcUrls: {}, quoters: {}, pools: ETH_USDC_POOL });

    expect(venue.quote("ETH", "USDC", money(0n, "ETH"))).rejects.toThrow(ValidationError);
  });
});

// A live read needs a real quoter and pool; gate it exactly like the EVM
// client's network tests so `bun test` stays offline by default.
const RPC_URLS = process.env.CHAIN_RPC_URLS;
const parsedUrls: Partial<Record<"base" | "base-sepolia", string>> =
  RPC_URLS === undefined ? {} : JSON.parse(RPC_URLS);

describe.skipIf(parsedUrls.base === undefined)("UniswapSwapVenue live", () => {
  test("quotes ETH into USDC through the 0.05% pool on base", async () => {
    const venue = new UniswapSwapVenue({
      rpcUrls: parsedUrls,
      quoters: { base: QUOTER },
      pools: ETH_USDC_POOL,
    });

    const quote = await venue.quote("ETH", "USDC", ONE_ETH);
    expect(quote.scaledRate > 0n).toBe(true);
    expect(quote.source).toBe("uniswap");
  });
});

describe("UniswapSwapVenue chain", () => {
  // The pricing twin of the route source's refusal. A Base pool priced an Arc
  // payment before this, and the lock carried a rate from a pool the swap would
  // never touch.
  test("a pool on another chain refuses rather than pricing", async () => {
    const venue = new UniswapSwapVenue({
      rpcUrls: { base: "https://mainnet.base.org" },
      quoters: { base: QUOTER },
      pools: ETH_USDC_POOL,
    });

    expect(venue.quote("ETH", "USDC", ONE_ETH, "arc-testnet")).rejects.toThrow(
      /is on base, not arc-testnet/i,
    );
  });
});

describe("UniswapSwapVenue.quoteExactOutput", () => {
  test("a pair with no configured pool throws ConfigurationError", async () => {
    const venue = new UniswapSwapVenue({ rpcUrls: {}, quoters: {}, pools: {} });

    expect(venue.quoteExactOutput("ETH", "USDC", money(50_000_000n, "USDC"))).rejects.toThrow(
      /No Uniswap pool/i,
    );
  });

  test("a pool on another chain refuses rather than pricing", async () => {
    const venue = new UniswapSwapVenue({
      rpcUrls: { base: "https://mainnet.base.org" },
      quoters: { base: QUOTER },
      pools: ETH_USDC_POOL,
    });

    expect(
      venue.quoteExactOutput("ETH", "USDC", money(50_000_000n, "USDC"), "arc-testnet"),
    ).rejects.toThrow(/is on base, not arc-testnet/i);
  });

  test("the exact output must be in the buy asset", async () => {
    const venue = new UniswapSwapVenue({
      rpcUrls: { base: "https://mainnet.base.org" },
      quoters: { base: QUOTER },
      pools: ETH_USDC_POOL,
    });

    expect(venue.quoteExactOutput("ETH", "USDC", money(10n ** 18n, "ETH"))).rejects.toThrow(
      ValidationError,
    );
  });
});
