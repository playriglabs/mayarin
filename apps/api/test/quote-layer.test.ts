import { describe, expect, test } from "bun:test";
import { FixedClock } from "@mayarin/shared";
import { loadConfig } from "../src/config.ts";
import { createQuoteLayer } from "../src/quote-layer.ts";

const BASE = { DATABASE_URL: "postgres://localhost:5433/mayarin" } as const;
const PYTH_FEEDS =
  '{"ETH/USDC":"ff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace"}';
const DEV_SIGNER = {
  QUOTE_SIGNER: "local",
  QUOTE_SIGNER_PRIVATE_KEY: `0x${"44".repeat(32)}`,
  NODE_ENV: "development",
} as const;
const ZERO_EX = {
  ZERO_EX_API_KEY: "key",
  ZERO_EX_CHAIN_ID: "8453",
  ZERO_EX_PAIRS: '{"ETH/USDC":{"sellToken":"0xe","buyToken":"0xu"}}',
} as const;

const clock = new FixedClock(new Date("2026-08-06T12:00:00.000Z"));

describe("createQuoteLayer", () => {
  test("builds nothing when the quote layer is off", () => {
    expect(createQuoteLayer(loadConfig({ ...BASE }), clock)).toBeUndefined();
  });

  test("builds the venues in configured order — first wins a selection tie", () => {
    const layer = createQuoteLayer(
      loadConfig({
        ...BASE,
        ...ZERO_EX,
        ...DEV_SIGNER,
        QUOTE_ENABLED: "true",
        QUOTE_VENUES: '["uniswap","0x"]',
        UNISWAP_POOLS:
          '{"ETH/USDC":{"chain":"base-sepolia","tokenIn":"0xe","tokenOut":"0xu","fee":500}}',
        PYTH_FEEDS,
      }),
      clock,
    );

    expect(layer?.venues.map((venue) => venue.name)).toEqual(["uniswap", "0x"]);
  });

  test("carries the lock terms the quote engine does not own", () => {
    const layer = createQuoteLayer(
      loadConfig({
        ...BASE,
        ...ZERO_EX,
        ...DEV_SIGNER,
        QUOTE_ENABLED: "true",
        QUOTE_VENUES: '["0x"]',
        PYTH_FEEDS,
        QUOTE_SLIPPAGE_BPS: "25",
        QUOTE_TTL_SECONDS: "90",
      }),
      clock,
    );

    expect(layer?.slippageBps).toBe(25);
    expect(layer?.ttlSeconds).toBe(90);
  });

  test("the signer it builds is the one that signs orders", async () => {
    const layer = createQuoteLayer(
      loadConfig({
        ...BASE,
        ...ZERO_EX,
        ...DEV_SIGNER,
        QUOTE_ENABLED: "true",
        QUOTE_VENUES: '["0x"]',
        PYTH_FEEDS,
      }),
      clock,
    );

    // The dev key is fixed, so its address is too — a wired-up signer proves the
    // branch resolved to LocalOrderSigner rather than a Turnkey client with
    // empty credentials.
    expect(await layer?.signer.address()).toBe("0x7564105E977516C53bE337314c7E53838967bDaC");
  });
});
