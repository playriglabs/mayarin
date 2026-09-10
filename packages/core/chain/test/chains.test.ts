import { describe, expect, test } from "bun:test";
import {
  CHAIN_IDS,
  caip2Of,
  chainLogoUrl,
  chainOfCaip2,
  EVM_CHAIN_IDS,
  isChainId,
  isMainnetChain,
} from "../src/types.ts";

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
    expect(isChainId("ethereum-sepolia")).toBe(true);
    expect(isChainId("arbitrum-sepolia")).toBe(true);
    expect(isChainId("robinhood-testnet")).toBe(true);
    expect(isChainId("arc-testnet")).toBe(true);
    expect(isChainId("ethereum")).toBe(false);
  });

  // Arc mainnet is deliberately absent until the network is live and its id can
  // be read off an endpoint. A chain fact nobody can check is worse than none.
  test("does not claim a chain it cannot verify", () => {
    expect(isChainId("arc")).toBe(false);
  });

  test("provides the same network mark for mainnet and testnet variants", () => {
    expect(chainLogoUrl("ethereum-sepolia")).toBe(
      "https://assets-cdn.trustwallet.com/blockchains/ethereum/info/logo.png",
    );
    expect(chainLogoUrl("base")).toBe(
      "https://assets-cdn.trustwallet.com/blockchains/base/info/logo.png",
    );
    expect(chainLogoUrl("base-sepolia")).toBe(chainLogoUrl("base"));
    expect(chainLogoUrl("arbitrum")).toBe(
      "https://assets-cdn.trustwallet.com/blockchains/arbitrum/info/logo.png",
    );
    // A testnet wears its mainnet's mark; Trust Wallet registers only the mainnet.
    expect(chainLogoUrl("arbitrum-sepolia")).toBe(chainLogoUrl("arbitrum"));
    expect(chainLogoUrl("arc-testnet", "/arc.svg")).toBe("/arc.svg");
    expect(chainLogoUrl("robinhood-testnet")).toBeUndefined();
  });
});

describe("isMainnetChain", () => {
  // The guard this exists for refuses an in-process quote-signing key on a
  // chain carrying real value. Naming a mainnet as a testnet would let that
  // key sign live settlement amounts.
  test("treats every chain carrying real value as a mainnet", () => {
    expect(isMainnetChain("base")).toBe(true);
    expect(isMainnetChain("arbitrum")).toBe(true);
  });

  test("treats the test networks as testnets", () => {
    expect(isMainnetChain("ethereum-sepolia")).toBe(false);
    expect(isMainnetChain("base-sepolia")).toBe(false);
    expect(isMainnetChain("arbitrum-sepolia")).toBe(false);
    expect(isMainnetChain("robinhood-testnet")).toBe(false);
    expect(isMainnetChain("arc-testnet")).toBe(false);
  });
});

describe("CAIP-2", () => {
  test("derives the identifier from the EIP-155 id rather than a second table", () => {
    expect(caip2Of("ethereum-sepolia")).toBe("eip155:11155111");
    expect(caip2Of("base-sepolia")).toBe("eip155:84532");
    expect(caip2Of("arc-testnet")).toBe("eip155:5042002");
  });

  test("round-trips every supported chain", () => {
    for (const chain of CHAIN_IDS) {
      expect(chainOfCaip2(caip2Of(chain))).toBe(chain);
    }
  });

  // An unknown network arriving off the wire is a request to reject, not a bug
  // to throw on: x402 payers name their own network.
  test("returns undefined for a network this deployment does not know", () => {
    expect(chainOfCaip2("eip155:1")).toBeUndefined();
    expect(chainOfCaip2("solana:mainnet")).toBeUndefined();
    expect(chainOfCaip2("")).toBeUndefined();
  });
});
