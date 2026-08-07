import { describe, expect, test } from "bun:test";
import { ChainlinkPriceOracle } from "../src/adapter.ts";

// Chainlink ETH/USD aggregator proxy on Base Sepolia. VERIFIED on-chain:
// `description()` returns "ETH / USD", `decimals()` returns 8, and
// `latestRoundData()` answers with a recent round. The address this previously
// named held no code at all, so the live read below decoded empty returndata —
// invisible until an RPC URL was configured and the test stopped skipping.
const FEED = "0x4aDC67696bA383F43DD60A9e78F2C97Fbbfc7cb1";

describe("ChainlinkPriceOracle configuration", () => {
  test("a pair with no configured feed throws ConfigurationError", async () => {
    const oracle = new ChainlinkPriceOracle({ rpcUrls: {}, feeds: {} });

    expect(oracle.reference("ETH", "USDC")).rejects.toThrow(/No Chainlink feed/i);
  });

  test("a feed on a chain with no RPC URL throws ConfigurationError", async () => {
    const oracle = new ChainlinkPriceOracle({
      rpcUrls: {},
      feeds: { "ETH/USDC": { chain: "base-sepolia", address: FEED } },
    });

    expect(oracle.reference("ETH", "USDC")).rejects.toThrow(/RPC URL/i);
  });

  test("a malformed feed address throws before any network call", async () => {
    const oracle = new ChainlinkPriceOracle({
      rpcUrls: { "base-sepolia": "https://sepolia.base.org" },
      feeds: { "ETH/USDC": { chain: "base-sepolia", address: "not-an-address" } },
    });

    expect(oracle.reference("ETH", "USDC")).rejects.toThrow();
  });
});

// A live read needs a real aggregator; gate it exactly like the EVM client's
// network tests so `bun test` stays offline by default.
const RPC_URLS = process.env.CHAIN_RPC_URLS;

describe.skipIf(RPC_URLS === undefined)("ChainlinkPriceOracle live", () => {
  test("reads an ETH/USD reference on base-sepolia", async () => {
    const oracle = new ChainlinkPriceOracle({
      rpcUrls: JSON.parse(RPC_URLS ?? "{}"),
      feeds: { "ETH/USDC": { chain: "base-sepolia", address: FEED } },
    });

    const price = await oracle.reference("ETH", "USDC");
    expect(price.scaledRate > 0n).toBe(true);
    expect(price.source).toBe("chainlink");
    expect(price.observedAt.getTime()).toBeGreaterThan(0);
  });
});
