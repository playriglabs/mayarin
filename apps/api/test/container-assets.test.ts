import { describe, expect, test } from "bun:test";
import type { Stablecoin } from "@mayarin/stablecoin";
import { assetPairs } from "../src/container.ts";

const USDC = "0x1c7d4b196cb0c7b01d743fbc6116a902379c7238" as const;
const PYUSD = "0xcac524bca292aaade2df8a05cc58f0a65b1b3bb9" as const;

const stablecoins: readonly Stablecoin[] = [
  { asset: "USDC", onChain: [{ chain: "ethereum-sepolia", address: USDC }] },
  { asset: "PYUSD", onChain: [{ chain: "ethereum-sepolia", address: PYUSD }] },
];

describe("x402 capability warm-up assets", () => {
  test("probes direct settlement assets, not PaymentRouter-only inputs", () => {
    expect(
      assetPairs(stablecoins, { "ethereum-sepolia": "https://rpc.example" }, ["USDC"]),
    ).toEqual([{ chain: "ethereum-sepolia", contract: USDC }]);
  });

  test("does not probe a settlement asset on a chain with no RPC", () => {
    expect(assetPairs(stablecoins, {}, ["USDC"])).toEqual([]);
  });
});
