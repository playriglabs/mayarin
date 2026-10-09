import { describe, expect, test } from "bun:test";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { type Connection, Keypair, type PublicKey } from "@solana/web3.js";
import { SolanaDepositClient } from "../src/deposits.ts";

const CHAIN = "solana-devnet" as const;
const BLOCK_HASH = "8tNWWV9EYBttJa2H8rQQ3Srj5gLhL9KiaRATgWQ4jA1G";

function parsedTransaction(input: {
  readonly sender: PublicKey;
  readonly account: PublicKey;
  readonly preBalance?: number;
  readonly postBalance?: number;
  readonly preTokenAmount?: string;
  readonly postTokenAmount?: string;
}) {
  const tokenBalance = (amount: string) => ({
    accountIndex: 1,
    mint: Keypair.generate().publicKey.toBase58(),
    owner: input.account.toBase58(),
    programId: TOKEN_PROGRAM_ID.toBase58(),
    uiTokenAmount: {
      amount,
      decimals: 6,
      uiAmount: Number(amount) / 1_000_000,
      uiAmountString: amount,
    },
  });
  return {
    blockTime: 1_700_000_000,
    meta: {
      err: null,
      fee: 5_000,
      innerInstructions: null,
      logMessages: [],
      postBalances: [0, input.postBalance ?? 0],
      postTokenBalances:
        input.postTokenAmount === undefined ? [] : [tokenBalance(input.postTokenAmount)],
      preBalances: [0, input.preBalance ?? 0],
      preTokenBalances:
        input.preTokenAmount === undefined ? [] : [tokenBalance(input.preTokenAmount)],
      rewards: null,
      loadedAddresses: { readonly: [], writable: [] },
    },
    slot: 500,
    transaction: {
      message: {
        accountKeys: [
          { pubkey: input.sender, signer: true, writable: true, source: "transaction" },
          { pubkey: input.account, signer: false, writable: true, source: "transaction" },
        ],
        instructions: [],
        recentBlockhash: BLOCK_HASH,
      },
      signatures: ["deposit-signature"],
    },
  };
}

function fakeConnection(input: {
  readonly account: PublicKey;
  readonly transaction: ReturnType<typeof parsedTransaction>;
  readonly mintOwner?: PublicKey;
}): Connection {
  return {
    getAccountInfo: async () => (input.mintOwner === undefined ? null : { owner: input.mintOwner }),
    getBlock: async () => ({ blockhash: BLOCK_HASH }),
    getParsedTransaction: async () => input.transaction,
    getSignaturesForAddress: async (address: PublicKey) => {
      expect(address.toBase58()).toBe(input.account.toBase58());
      return [
        {
          blockTime: 1_700_000_000,
          confirmationStatus: "confirmed",
          err: null,
          memo: null,
          signature: "deposit-signature",
          slot: 500,
        },
      ];
    },
    getSlot: async () => 500,
  } as unknown as Connection;
}

describe("SolanaDepositClient", () => {
  test("reads a positive native balance delta as a SOL deposit", async () => {
    const owner = Keypair.generate().publicKey;
    const sender = Keypair.generate().publicKey;
    const transaction = parsedTransaction({
      sender,
      account: owner,
      preBalance: 0,
      postBalance: 25_000_000,
    });
    const client = new SolanaDepositClient({
      connection: fakeConnection({ account: owner, transaction }),
      tokens: {},
    });

    expect(
      await client.transfers({
        chain: CHAIN,
        asset: "SOL",
        addresses: [owner.toBase58()],
        fromBlock: 499n,
        toBlock: 501n,
      }),
    ).toEqual([
      {
        chain: CHAIN,
        asset: "SOL",
        txHash: "deposit-signature",
        logIndex: 1,
        blockNumber: 500n,
        blockHash: BLOCK_HASH,
        from: sender.toBase58(),
        to: owner.toBase58(),
        amount: 25_000_000n,
      },
    ]);
  });

  test("reads an ATA token delta and reports the deposit owner", async () => {
    const owner = Keypair.generate().publicKey;
    const sender = Keypair.generate().publicKey;
    const mint = Keypair.generate().publicKey;
    const { getAssociatedTokenAddressSync } = await import("@solana/spl-token");
    const account = getAssociatedTokenAddressSync(mint, owner, false, TOKEN_PROGRAM_ID);
    const transaction = parsedTransaction({
      sender,
      account,
      preTokenAmount: "2000",
      postTokenAmount: "12000",
    });
    const client = new SolanaDepositClient({
      connection: fakeConnection({ account, transaction, mintOwner: TOKEN_PROGRAM_ID }),
      tokens: { USDC: mint.toBase58() },
    });

    const transfers = await client.transfers({
      chain: CHAIN,
      asset: "USDC",
      addresses: [owner.toBase58()],
      fromBlock: 500n,
      toBlock: 500n,
    });

    expect(transfers).toHaveLength(1);
    expect(transfers[0]?.to).toBe(owner.toBase58());
    expect(transfers[0]?.amount).toBe(10_000n);
  });
});
