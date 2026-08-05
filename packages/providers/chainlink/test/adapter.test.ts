import { describe, expect, test } from "bun:test";
import { ChainlinkPriceOracle } from "../src/adapter.ts";

const FEED = "0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70";

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
      // Chainlink ETH/USD aggregator proxy on Base Sepolia.
      feeds: { "ETH/USDC": { chain: "base-sepolia", address: FEED } },
    });

    const price = await oracle.reference("ETH", "USDC");
    expect(price.minorUnitsPerWholeUnit > 0n).toBe(true);
    expect(price.source).toBe("chainlink");
    expect(price.observedAt.getTime()).toBeGreaterThan(0);
  });
});
