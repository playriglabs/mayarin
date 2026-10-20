import { describe, expect, test } from "bun:test";
import {
  chainUnitScale,
  fromChainUnits,
  fromSettlementUnits,
  toChainUnits,
  toSettlementUnits,
} from "../src/token-units.ts";

describe("token units", () => {
  test("a chain that agrees with the registry is the identity", () => {
    expect(chainUnitScale("base-sepolia", "USDC")).toBe(1n);
    expect(toChainUnits("base-sepolia", "USDC", 1_500_000n)).toBe(1_500_000n);
    expect(fromChainUnits("polygon-amoy", "USDC", 1_500_000n)).toBe(1_500_000n);
  });

  test("BSC stablecoins carry 18 decimals against the registry's 6", () => {
    expect(chainUnitScale("bsc-testnet", "USDC")).toBe(10n ** 12n);
    expect(toChainUnits("bsc-testnet", "USDT", 1_500_000n)).toBe(1_500_000n * 10n ** 12n);
    expect(fromChainUnits("bsc-testnet", "USDT", 1_500_000n * 10n ** 12n)).toBe(1_500_000n);
  });

  test("Ethereum mainnet agrees with the registry, like its testnet", () => {
    expect(chainUnitScale("ethereum", "USDC")).toBe(1n);
    expect(toChainUnits("ethereum", "USDT", 2_000_000n)).toBe(2_000_000n);
  });

  test("BNB Smart Chain mainnet counts like its testnet", () => {
    expect(chainUnitScale("bsc", "USDC")).toBe(10n ** 12n);
    expect(toChainUnits("bsc", "USDT", 2_000_000n)).toBe(2_000_000n * 10n ** 12n);
    expect(chainUnitScale("polygon", "USDC")).toBe(1n);
  });

  test("sub-unit dust from the chain is dropped, not rounded up", () => {
    expect(fromChainUnits("bsc-testnet", "USDC", 10n ** 12n - 1n)).toBe(0n);
    expect(fromChainUnits("bsc-testnet", "USDC", 10n ** 12n + 999n)).toBe(1n);
  });

  test("a non-stablecoin is never scaled", () => {
    expect(chainUnitScale("bsc-testnet", "ETH")).toBe(1n);
  });

  test("settlement units use the stablecoin scale", () => {
    expect(toSettlementUnits("bsc-testnet", 2n)).toBe(2n * 10n ** 12n);
    expect(fromSettlementUnits("bsc-testnet", 2n * 10n ** 12n)).toBe(2n);
    expect(toSettlementUnits("base", 2n)).toBe(2n);
  });
});
