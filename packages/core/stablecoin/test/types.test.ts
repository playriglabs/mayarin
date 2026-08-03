import { describe, expect, test } from "bun:test";
import type { AssetCode } from "@mayarin/shared";
import { isLedgerOnly, pairsOf, type Stablecoin } from "../src/types.ts";

const idrx: Stablecoin = { asset: "IDRX" as AssetCode, onChain: [] };
const usdc: Stablecoin = {
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

describe("isLedgerOnly", () => {
  test("true when a stablecoin has no on-chain identity", () => {
    expect(isLedgerOnly(idrx)).toBe(true);
  });

  test("false when a stablecoin is deployed on at least one chain", () => {
    expect(isLedgerOnly(usdc)).toBe(false);
    expect(isLedgerOnly(usdt)).toBe(false);
  });
});

describe("pairsOf", () => {
  test("flattens every on-chain identity into a (chain, asset) pair", () => {
    expect(pairsOf([idrx, usdc, usdt])).toEqual([
      { chain: "base-sepolia", asset: "USDC" },
      { chain: "base-sepolia", asset: "USDT" },
      { chain: "base", asset: "USDT" },
    ]);
  });

  test("ledger-only stablecoins contribute no pairs", () => {
    expect(pairsOf([idrx])).toEqual([]);
  });

  test("is empty for no stablecoins", () => {
    expect(pairsOf([])).toEqual([]);
  });
});
