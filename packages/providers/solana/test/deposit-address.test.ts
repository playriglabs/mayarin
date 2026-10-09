import { describe, expect, test } from "bun:test";
import { PublicKey } from "@solana/web3.js";
import { deriveSolanaDepositKeypair, SolanaDepositAddressDeriver } from "../src/deposit-address.ts";

describe("SolanaDepositAddressDeriver", () => {
  test("derives stable, distinct base58 owners without exposing the root seed", () => {
    const first = new SolanaDepositAddressDeriver({ seed: new Uint8Array(32).fill(7) });
    const restored = new SolanaDepositAddressDeriver({ seed: new Uint8Array(32).fill(7) });

    expect(first.derive(42)).toBe(restored.derive(42));
    expect(first.derive(42)).not.toBe(first.derive(43));
    expect(new PublicKey(first.derive(42)).toBase58()).toBe(first.derive(42));
  });

  test("refuses an invalid root or derivation index", () => {
    expect(() => new SolanaDepositAddressDeriver({ seed: new Uint8Array(31) })).toThrow(/32 bytes/);
    const deriver = new SolanaDepositAddressDeriver({ seed: new Uint8Array(32) });
    expect(() => deriver.derive(-1)).toThrow(/non-negative/);
  });

  test("reconstructs the signing key for an allocated deposit owner", () => {
    const seed = new Uint8Array(32).fill(11);
    const deriver = new SolanaDepositAddressDeriver({ seed });

    expect(deriveSolanaDepositKeypair(seed, 100).publicKey.toBase58()).toBe(deriver.derive(100));
  });
});
