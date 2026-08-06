import { describe, expect, test } from "bun:test";
import type { PriceQuote } from "@mayarin/clearing";
import { ConfigurationError, money } from "@mayarin/shared";
import type { RouteRequest, SwapRoute } from "../src/index.ts";
import { FixedRoutingVenue } from "../testing/index.ts";

const ETH_USDC: PriceQuote = {
  from: "ETH",
  to: "USDC",
  minorUnitsPerWholeUnit: 3_700_000_000n,
  source: "0x",
};

const ROUTE: SwapRoute = {
  venue: "0x",
  to: "0x0000000000001fF3684f28c67538d4D072C22734",
  data: "0xdeadbeef",
  value: 0n,
};

const REQUEST: RouteRequest = {
  payerAsset: "ETH",
  settlementAsset: "USDC",
  amount: money(10n ** 18n, "ETH"),
  recipient: "0x552008c0f6870c2f77e5cC1d2eb9bdff03e30Ea0",
  minOut: 3_700_000_000n,
};

describe("FixedRoutingVenue", () => {
  test("serves the configured route and records the request", async () => {
    const venue = new FixedRoutingVenue("0x", [ETH_USDC], { "ETH/USDC": ROUTE });

    const route = await venue.route(REQUEST);

    expect(route).toEqual(ROUTE);
    expect(venue.routeCalls).toEqual([REQUEST]);
  });

  test("still serves quotes through the same venue", async () => {
    const venue = new FixedRoutingVenue("0x", [ETH_USDC], { "ETH/USDC": ROUTE });

    const quote = await venue.quote("ETH", "USDC", money(10n ** 18n, "ETH"));
    expect(quote).toEqual(ETH_USDC);
  });

  test("a pair with no configured route throws ConfigurationError", async () => {
    const venue = new FixedRoutingVenue("0x", [ETH_USDC]);

    expect(venue.route(REQUEST)).rejects.toThrow(ConfigurationError);
  });
});
