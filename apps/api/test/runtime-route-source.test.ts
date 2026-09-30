/**
 * Execution reads the runtime pool set, the same one pricing reads (#95).
 *
 * The failure this guards: a pool added through the admin API priced a deposit
 * payment, then the treasury executor — built at boot from `.env` — failed it
 * at CLEARING with "Uniswap has no configured pool for USDC/EURC on
 * base-sepolia".
 */

import { describe, expect, test } from "bun:test";
import { ConfigurationError, money } from "@mayarin/shared";
import { loadConfig } from "../src/config.ts";
import { RuntimeRouteSource } from "../src/contract-layer.ts";

const config = loadConfig({
  DATABASE_URL: "postgres://localhost:5433/mayarin",
  PYTH_API_KEY: "test-key",
  QUOTE_ENABLED: "true",
  QUOTE_VENUES: '["uniswap"]',
  PYTH_FEEDS: '{"ETH/USDC":"0xff"}',
  // The boot-time pool set knows only ETH/USDC.
  UNISWAP_POOLS:
    '{"ETH/USDC":{"chain":"base-sepolia","tokenIn":"0x4200000000000000000000000000000000000006","tokenOut":"0x036CbD53842c5426634e7929541eC2318f3dCF7e","fee":3000}}',
  UNISWAP_QUOTERS: '{"base-sepolia":"0xC5290058841028F1614F3A6F0F5816cAd0df5E27"}',
  UNISWAP_SWAP_ROUTERS: '{"base-sepolia":"0x94cC0AaC535CCDB3C01d6787D6413C739ae12bc4"}',
  QUOTE_SIGNER: "local",
  QUOTE_SIGNER_PRIVATE_KEY: `0x${"11".repeat(32)}`,
});

const USDC_EURC = {
  "base-sepolia:USDC/EURC": {
    chain: "base-sepolia",
    tokenIn: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    tokenOut: "0x808456652fdb597867f38412077A9182bf77359F",
    fee: 500,
  },
};

const request = {
  payerAsset: "USDC",
  settlementAsset: "EURC",
  exactOut: money(2_411_234n, "EURC"),
  maxIn: money(2_500_000n, "USDC"),
  recipient: `0x${"ab".repeat(20)}`,
  chain: "base-sepolia",
} as const;

describe("RuntimeRouteSource", () => {
  test("routes a pool that exists only in the runtime config", async () => {
    const source = new RuntimeRouteSource(config, async () => USDC_EURC as never);

    const route = await source.route(request);

    expect(route.router.toLowerCase()).toBe("0x94cc0aac535ccdb3c01d6787d6413c739ae12bc4");
    expect(route.source).toBe("uniswap");
  });

  test("reads the pools on every route, so an admin change applies without a restart", async () => {
    let pools: Record<string, unknown> = {};
    const source = new RuntimeRouteSource(config, async () => pools as never);

    await expect(source.route(request)).rejects.toBeInstanceOf(ConfigurationError);
    pools = USDC_EURC;
    await expect(source.route(request)).resolves.toMatchObject({ source: "uniswap" });
  });
});
