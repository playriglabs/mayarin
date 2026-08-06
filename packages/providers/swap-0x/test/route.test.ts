import { describe, expect, test } from "bun:test";
import type { RouteRequest } from "@mayarin/execution";
import { ConfigurationError, money, ProviderError } from "@mayarin/shared";
import { ZeroExRouteSource } from "../src/route.ts";

const PAYMENT_ROUTER = "0x00000000000000000000000000000000000c0de5";
const PAIRS = {
  "ETH/USDC": { sellToken: "0xeeee", buyToken: "0xa0b8" },
} as const;

const request: RouteRequest = {
  payerAsset: "ETH",
  settlementAsset: "USDC",
  exactOut: money(2_135_000n, "USDC"), // the merchant's locked minOut
  maxIn: money(600_000_000_000_000n, "ETH"), // payer estimate, slippage included
  recipient: PAYMENT_ROUTER,
};

function source(handler: (url: URL, init?: RequestInit) => Response): ZeroExRouteSource {
  return new ZeroExRouteSource({
    pairs: PAIRS,
    chainId: 8453,
    apiKey: "key",
    fetchFn: ((input: string | URL | Request, init?: RequestInit) =>
      Promise.resolve(handler(new URL(String(input)), init))) as typeof fetch,
  });
}

function quote(overrides: Record<string, unknown> = {}): Response {
  return Response.json({
    liquidityAvailable: true,
    sellAmount: "577000000000000",
    buyAmount: "2135000",
    transaction: { to: "0xdef1c0ded9bec7f1a1670819833240f027b25eff", data: "0xdeadbeef" },
    ...overrides,
  });
}

describe("ZeroExRouteSource", () => {
  test("asks for exact output, and for the router as taker", async () => {
    let seen: URL | undefined;
    const route = await source((url) => {
      seen = url;
      return quote();
    }).route(request);

    // buyAmount, not sellAmount: the merchant's minOut is the fixed side.
    expect(seen?.searchParams.get("buyAmount")).toBe("2135000");
    expect(seen?.searchParams.get("sellAmount")).toBeNull();
    // The router holds the input when the swap runs, so it is the taker.
    expect(seen?.searchParams.get("taker")).toBe(PAYMENT_ROUTER);
    expect(seen?.pathname).toBe("/swap/allowance-holder/quote");

    expect(route.router).toBe("0xdef1c0ded9bec7f1a1670819833240f027b25eff");
    expect(route.callData).toBe("0xdeadbeef");
    expect(route.expectedIn).toEqual(money(577_000_000_000_000n, "ETH"));
    expect(route.source).toBe("0x");
  });

  test("sends the API key and version headers", async () => {
    let headers: Record<string, string> = {};
    await source((_url, init) => {
      headers = (init?.headers ?? {}) as Record<string, string>;
      return quote();
    }).route(request);

    expect(headers["0x-api-key"]).toBe("key");
    expect(headers["0x-version"]).toBe("v2");
  });

  test("refuses a route that would spend past the payer's bound", async () => {
    // The payer authorised 0.0006 ETH; a route wanting more must not be built.
    await expect(
      source(() => quote({ sellAmount: "700000000000000" })).route(request),
    ).rejects.toThrow(ProviderError);
  });

  test("refuses a route delivering less than the locked amount", async () => {
    // This would revert on-chain against minOut; failing here costs no gas.
    await expect(source(() => quote({ buyAmount: "2134999" })).route(request)).rejects.toThrow(
      ProviderError,
    );
  });

  test("no liquidity is a retryable provider failure, not a config error", async () => {
    await expect(
      source(() => Response.json({ liquidityAvailable: false })).route(request),
    ).rejects.toThrow(ProviderError);
  });

  test("an unconfigured pair is a configuration error", async () => {
    await expect(source(() => quote()).route({ ...request, payerAsset: "BTC" })).rejects.toThrow(
      ConfigurationError,
    );
  });

  test("refuses an exact output that is not in the settlement asset", async () => {
    await expect(
      source(() => quote()).route({ ...request, exactOut: money(1n, "ETH") }),
    ).rejects.toThrow(ConfigurationError);
  });

  test("an HTTP failure surfaces as a ProviderError", async () => {
    await expect(
      source(() => new Response("nope", { status: 429 })).route(request),
    ).rejects.toThrow(ProviderError);
  });

  test("a malformed response surfaces as a ProviderError, never a partial route", async () => {
    await expect(
      source(() => Response.json({ liquidityAvailable: true, sellAmount: "1" })).route(request),
    ).rejects.toThrow(ProviderError);
  });
});
