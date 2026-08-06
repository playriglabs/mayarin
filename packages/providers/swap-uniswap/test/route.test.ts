import { describe, expect, test } from "bun:test";
import type { RouteRequest } from "@mayarin/execution";
import { ConfigurationError, money } from "@mayarin/shared";
import { decodeFunctionData } from "viem";
import { swapRouter02Abi, UniswapRouteSource } from "../src/route.ts";

const PAYMENT_ROUTER = "0x00000000000000000000000000000000000c0de5";
const SWAP_ROUTER = "0x2626664c2603336E57B271c5C0b26F421741e481";
const WETH = "0x4200000000000000000000000000000000000006";
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

const source = new UniswapRouteSource({
  swapRouters: { base: SWAP_ROUTER },
  pools: { "ETH/USDC": { chain: "base", tokenIn: WETH, tokenOut: USDC, fee: 500 } },
});

const request: RouteRequest = {
  payerAsset: "ETH",
  settlementAsset: "USDC",
  exactOut: money(2_135_000n, "USDC"),
  maxIn: money(600_000_000_000_000n, "ETH"),
  recipient: PAYMENT_ROUTER,
};

describe("UniswapRouteSource", () => {
  test("encodes exactOutputSingle with the locked amount as the fixed side", async () => {
    const route = await source.route(request);

    expect(route.router).toBe(SWAP_ROUTER);
    expect(route.source).toBe("uniswap");

    const decoded = decodeFunctionData({ abi: swapRouter02Abi, data: route.callData });
    expect(decoded.functionName).toBe("exactOutputSingle");
    const params = (decoded.args as readonly unknown[])[0] as Record<string, unknown>;

    // The merchant's minOut is exact; the payer's estimate is only a ceiling.
    expect(params.amountOut).toBe(2_135_000n);
    expect(params.amountInMaximum).toBe(600_000_000_000_000n);
    expect(params.fee).toBe(500);
    expect(String(params.tokenIn).toLowerCase()).toBe(WETH.toLowerCase());
    expect(String(params.tokenOut).toLowerCase()).toBe(USDC.toLowerCase());
  });

  test("delivers into the PaymentRouter, not the merchant", async () => {
    // The contract measures its own settlement-balance delta; a route paying the
    // merchant directly would settle nothing and revert on minOut.
    const route = await source.route(request);
    const decoded = decodeFunctionData({ abi: swapRouter02Abi, data: route.callData });
    const params = (decoded.args as readonly unknown[])[0] as Record<string, unknown>;
    expect(String(params.recipient).toLowerCase()).toBe(PAYMENT_ROUTER.toLowerCase());
  });

  test("sets no price limit — amountInMaximum is the only bound", async () => {
    const route = await source.route(request);
    const decoded = decodeFunctionData({ abi: swapRouter02Abi, data: route.callData });
    const params = (decoded.args as readonly unknown[])[0] as Record<string, unknown>;
    expect(params.sqrtPriceLimitX96).toBe(0n);
  });

  test("needs no network call — routes are encoded, not fetched", async () => {
    // No fetch is injected anywhere in this suite; reaching for one would fail.
    await expect(source.route(request)).resolves.toBeDefined();
  });

  test("an unconfigured pool is a configuration error", async () => {
    await expect(source.route({ ...request, payerAsset: "BTC" })).rejects.toThrow(
      ConfigurationError,
    );
  });

  test("a pool on a chain with no SwapRouter02 address is a configuration error", async () => {
    const misconfigured = new UniswapRouteSource({
      swapRouters: {},
      pools: { "ETH/USDC": { chain: "base", tokenIn: WETH, tokenOut: USDC, fee: 500 } },
    });
    await expect(misconfigured.route(request)).rejects.toThrow(ConfigurationError);
  });

  test("refuses an input bound that is not in the payer asset", async () => {
    await expect(source.route({ ...request, maxIn: money(1n, "USDC") })).rejects.toThrow(
      ConfigurationError,
    );
  });
});
