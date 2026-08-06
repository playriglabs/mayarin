import { describe, expect, test } from "bun:test";
import { money, ValidationError } from "@mayarin/shared";
import { decodeFunctionData, parseAbi } from "viem";
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
    expect(scaleSwapRate(10n ** 18n, 3_700_000_000n, 18)).toBe(3_700_000_000n);
  });

  test("a partial sell scales up to the whole-unit rate", () => {
    expect(scaleSwapRate(5n * 10n ** 17n, 1_850_000_000n, 18)).toBe(3_700_000_000n);
  });

  test("the division floors, never overstating the rate", () => {
    // 10 minor units out for 3 minor units in, 0-decimal from: 10/3 -> 3.
    expect(scaleSwapRate(3n, 10n, 0)).toBe(3n);
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

const SWAP_ROUTER = "0x2626664c2603336E57B271c5C0b26F421741e481";
const PAYMENT_ROUTER = "0x552008c0f6870c2f77e5cC1d2eb9bdff03e30Ea0";

const ROUTE_REQUEST = {
  payerAsset: "ETH",
  settlementAsset: "USDC",
  amount: ONE_ETH,
  recipient: PAYMENT_ROUTER,
  minOut: 3_700_000_000n,
} as const;

function routingVenue(pools: Record<string, UniswapPool> = ETH_USDC_POOL) {
  return new UniswapSwapVenue({
    rpcUrls: {},
    quoters: {},
    routers: { base: SWAP_ROUTER },
    pools,
  });
}

describe("UniswapSwapVenue.route", () => {
  test("encodes exactInputSingle with the router as recipient and the lock as the floor", async () => {
    const route = await routingVenue().route(ROUTE_REQUEST);

    expect(route.venue).toBe("uniswap");
    expect(route.to).toBe(SWAP_ROUTER);
    expect(route.value).toBe(0n);

    const decoded = decodeFunctionData({
      abi: parseAbi([
        "struct ExactInputSingleParams { address tokenIn; address tokenOut; uint24 fee; address recipient; uint256 amountIn; uint256 amountOutMinimum; uint160 sqrtPriceLimitX96; }",
        "function exactInputSingle(ExactInputSingleParams params) payable returns (uint256 amountOut)",
      ]),
      data: route.data,
    });
    expect(decoded.functionName).toBe("exactInputSingle");
    expect(decoded.args[0]).toEqual({
      tokenIn: WETH,
      tokenOut: USDC,
      fee: 500,
      recipient: PAYMENT_ROUTER,
      amountIn: 10n ** 18n,
      amountOutMinimum: 3_700_000_000n,
      sqrtPriceLimitX96: 0n,
    });
  });

  test("a nativeIn pool carries the amount as native value", async () => {
    const venue = routingVenue({
      "ETH/USDC": { chain: "base", tokenIn: WETH, tokenOut: USDC, fee: 500, nativeIn: true },
    });

    const route = await venue.route(ROUTE_REQUEST);
    expect(route.value).toBe(10n ** 18n);
  });

  test("a pool on a chain with no router throws ConfigurationError", async () => {
    const venue = new UniswapSwapVenue({ rpcUrls: {}, quoters: {}, pools: ETH_USDC_POOL });

    expect(venue.route(ROUTE_REQUEST)).rejects.toThrow(/No Uniswap router/i);
  });

  test("a pair with no configured pool throws ConfigurationError", async () => {
    const request = {
      ...ROUTE_REQUEST,
      payerAsset: "USDC",
      settlementAsset: "ETH",
      amount: money(1_000_000n, "USDC"),
    } as const;

    expect(routingVenue().route(request)).rejects.toThrow(/No Uniswap pool/i);
  });

  test("a malformed recipient is refused", async () => {
    expect(routingVenue().route({ ...ROUTE_REQUEST, recipient: "0xnope" })).rejects.toThrow(
      ValidationError,
    );
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
    expect(quote.minorUnitsPerWholeUnit > 0n).toBe(true);
    expect(quote.source).toBe("uniswap");
  });
});
