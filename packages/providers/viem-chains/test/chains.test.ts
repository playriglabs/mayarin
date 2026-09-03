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
});
