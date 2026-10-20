import { describe, expect, test } from "bun:test";
import { chainUnitScale, fromChainUnits, toChainUnits } from "../src/token-units.ts";

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
    expect(chainUnitScale("polygon", "WBTC")).toBe(1n);
    expect(chainUnitScale("polygon", "WETH")).toBe(1n);
  });

  test("DAI carries 18 decimals on Ethereum and Arbitrum beside 6-decimal USDC and USDT", () => {
    for (const chain of ["ethereum", "arbitrum"] as const) {
      expect(chainUnitScale(chain, "DAI")).toBe(10n ** 12n);
      expect(chainUnitScale(chain, "USDC")).toBe(1n);
      expect(chainUnitScale(chain, "USDT")).toBe(1n);
      expect(toChainUnits(chain, "DAI", 2_500_000n)).toBe(2_500_000n * 10n ** 12n);
      expect(fromChainUnits(chain, "DAI", 2_500_000n * 10n ** 12n)).toBe(2_500_000n);
    }
  });

  test("two stablecoins on one chain are scaled apart, which one scale per chain could not do", () => {
    const usdc = toChainUnits("arbitrum", "USDC", 1_000_000n);
    const dai = toChainUnits("arbitrum", "DAI", 1_000_000n);
    expect(dai / usdc).toBe(10n ** 12n);
  });

  test("DAI is 18 decimals on BNB Smart Chain too, like every stablecoin there", () => {
    expect(chainUnitScale("bsc", "DAI")).toBe(10n ** 12n);
    expect(chainUnitScale("bsc", "FDUSD")).toBe(10n ** 12n);
  });

  test("USDG stays at the registry's 6 decimals on Arbitrum", () => {
    expect(chainUnitScale("arbitrum", "USDG")).toBe(1n);
  });

  test("a sub-unit of DAI is dropped, never rounded up", () => {
    expect(fromChainUnits("ethereum", "DAI", 10n ** 12n - 1n)).toBe(0n);
    expect(fromChainUnits("ethereum", "DAI", 10n ** 12n + 999n)).toBe(1n);
  });
});
