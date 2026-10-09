import { createHmac } from "node:crypto";
import type { DepositAddressDeriver } from "@mayarin/chain";
import { Keypair } from "@solana/web3.js";

export interface SolanaDepositAddressDeriverOptions {
  readonly seed: Uint8Array;
}

export function deriveSolanaDepositKeypair(seed: Uint8Array, index: number): Keypair {
  if (seed.length !== 32) throw new Error("Solana deposit seed must be 32 bytes");
  if (!Number.isSafeInteger(index) || index < 0) {
    throw new Error(`Solana deposit index must be a non-negative safe integer, got ${index}`);
  }
  const indexBytes = Buffer.alloc(8);
  indexBytes.writeBigUInt64BE(BigInt(index));
  const childSeed = createHmac("sha512", seed)
    .update("mayarin.solana.deposit.v1")
    .update(indexBytes)
    .digest()
    .subarray(0, 32);
  return Keypair.fromSeed(childSeed);
}

/** Deterministic, chain-family-separated Ed25519 deposit owners. */
export class SolanaDepositAddressDeriver implements DepositAddressDeriver {
  readonly #seed: Uint8Array;

  constructor(options: SolanaDepositAddressDeriverOptions) {
    if (options.seed.length !== 32) throw new Error("Solana deposit seed must be 32 bytes");
    this.#seed = Uint8Array.from(options.seed);
  }

  derive(index: number): string {
    return deriveSolanaDepositKeypair(this.#seed, index).publicKey.toBase58();
  }
}
