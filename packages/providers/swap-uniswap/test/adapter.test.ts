import { describe, expect, test } from "bun:test";
import { assetDecimals, money, RATE_SCALE, ValidationError } from "@mayarin/shared";
import { type UniswapPool, UniswapSwapVenue } from "../src/adapter.ts";
import { scaleSwapRate } from "../src/quoter.ts";

// Base mainnet addresses: WETH, native USDC, QuoterV2.
const WETH = "0x4200000000000000000000000000000000000006";
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const QUOTER = "0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a";

const ETH_USDC = {
  chain: "base",
  tokenIn: WETH,
  tokenOut: USDC,
  fee: 500,
} as const satisfies UniswapPool;
const ETH_USDC_POOL: Record<string, UniswapPool> = { "ETH/USDC": ETH_USDC };

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
  test("requires a chain when the same pair is configured on several networks", async () => {
    const venue = new UniswapSwapVenue({
      rpcUrls: {},
      quoters: {},
      pools: {
        "base:ETH/USDC": ETH_USDC,
        "ethereum-sepolia:ETH/USDC": {
          chain: "ethereum-sepolia",
          tokenIn: WETH,
          tokenOut: USDC,
          fee: 3000,
        },
      },
    });

    expect(venue.quote("ETH", "USDC", ONE_ETH)).rejects.toThrow(/requires a chain/i);
  });

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

// A chain's read client that records what the quoter was asked and answers with a fixed tuple.
function quoterReturning(result: readonly [bigint, bigint, number, bigint]) {
  const calls: { functionName: string; args: readonly unknown[] }[] = [];
  const client = {
    readContract: async (call: { functionName: string; args: readonly unknown[] }) => {
      calls.push({ functionName: call.functionName, args: call.args });
      return result;
    },
  } as never;
  return { client, calls };
}

/** What the quoter was first asked; a test that expects a call fails clearly when there was none. */
function firstArgs<T>(calls: readonly { args: readonly unknown[] }[]): T {
  const call = calls[0];
  if (call === undefined) throw new Error("the quoter was never called");
  return call.args[0] as T;
}

describe("UniswapSwapVenue token units", () => {
  // USDC and USDT carry 18 decimals on BNB Smart Chain and 6 everywhere else; the quote must
  // be read in what the token contract counts and returned in what the domain counts.
  const BSC_BNB_USDC = {
    chain: "bsc",
    tokenIn: "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c",
    tokenOut: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d",
    fee: 500,
  } as const satisfies UniswapPool;

  test("BNB to USDC on BSC reads 18-decimal USDC back as the domain's 6", async () => {
    // 731 USDC, in BSC USDC's 18 decimals.
    const { client, calls } = quoterReturning([731n * 10n ** 18n, 0n, 0, 0n]);
    const venue = new UniswapSwapVenue({
      rpcUrls: {},
      quoters: { bsc: QUOTER },
      pools: { "BNB/USDC": BSC_BNB_USDC },
      clients: { bsc: client },
    });

    const quote = await venue.quote("BNB", "USDC", money(10n ** 18n, "BNB"), "bsc");

    // Without the conversion this was 10^12 too large, and the deviation guard refused it.
    expect(quote.scaledRate).toBe(731_000_000n * RATE_SCALE);
    // BNB is not a stablecoin, so what is asked of the pool is unchanged.
    expect(firstArgs<{ amountIn: bigint }>(calls).amountIn).toBe(10n ** 18n);
  });

  test("DAI to USDC on Ethereum sends the pool DAI's 18 decimals, not a trillionth of it", async () => {
    const oneDai = money(10n ** BigInt(assetDecimals("DAI")), "DAI");
    const { client, calls } = quoterReturning([999_900n, 0n, 0, 0n]);
    const venue = new UniswapSwapVenue({
      rpcUrls: {},
      quoters: { ethereum: QUOTER },
      pools: {
        "DAI/USDC": {
          chain: "ethereum",
          tokenIn: "0x6B175474E89094C44Da98b954EedeAC495271d0F",
          tokenOut: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
          fee: 100,
        },
      },
      clients: { ethereum: client },
    });

    const quote = await venue.quote("DAI", "USDC", oneDai, "ethereum");

    expect(firstArgs<{ amountIn: bigint }>(calls).amountIn).toBe(10n ** 18n);
    expect(quote.scaledRate).toBe(scaleSwapRate(oneDai.amount, 999_900n, assetDecimals("DAI")));
  });

  test("a chain whose tokens agree with the domain is untouched", async () => {
    const { client, calls } = quoterReturning([3_700_000_000n, 0n, 0, 0n]);
    const venue = new UniswapSwapVenue({
      rpcUrls: {},
      quoters: { base: QUOTER },
      pools: ETH_USDC_POOL,
      clients: { base: client },
    });

    const quote = await venue.quote("ETH", "USDC", ONE_ETH, "base");

    expect(firstArgs<{ amountIn: bigint }>(calls).amountIn).toBe(10n ** 18n);
    expect(quote.scaledRate).toBe(3_700_000_000n * RATE_SCALE);
  });

  test("exact output asks for the token contract's amount and rounds the cost up", async () => {
    // Paying 100 USDC (BSC, 18 decimals) plus one wei: the domain cannot count the wei, so the
    // cost is rounded up to the next domain unit rather than dropped.
    const { client, calls } = quoterReturning([100n * 10n ** 18n + 1n, 0n, 0, 0n]);
    const venue = new UniswapSwapVenue({
      rpcUrls: {},
      quoters: { bsc: QUOTER },
      pools: {
        "USDC/BNB": {
          chain: "bsc",
          tokenIn: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d",
          tokenOut: "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c",
          fee: 500,
        },
      },
      clients: { bsc: client },
    });

    const quote = await venue.quoteExactOutput("USDC", "BNB", money(10n ** 17n, "BNB"), "bsc");

    // BNB is not a stablecoin, so the exact output goes to the pool as it is.
    expect(firstArgs<{ amount: bigint }>(calls).amount).toBe(10n ** 17n);
    // 100.000000 USDC plus a unit that was rounded up, over 0.1 BNB.
    expect(quote.scaledRate).toBe(scaleSwapRate(100_000_001n, 10n ** 17n, assetDecimals("USDC")));
  });
});
