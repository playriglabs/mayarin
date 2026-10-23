import { describe, expect, test } from "bun:test";
import { InMemoryNonceSequencer, money } from "@mayarin/shared";
import { encodeAbiParameters, encodeEventTopics, getAddress, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { EvmTreasuryExecutionPort } from "../src/treasury-executor.ts";

/**
 * Whose address a failed deposit may be returned to when the payer named none.
 * Each test breaks one rule the sender has to meet.
 */

const OPERATOR = privateKeyToAccount(`0x${"11".repeat(32)}`);
const USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const DEPOSIT = "0x9ec7b9ccbd9feb765eb0da23c166f5006a0b2343";
const PAYER = "0x00000000000000000000000000000000000000a2";
const OTHER = "0x00000000000000000000000000000000000000a3";
const ROUTER = "0xEe7c5B5a9eeAf667A6EFb217A8a77534C873f7a9";
const FACTORY = "0x00000000000000000000000000000000000fAc70";
const TX = `0x${"ab".repeat(32)}`;
const TX_2 = `0x${"cd".repeat(32)}`;

const transferAbi = parseAbi([
  "event Transfer(address indexed from, address indexed to, uint256 value)",
]);

/** A USDC `Transfer(from, DEPOSIT)` log as a receipt carries it. */
function transferLog(from: string) {
  return {
    address: USDC,
    topics: encodeEventTopics({
      abi: transferAbi,
      eventName: "Transfer",
      args: { from: from as `0x${string}`, to: DEPOSIT },
    }),
    data: encodeAbiParameters([{ type: "uint256" }], [1_000_000n]),
    blockNumber: 10n,
    blockHash: `0x${"bb".repeat(32)}`,
    transactionHash: TX,
    transactionIndex: 0,
    logIndex: 0,
    removed: false,
  };
}

interface Chain {
  /** `from` of each transaction by hash. */
  readonly from: Record<string, string>;
  /** Who the Transfer log names as the sender, by hash. Defaults to `from`. */
  readonly logFrom?: Record<string, string>;
  readonly to?: string;
  readonly code?: Record<string, string>;
  readonly nonce?: Record<string, number>;
}

function port(
  chain: Chain,
  hashes: readonly string[],
  options: { senderMaxNonce?: number; noLookup?: boolean } = {},
) {
  const publicClient = {
    async getTransaction({ hash }: { hash: string }) {
      return { from: chain.from[hash], to: chain.to ?? DEPOSIT, hash };
    },
    async getTransactionReceipt({ hash }: { hash: string }) {
      return { logs: [transferLog(chain.logFrom?.[hash] ?? (chain.from[hash] as string))] };
    },
    async getCode({ address }: { address: string }) {
      return chain.code?.[address.toLowerCase()] ?? "0x";
    },
    async getTransactionCount({ address }: { address: string }) {
      return chain.nonce?.[address.toLowerCase()] ?? 12;
    },
  };
  return new EvmTreasuryExecutionPort({
    nonces: new InMemoryNonceSequencer(),
    clients: { "base-sepolia": { publicClient: publicClient as never, walletClient: {} as never } },
    account: OPERATOR,
    lookup: {
      async indexFor() {
        return 1;
      },
    },
    routes: {
      name: "none",
      async route() {
        throw new Error("unused");
      },
    },
    forwarderFactories: { "base-sepolia": FACTORY },
    paymentRouters: { "base-sepolia": ROUTER },
    tokens: { "base-sepolia": { USDC } },
    nativeAssets: { "base-sepolia": "ETH" },
    ...(options.noLookup
      ? {}
      : {
          depositTransactions: {
            async txHashesAt() {
              return hashes;
            },
          },
        }),
    ...(options.senderMaxNonce === undefined ? {} : { senderMaxNonce: options.senderMaxNonce }),
  });
}

const request = (asset: "USDC" | "ETH" = "USDC") => ({
  clearingTransactionId: "clr_1",
  chain: "base-sepolia" as const,
  depositAddress: DEPOSIT,
  amount: money(1_000_000n, asset),
});

describe("the sender of a failed deposit", () => {
  test("is vouched for when it sent the token itself, holds no code and is an ordinary account", async () => {
    const found = await port({ from: { [TX]: PAYER } }, [TX]).senderOf(request());

    expect(found).toEqual({ address: getAddress(PAYER) });
  });

  test("is refused when a contract made the transfer for someone else", async () => {
    // The transaction came from PAYER but the log names another account: a router,
    // a Safe, or an exchange withdrawal.
    const found = await port({ from: { [TX]: PAYER }, logFrom: { [TX]: OTHER } }, [TX]).senderOf(
      request(),
    );

    expect(found).toEqual({ refused: "the deposit was not sent by the transaction's own account" });
  });

  test("is refused when the account is a contract", async () => {
    const found = await port({ from: { [TX]: PAYER }, code: { [PAYER]: "0x6080" } }, [TX]).senderOf(
      request(),
    );

    expect(found).toEqual({ refused: "the sender is a contract" });
  });

  test("is refused when the account is delegated to code", async () => {
    const found = await port({ from: { [TX]: PAYER }, code: { [PAYER]: "0xef0100abcdef" } }, [
      TX,
    ]).senderOf(request());

    expect(found).toEqual({ refused: "the sender is a contract" });
  });

  test("is refused when the account has sent as many transactions as an exchange", async () => {
    const found = await port({ from: { [TX]: PAYER }, nonce: { [PAYER]: 350_000 } }, [TX]).senderOf(
      request(),
    );

    expect(found).toEqual({
      refused: "the sender has sent 350000 transactions, like an exchange or a service",
    });
  });

  test("the nonce limit is configurable", async () => {
    const chain = { from: { [TX]: PAYER }, nonce: { [PAYER]: 50 } };

    expect(await port(chain, [TX], { senderMaxNonce: 10 }).senderOf(request())).toMatchObject({
      refused: expect.any(String),
    });
    expect(await port(chain, [TX], { senderMaxNonce: 100 }).senderOf(request())).toMatchObject({
      address: expect.any(String),
    });
  });

  test("is refused when the deposit came from more than one account", async () => {
    const found = await port({ from: { [TX]: PAYER, [TX_2]: OTHER } }, [TX, TX_2]).senderOf(
      request(),
    );

    expect(found).toEqual({ refused: "the deposit came from more than one account" });
  });

  test("the same account sending twice is one sender", async () => {
    const found = await port({ from: { [TX]: PAYER, [TX_2]: PAYER } }, [TX, TX_2]).senderOf(
      request(),
    );

    expect(found).toMatchObject({ address: expect.any(String) });
  });

  test("a native deposit sent straight to the address is read from the transaction", async () => {
    const found = await port({ from: { [TX]: PAYER } }, [TX]).senderOf(request("ETH"));

    expect(found).toEqual({ address: getAddress(PAYER) });
  });

  test("a native deposit that reached the address through a contract is refused", async () => {
    const found = await port({ from: { [TX]: PAYER }, to: ROUTER }, [TX]).senderOf(request("ETH"));

    expect(found).toEqual({ refused: "the deposit was not a direct transfer" });
  });

  test("is refused when the deposit's transaction is not known", async () => {
    expect(await port({ from: {} }, []).senderOf(request())).toEqual({
      refused: "no recorded deposit transaction",
    });
    expect(
      await port({ from: { [TX]: PAYER } }, [TX], { noLookup: true }).senderOf(request()),
    ).toEqual({
      refused: "no way to find the deposit's transaction",
    });
  });
});
