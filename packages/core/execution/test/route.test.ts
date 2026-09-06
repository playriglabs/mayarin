import { describe, expect, test } from "bun:test";
import { ConfigurationError, money } from "@mayarin/shared";
import {
  type ExecutableRoute,
  FallbackRouteSource,
  type RouteRequest,
  type SwapRouteSource,
} from "../src/index.ts";
import { FixedRouteSource } from "../testing/index.ts";

const ROUTE: ExecutableRoute = {
  router: "0x0000000000001fF3684f28c67538d4D072C22734",
  callData: "0xdeadbeef",
  expectedIn: money(13_600_000_000_000_000n, "ETH"),
  source: "0x",
};

const REQUEST: RouteRequest = {
  payerAsset: "ETH",
  settlementAsset: "USDC",
  exactOut: money(50_000_000n, "USDC"),
  maxIn: money(13_700_000_000_000_000n, "ETH"),
  recipient: "0x552008c0f6870c2f77e5cC1d2eb9bdff03e30Ea0",
  chain: "base",
};

describe("FixedRouteSource", () => {
  test("serves the configured route and records the request", async () => {
    const source = new FixedRouteSource("0x", { "ETH/USDC": ROUTE });

    const route = await source.route(REQUEST);

    expect(route).toEqual(ROUTE);
    expect(source.calls).toEqual([REQUEST]);
  });

  test("a pair with no configured route throws ConfigurationError", async () => {
    const source = new FixedRouteSource("0x");

    expect(source.route(REQUEST)).rejects.toThrow(ConfigurationError);
  });
});

describe("FallbackRouteSource", () => {
  test("falls through a venue whose pool is on another chain", async () => {
    const elsewhere = new FixedRouteSource("uniswap");
    const here = new FixedRouteSource("uniswap-v2", { "ETH/USDC": ROUTE });

    const route = await new FallbackRouteSource([elsewhere, here]).route(REQUEST);

    expect(route).toEqual(ROUTE);
    expect(elsewhere.calls).toEqual([REQUEST]);
  });

  test("stops at the first venue that can route", async () => {
    const first = new FixedRouteSource("uniswap", { "ETH/USDC": ROUTE });
    const second = new FixedRouteSource("uniswap-v2", { "ETH/USDC": ROUTE });

    await new FallbackRouteSource([first, second]).route(REQUEST);

    expect(second.calls).toEqual([]);
  });

  // A venue fault is not something to route around: swallowing it would report
  // "no venue" for what is really an RPC outage on the venue that could serve.
  test("rethrows a non-configuration failure instead of trying the next venue", async () => {
    const broken: SwapRouteSource = {
      name: "uniswap",
      route: () => Promise.reject(new Error("RPC timeout")),
    };
    const here = new FixedRouteSource("uniswap-v2", { "ETH/USDC": ROUTE });

    expect(new FallbackRouteSource([broken, here]).route(REQUEST)).rejects.toThrow("RPC timeout");
  });

  test("no venue at all throws ConfigurationError", async () => {
    expect(new FallbackRouteSource([]).route(REQUEST)).rejects.toThrow(ConfigurationError);
  });
});
