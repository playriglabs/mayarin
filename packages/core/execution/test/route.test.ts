import { describe, expect, test } from "bun:test";
import { ConfigurationError, money } from "@mayarin/shared";
import type { ExecutableRoute, RouteRequest } from "../src/index.ts";
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
