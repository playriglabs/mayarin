import { describe, expect, test } from "bun:test";
import { CHAIN_IDS, EVM_CHAIN_IDS, isChainId, isMainnetChain } from "../src/types.ts";

describe("chain facts", () => {
  test("every supported chain has an EIP-155 id", () => {
    for (const chain of CHAIN_IDS) {
      expect(EVM_CHAIN_IDS[chain]).toBeGreaterThan(0n);
    }
  });

  test("no two chains share an EIP-155 id", () => {
    const ids = CHAIN_IDS.map((chain) => EVM_CHAIN_IDS[chain]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("recognises the chains it supports", () => {
    expect(isChainId("arbitrum-sepolia")).toBe(true);
    expect(isChainId("robinhood-testnet")).toBe(true);
    expect(isChainId("arc-testnet")).toBe(true);
    expect(isChainId("hedera-testnet")).toBe(true);
    expect(isChainId("ethereum")).toBe(false);
  });

  // Arc mainnet is deliberately absent until the network is live and its id can
  // be read off an endpoint. A chain fact nobody can check is worse than none.
  test("does not claim a chain it cannot verify", () => {
    expect(isChainId("arc")).toBe(false);
  });
});

describe("isMainnetChain", () => {
  // The guard this exists for refuses an in-process quote-signing key on a
  // chain carrying real value. Naming a mainnet as a testnet would let that
  // key sign live settlement amounts.
  test("treats every chain carrying real value as a mainnet", () => {
    expect(isMainnetChain("base")).toBe(true);
    expect(isMainnetChain("arbitrum")).toBe(true);
    expect(isMainnetChain("hedera")).toBe(true);
  });

  test("treats the test networks as testnets", () => {
    expect(isMainnetChain("base-sepolia")).toBe(false);
    expect(isMainnetChain("arbitrum-sepolia")).toBe(false);
    expect(isMainnetChain("robinhood-testnet")).toBe(false);
    expect(isMainnetChain("arc-testnet")).toBe(false);
    expect(isMainnetChain("hedera-testnet")).toBe(false);
  });
});
