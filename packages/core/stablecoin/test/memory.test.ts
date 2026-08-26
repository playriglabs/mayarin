import { describe, expect, test } from "bun:test";
import type { AssetCode } from "@mayarin/shared";
import { InMemoryStablecoinRegistry } from "../src/memory.ts";
import type { Stablecoin } from "../src/types.ts";

/** A stablecoin Mayarin books but never takes a deposit in. */
const LEDGER_ONLY = "XSTBL" as AssetCode;
const ledgerOnly: Stablecoin = { asset: LEDGER_ONLY, onChain: [] };
const usdc: Stablecoin = {
  asset: "USDC",
  onChain: [{ chain: "base-sepolia", address: "0xUsdc" }], // mixed case on input
};
// The canonical form the registry stores: addresses lowercased.
const usdcLower: Stablecoin = {
  asset: "USDC",
  onChain: [{ chain: "base-sepolia", address: "0xusdc" }],
};
const usdt: Stablecoin = {
  asset: "USDT",
  onChain: [
    { chain: "base-sepolia", address: "0xusdt-sep" },
    { chain: "base", address: "0xusdt-base" },
  ],
};

function registry() {
  return new InMemoryStablecoinRegistry([ledgerOnly, usdc, usdt]);
}

describe("InMemoryStablecoinRegistry", () => {
  test("lists every admitted stablecoin with addresses lowercased", async () => {
    expect(await registry().list()).toEqual([ledgerOnly, usdcLower, usdt]);
  });

  test("finds an admitted asset and returns undefined for an unknown one", async () => {
    const r = registry();
    expect(await r.find("USDC")).toEqual(usdcLower);
    expect(await r.find("ETH")).toBeUndefined();
  });

  test("isSettlementAsset is true for every registered stablecoin", async () => {
    const r = registry();
    expect(await r.isSettlementAsset(LEDGER_ONLY)).toBe(true);
    expect(await r.isSettlementAsset("USDC")).toBe(true);
    expect(await r.isSettlementAsset("ETH")).toBe(false);
  });

  test("isDepositAsset requires an on-chain identity on that chain", async () => {
    const r = registry();
    expect(await r.isDepositAsset("USDC", "base-sepolia")).toBe(true);
    expect(await r.isDepositAsset("USDT", "base")).toBe(true);
    // A ledger-only stablecoin is never a deposit asset.
    expect(await r.isDepositAsset(LEDGER_ONLY, "base-sepolia")).toBe(false);
    // USDC is not deployed on base.
    expect(await r.isDepositAsset("USDC", "base")).toBe(false);
    // Unknown asset.
    expect(await r.isDepositAsset("ETH", "base-sepolia")).toBe(false);
  });

  test("address lowercases on construction and returns undefined where not deployed", async () => {
    const r = registry();
    expect(await r.address("USDC", "base-sepolia")).toBe("0xusdc");
    expect(await r.address("USDT", "base")).toBe("0xusdt-base");
    // Ledger-only assets have no address.
    expect(await r.address(LEDGER_ONLY, "base-sepolia")).toBeUndefined();
    // Not deployed on this chain.
    expect(await r.address("USDC", "base")).toBeUndefined();
    // Unknown asset.
    expect(await r.address("ETH", "base-sepolia")).toBeUndefined();
  });
});
