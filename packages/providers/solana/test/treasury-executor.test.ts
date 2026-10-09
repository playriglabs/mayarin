import { describe, expect, test } from "bun:test";
import { Keypair, Transaction } from "@solana/web3.js";
import { deriveSolanaDepositKeypair } from "../src/deposit-address.ts";
import type { SolanaConnection } from "../src/settlements.ts";
import { SolanaTreasuryExecutionPort } from "../src/treasury-executor.ts";

describe("SolanaTreasuryExecutionPort", () => {
  test("funds the derived deposit owner for router rent without taking token authority", async () => {
    const seed = new Uint8Array(32).fill(17);
    const payer = deriveSolanaDepositKeypair(seed, 100);
    const feePayer = Keypair.generate();
    const sent: Transaction[] = [];
    const connection = {
      getMinimumBalanceForRentExemption: async () => 1_000_000,
      getBalance: async () => 100_000,
      getLatestBlockhash: async () => ({ blockhash: "11111111111111111111111111111111" }),
      sendRawTransaction: async (raw: Uint8Array) => {
        sent.push(Transaction.from(raw));
        return "funding-signature";
      },
      getSignatureStatuses: async () => ({
        value: [{ err: null, confirmationStatus: "confirmed" }],
      }),
    } as unknown as SolanaConnection;
    const port = new SolanaTreasuryExecutionPort({
      connections: { "solana-devnet": connection },
      depositSeed: seed,
      feePayer,
      lookup: { indexFor: async () => 100 },
      paymentRouters: {},
      deploymentDomains: {},
      feeRecipients: {},
      tokens: {},
      nativeAssets: { "solana-devnet": "SOL" },
    });

    await port.sweep({
      clearingTransactionId: "clr_solana",
      chain: "solana-devnet",
      depositAddress: payer.publicKey.toBase58(),
      asset: "USDC",
    });

    expect(sent).toHaveLength(1);
    expect(sent[0]?.feePayer?.toBase58()).toBe(feePayer.publicKey.toBase58());
    expect(sent[0]?.instructions[0]?.keys[1]?.pubkey.toBase58()).toBe(payer.publicKey.toBase58());
  });

  test("refuses an address that does not belong to the recorded derivation index", async () => {
    const seed = new Uint8Array(32).fill(19);
    const port = new SolanaTreasuryExecutionPort({
      connections: {},
      depositSeed: seed,
      feePayer: Keypair.generate(),
      lookup: { indexFor: async () => 4 },
      paymentRouters: {},
      deploymentDomains: {},
      feeRecipients: {},
      tokens: {},
      nativeAssets: {},
    });

    expect(
      port.sweep({
        clearingTransactionId: "clr_wrong",
        chain: "solana-devnet",
        depositAddress: Keypair.generate().publicKey.toBase58(),
        asset: "USDC",
      }),
    ).rejects.toThrow(/does not match/);
  });
});
