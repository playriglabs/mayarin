import { describe, expect, test } from "bun:test";
import { SAFE_1_4_1 } from "../src/wallet-provider.ts";

describe("the canonical Safe deployment", () => {
  test("names the 1.4.1 contracts at their deterministic addresses", () => {
    // Checked on-chain with `getCode` before this shipped; a wrong factory
    // deploys nothing, or something else, and the merchant's money follows.
    expect(SAFE_1_4_1.proxyFactory).toBe("0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67");
    expect(SAFE_1_4_1.singleton).toBe("0x29fcB43b46531BcA003ddC8FCB67FFE91900C762");
    expect(SAFE_1_4_1.fallbackHandler).toBe("0xfd0732Dc9E303f09fCEf3a7388Ad10A83459Ec99");
  });

  test("carries the bytecode each contract must have, read identically off three chains", () => {
    // Base Sepolia, Ethereum Sepolia and Arc testnet answered with these exact
    // hashes. They are what lets a new chain be provisioned on without a table
    // entry: the provider matches them on that chain before deriving anything.
    expect(SAFE_1_4_1.codeHashes).toEqual({
      proxyFactory: "0x50c3cdc4074750a7a974204a716c999edd37482f907608d960b2b025ee0b3317",
      singleton: "0xb1f926978a0f44a2c0ec8fe822418ae969bd8c3f18d61e5103100339894f81ff",
      fallbackHandler: "0x7c6007a5d711cea8dfd5d91f5940ec29c7f200fe511eb1fc1397b367af3c42f9",
    });
  });
});
