import { describe, expect, test } from "bun:test";
import { EvmChainClient } from "../src/client.ts";

const RPC_URLS = process.env.CHAIN_RPC_URLS;

describe.skipIf(RPC_URLS === undefined)("EvmChainClient", () => {
  const client = new EvmChainClient({
    rpcUrls: JSON.parse(RPC_URLS ?? "{}"),
    tokens: JSON.parse(process.env.CHAIN_ASSETS ?? "{}"),
  });

  test("reads a canonical block hash at a height", async () => {
    const head = await client.head("base-sepolia");
    expect(await client.blockHash("base-sepolia", head.number)).toBe(head.hash);
  });

  test("returns null above the head", async () => {
    const head = await client.head("base-sepolia");
    expect(await client.blockHash("base-sepolia", head.number + 1_000_000n)).toBeNull();
  });

  test("returns no logs for an address that never received anything", async () => {
    const head = await client.head("base-sepolia");
    const logs = await client.transfers({
      chain: "base-sepolia",
      asset: "USDC",
      fromBlock: head.number - 5n,
      toBlock: head.number,
      addresses: ["0x0000000000000000000000000000000000000001"],
    });
    expect(logs).toEqual([]);
  });
});

describe("EvmChainClient configuration", () => {
  test("refuses a chain with no RPC URL", async () => {
    const client = new EvmChainClient({ rpcUrls: {}, tokens: {} });
    await expect(client.head("base-sepolia")).rejects.toThrow(/RPC/i);
  });

  test("refuses an asset with no token address", async () => {
    const client = new EvmChainClient({
      rpcUrls: { "base-sepolia": "https://sepolia.base.org" },
      tokens: {},
    });
    await expect(
      client.transfers({
        chain: "base-sepolia",
        asset: "USDC",
        fromBlock: 1n,
        toBlock: 2n,
        addresses: ["0x0000000000000000000000000000000000000001"],
      }),
    ).rejects.toThrow(/token address/i);
  });
});

// ---------------------------------------------------------------------------
// Native deposits (#87)
//
// The chain's own currency moves without a contract and emits no log, so
// `eth_getLogs` matches nothing and block bodies are the only place it shows.
//
// Stubbed at the JSON-RPC layer rather than by reaching past a private field,
// so viem's own encoding and block formatting are exercised too.
// ---------------------------------------------------------------------------

const DEPOSIT = "0x9Ec7B9CcBd9FEb765eB0da23c166f5006A0B2343";
const OTHER = "0x0000000000000000000000000000000000000009";

const hex = (value: bigint) => `0x${value.toString(16)}`;

interface StubTx {
  readonly hash: string;
  readonly from: string;
  readonly to: string | null;
  readonly value: bigint;
}

function rpcBlock(number: bigint, transactions: readonly StubTx[]) {
  return {
    number: hex(number),
    hash: `0x${number.toString(16).padStart(64, "0")}`,
    parentHash: `0x${"00".repeat(32)}`,
    nonce: "0x0000000000000000",
    sha3Uncles: `0x${"00".repeat(32)}`,
    logsBloom: `0x${"00".repeat(256)}`,
    transactionsRoot: `0x${"00".repeat(32)}`,
    stateRoot: `0x${"00".repeat(32)}`,
    receiptsRoot: `0x${"00".repeat(32)}`,
    miner: "0x0000000000000000000000000000000000000000",
    difficulty: "0x0",
    totalDifficulty: "0x0",
    extraData: "0x",
    size: "0x0",
    gasLimit: "0x0",
    gasUsed: "0x0",
    timestamp: "0x0",
    uncles: [],
    baseFeePerGas: "0x0",
    transactions: transactions.map((tx, index) => ({
      hash: tx.hash,
      nonce: "0x0",
      blockHash: `0x${number.toString(16).padStart(64, "0")}`,
      blockNumber: hex(number),
      transactionIndex: hex(BigInt(index)),
      from: tx.from,
      to: tx.to,
      value: hex(tx.value),
      gas: "0x0",
      gasPrice: "0x0",
      input: "0x",
      v: "0x0",
      r: `0x${"00".repeat(32)}`,
      s: `0x${"00".repeat(32)}`,
      type: "0x0",
      chainId: "0x14a34",
    })),
  };
}

