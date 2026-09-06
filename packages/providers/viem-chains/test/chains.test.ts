import { describe, expect, test } from "bun:test";
import { CHAIN_IDS, EVM_CHAIN_IDS } from "@mayarin/chain";
import { VIEM_CHAINS } from "../src/chains.ts";

describe("VIEM_CHAINS", () => {
  test("covers every supported chain", () => {
    for (const chain of CHAIN_IDS) {
      expect(VIEM_CHAINS[chain]).toBeDefined();
    }
  });

  // Two tables naming the same chain is exactly where a typo hides: viem signs
  // and broadcasts with its own `id`, so a mismatch would send a transaction to
  // the wrong network while every check against `EVM_CHAIN_IDS` still passed.
  test("agrees with the EIP-155 ids the domain layer holds", () => {
    for (const chain of CHAIN_IDS) {
      expect(BigInt(VIEM_CHAINS[chain].id)).toBe(EVM_CHAIN_IDS[chain]);
    }
  });

  // Every chain before Arc had an 18-decimal native asset, and code that
  // formats or estimates against that assumption is wrong by twelve orders of
  // magnitude the day one is not. Pinning the decimals here means viem changing
  // a definition under us fails a test rather than a settlement.
  test("pins the native decimals each chain actually uses", () => {
    for (const chain of CHAIN_IDS) {
      expect(VIEM_CHAINS[chain].nativeCurrency.decimals).toBe(18);
    }
  });

  // Arc's native asset is USDC, not ETH. The client scans native transfers
  // against a configured `nativeAssets` map for exactly this reason; a chain
  // whose symbol is not ETH must not be assumed to be.
  test("names the native asset of the non-ETH chain", () => {
    expect(VIEM_CHAINS["arc-testnet"].nativeCurrency.symbol).toBe("USDC");
  });
});
