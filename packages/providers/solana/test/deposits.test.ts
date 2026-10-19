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
    getMultipleAccountsInfo: async (keys: PublicKey[]) => keys.map(() => ({ lamports: 1 })),
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

  describe("RPC cost", () => {
    const calls = (connection: Connection, name: string) =>
      (connection as unknown as Record<string, { calls: number }>)[name]?.calls ?? 0;
    const counted = (fn: (...args: never[]) => Promise<unknown>) => {
      const wrapped = Object.assign(
        async (...args: never[]) => {
          wrapped.calls += 1;
          return fn(...args);
        },
        { calls: 0 },
      );
      return wrapped;
    };

    test("looks up signatures only for addresses that have an account", async () => {
      const paid = Keypair.generate().publicKey;
      const unpaid = Keypair.generate().publicKey;
      const signatures = counted(async () => []);
      const connection = {
        getSignaturesForAddress: signatures,
        getMultipleAccountsInfo: async (keys: PublicKey[]) =>
          keys.map((key) => (key.equals(paid) ? { lamports: 1 } : null)),
      } as unknown as Connection;
      const client = new SolanaDepositClient({ connection, tokens: {} });

      await client.transfers({
        chain: CHAIN,
        asset: "SOL",
        addresses: [paid.toBase58(), unpaid.toBase58()],
        fromBlock: 1n,
        toBlock: 2n,
      });

      expect(signatures.calls).toBe(1);
    });

    test("one head answer serves every asset's tick, and a failure is not reused", async () => {
      let now = new Date("2026-01-01T00:00:00.000Z");
      const slot = counted(async () => 500);
      const block = counted(async () => ({ blockhash: BLOCK_HASH }));
      const connection = { getSlot: slot, getBlock: block } as unknown as Connection;
      const client = new SolanaDepositClient({ connection, tokens: {}, clock: { now: () => now } });

      const heads = await Promise.all([client.head(CHAIN), client.head(CHAIN), client.head(CHAIN)]);
      expect(heads[0]).toEqual({ number: 500n });
      expect(calls(connection, "getSlot")).toBe(1);
      // The head is a slot number; its hash is not worth a getBlock.
      expect(calls(connection, "getBlock")).toBe(0);

      now = new Date(now.getTime() + 2_001);
      await client.head(CHAIN);
      expect(calls(connection, "getSlot")).toBe(2);
    });
  });
});
