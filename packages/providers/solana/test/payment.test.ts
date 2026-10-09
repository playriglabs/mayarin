import { describe, expect, test } from "bun:test";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { type Connection, Keypair } from "@solana/web3.js";
import { deriveSolanaIntentId } from "../src/order.ts";
import { buildDirectSolanaPayment } from "../src/payment.ts";

function connection(): Connection {
  return {
    getAccountInfo: async () => ({ owner: TOKEN_PROGRAM_ID }),
    getMultipleAccountsInfo: async (addresses: readonly unknown[]) => addresses.map(() => null),
    getLatestBlockhash: async () => ({ blockhash: "11111111111111111111111111111111" }),
  } as unknown as Connection;
}

describe("Solana payment transaction", () => {
  test("lets the backend pay fees while the deposit owner remains token authority", async () => {
    const payer = Keypair.generate();
    const feePayer = Keypair.generate();
    const mint = Keypair.generate().publicKey;
    const built = await buildDirectSolanaPayment({
      connection: connection(),
      programId: Keypair.generate().publicKey.toBase58(),
      payer: payer.publicKey.toBase58(),
      preparationFeePayer: feePayer.publicKey.toBase58(),
      feeRecipient: Keypair.generate().publicKey.toBase58(),
      deploymentDomain: new Uint8Array(32).fill(1),
      order: {
        intentId: deriveSolanaIntentId("deposit-payment"),
        settlementMint: mint.toBase58(),
        minOut: 1_000_000n,
        fee: 5_000n,
        merchant: Keypair.generate().publicKey.toBase58(),
        refundTo: feePayer.publicKey.toBase58(),
        deadline: 1_900_000_000n,
      },
      inputAmount: 1_000_000n,
      signature: new Uint8Array(64),
      signerPublicKey: Keypair.generate().publicKey.toBase58(),
    });

    expect(built.transaction.feePayer?.toBase58()).toBe(payer.publicKey.toBase58());
    expect(
      built.preparationTransactions.every((tx) => tx.feePayer?.equals(feePayer.publicKey)),
    ).toBe(true);
    const pay = built.transaction.instructions[1];
    expect(pay?.keys[0]?.pubkey.toBase58()).toBe(payer.publicKey.toBase58());
    expect(pay?.keys[0]?.isSigner).toBe(true);
  });
});
