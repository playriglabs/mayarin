/** Real Ed25519 signatures matching the bytes Phantom signs. */

import { describe, expect, test } from "bun:test";
import { ed25519 } from "@noble/curves/ed25519";
import { Keypair } from "@solana/web3.js";
import { SolanaSignatureVerifier } from "../src/signature.ts";

function signed(message: string) {
  const wallet = Keypair.generate();
  const signature = ed25519.sign(new TextEncoder().encode(message), wallet.secretKey.slice(0, 32));
  return {
    address: wallet.publicKey.toBase58(),
    signature: Buffer.from(signature).toString("base64"),
  };
}

describe("SolanaSignatureVerifier", () => {
  test("verifies the exact message and base58 public key", async () => {
    const message = "Mayarin wallet verification\n\nMerchant: mrc_1";
    const proof = signed(message);

    expect(
      await new SolanaSignatureVerifier().verify({
        message,
        signature: proof.signature,
        address: proof.address,
        chain: "solana-devnet",
      }),
    ).toBe(true);
  });

  test("rejects a changed message", async () => {
    const proof = signed("one");

    expect(
      await new SolanaSignatureVerifier().verify({
        message: "two",
        signature: proof.signature,
        address: proof.address,
        chain: "solana-devnet",
      }),
    ).toBe(false);
  });

  test("does not accept the signature on an EVM chain", async () => {
    const proof = signed("one");

    expect(
      await new SolanaSignatureVerifier().verify({
        message: "one",
        signature: proof.signature,
        address: proof.address,
        chain: "base-sepolia",
      }),
    ).toBe(false);
  });
});