/** A JSON-RPC endpoint serving canned blocks, and nothing else. */
function stubRpc(blocks: ReadonlyMap<bigint, readonly StubTx[]>) {
  const seen: string[] = [];
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const body = (await request.json()) as { id: number; method: string; params: unknown[] };
      seen.push(body.method);

      if (body.method === "eth_getBlockByNumber") {
        const height = BigInt(body.params[0] as string);
        const transactions = blocks.get(height);
        const result = transactions === undefined ? null : rpcBlock(height, transactions);
        return Response.json({ jsonrpc: "2.0", id: body.id, result });
      }
      if (body.method === "eth_getLogs") {
        return Response.json({ jsonrpc: "2.0", id: body.id, result: [] });
      }
      return Response.json({ jsonrpc: "2.0", id: body.id, result: null });
    },
  });

  const client = new EvmChainClient({
    rpcUrls: { "base-sepolia": `http://localhost:${server.port}` },
    tokens: { "base-sepolia": { USDC: "0x036CbD53842c5426634e7929541eC2318f3dCF7e" } },
    nativeAssets: { "base-sepolia": "ETH" },
  });

  return { client, server, seen };
}

async function nativeTransfers(
  blocks: ReadonlyMap<bigint, readonly StubTx[]>,
  range: { from: bigint; to: bigint },
  asset: "ETH" | "USDC" = "ETH",
) {
  const { client, server, seen } = stubRpc(blocks);
  try {
    const transfers = await client.transfers({
      chain: "base-sepolia",
      asset,
      fromBlock: range.from,
      toBlock: range.to,
      addresses: [DEPOSIT],
    });
    return { transfers, seen };
  } finally {
    server.stop(true);
  }
}

describe("native transfers", () => {
  test("a native asset is read from block bodies, not from logs", async () => {
    const { transfers, seen } = await nativeTransfers(
      new Map([[10n, [{ hash: `0x${"aa".repeat(32)}`, from: OTHER, to: DEPOSIT, value: 5n }]]]),
      { from: 10n, to: 10n },
    );

    expect(transfers).toHaveLength(1);
    expect(transfers[0]?.amount).toBe(5n);
    expect(transfers[0]?.to).toBe(DEPOSIT.toLowerCase());
    expect(transfers[0]?.from).toBe(OTHER.toLowerCase());
    // The point of the change: no eth_getLogs call is made at all.
    expect(seen).not.toContain("eth_getLogs");
    expect(seen).toContain("eth_getBlockByNumber");
  });

  test("carries a log index that cannot collide with a real one", async () => {
    const { transfers } = await nativeTransfers(
      new Map([[10n, [{ hash: `0x${"aa".repeat(32)}`, from: OTHER, to: DEPOSIT, value: 5n }]]]),
      { from: 10n, to: 10n },
    );

    // Deposits are unique on (chain, txHash, logIndex). A real log index is
    // never negative, so an ERC-20 transfer sharing the transaction cannot
    // overwrite this one — which index 0 would have allowed.
    expect(transfers[0]?.logIndex).toBe(-1);
  });

  test("ignores unwatched recipients, zero value, and contract creations", async () => {
    const { transfers } = await nativeTransfers(
      new Map([
        [
          10n,
          [
            { hash: `0x${"aa".repeat(32)}`, from: OTHER, to: OTHER, value: 5n },
            { hash: `0x${"bb".repeat(32)}`, from: OTHER, to: DEPOSIT, value: 0n },
            { hash: `0x${"cc".repeat(32)}`, from: OTHER, to: null, value: 9n },
          ],
        ],
      ]),
      { from: 10n, to: 10n },
    );

    expect(transfers).toEqual([]);
  });

  test("scans every block in the range", async () => {
    const { transfers } = await nativeTransfers(
      new Map([
        [10n, [{ hash: `0x${"aa".repeat(32)}`, from: OTHER, to: DEPOSIT, value: 1n }]],
        [11n, []],
        [12n, [{ hash: `0x${"cc".repeat(32)}`, from: OTHER, to: DEPOSIT, value: 2n }]],
      ]),
      { from: 10n, to: 12n },
    );

    expect(transfers.map((transfer) => transfer.amount)).toEqual([1n, 2n]);
  });

  test("an ERC-20 asset still takes the log path", async () => {
    const { transfers, seen } = await nativeTransfers(new Map(), { from: 10n, to: 10n }, "USDC");

    expect(transfers).toEqual([]);
    expect(seen).toContain("eth_getLogs");
    expect(seen).not.toContain("eth_getBlockByNumber");
  });
});
