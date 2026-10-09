import { describe, expect, test } from "bun:test";
import { Keypair } from "@solana/web3.js";
import {
  deriveSolanaIntentId,
  encodeSolanaOrder,
  encodeSolanaOrderMessage,
  intentIdFromHex,
  intentIdToHex,
  LocalSolanaOrderSigner,
} from "../src/order.ts";

describe("Solana payment order", () => {
  test("uses the byte layout consumed by the Anchor program", () => {
    const settlement = Keypair.generate().publicKey.toBase58();
    const merchant = Keypair.generate().publicKey.toBase58();
    const refundTo = Keypair.generate().publicKey.toBase58();
    const intentId = deriveSolanaIntentId("clearing-123");
    const encoded = encodeSolanaOrder({
      intentId,
      settlementMint: settlement,
      minOut: 1_000_000n,
      fee: 5_000n,
      merchant,
      refundTo,
      deadline: 1_800_000_000n,
    });

    expect(encoded).toHaveLength(152);
    expect(intentIdToHex(intentIdFromHex(intentIdToHex(intentId)))).toBe(intentIdToHex(intentId));
    expect(new DataView(encoded.buffer).getBigUint64(64, true)).toBe(1_000_000n);
    expect(new DataView(encoded.buffer).getBigUint64(72, true)).toBe(5_000n);
  });

  test("signs the complete domain-separated message", async () => {
    const keypair = Keypair.generate();
    const signer = new LocalSolanaOrderSigner(keypair.secretKey);
    const order = {
      intentId: deriveSolanaIntentId("clearing-456"),
      settlementMint: Keypair.generate().publicKey.toBase58(),
      minOut: 50n,
      fee: 1n,
      merchant: Keypair.generate().publicKey.toBase58(),
      refundTo: Keypair.generate().publicKey.toBase58(),
      deadline: 1_800_000_000n,
    };
    const message = encodeSolanaOrderMessage({
      programId: Keypair.generate().publicKey.toBase58(),
      config: Keypair.generate().publicKey.toBase58(),
      deploymentDomain: new Uint8Array(32).fill(7),
      order,
    });

    expect(signer.publicKey()).toBe(keypair.publicKey.toBase58());
    expect(await signer.sign(message)).toHaveLength(64);
    expect(message).toHaveLength(272);
  });
});
