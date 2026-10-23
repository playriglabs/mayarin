import { describe, expect, test } from "bun:test";
import { paymentRouterAbi } from "@mayarin/contracts";
import { encodeAbiParameters, encodeEventTopics } from "viem";
import { EvmChainClient } from "../src/client.ts";

const RPC_URLS = process.env.CHAIN_RPC_URLS;
/** Live RPC tests run only on request: a `.env` full of RPC URLs must not tie `bun test` to a network. */
const LIVE_RPC = RPC_URLS !== undefined && process.env.TEST_LIVE_RPC === "1";

describe.skipIf(!LIVE_RPC)("EvmChainClient", () => {
  const client = new EvmChainClient({
    rpcUrls: JSON.parse(RPC_URLS ?? "{}"),
    tokens: JSON.parse(process.env.CHAIN_ASSETS ?? "{}"),
  });

  test("reads a canonical block hash at a height", async () => {
    const head = await client.head("base-sepolia");
    expect(await client.blockHash("base-sepolia", head.number)).toBe(head.hash ?? null);
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
// Settlement indexing
//
// Keep this test at the JSON-RPC boundary so it covers the real event filter,
// windowing, ABI decode, and domain mapping in one pass.
// ---------------------------------------------------------------------------

const ROUTER = "0x552008c0f6870c2f77e5cc1d2eb9bdff03e30ea0";
const MERCHANT = "0x9ec7b9ccbd9feb765eb0da23c166f5006a0b2343";
const REFUND_TO = "0x0000000000000000000000000000000000000009";
const INPUT_ASSET = "0x0000000000000000000000000000000000000010";
const SETTLEMENT_ASSET = "0x036cbd53842c5426634e7929541ec2318f3dcf7e";
const INTENT_ID = `0x${"ab".repeat(32)}` as const;

describe("EVM settlement source", () => {
  test("reads PaymentCompleted directly from RPC in provider-sized windows", async () => {
    const requested: { fromBlock: string; toBlock: string; address: string }[] = [];
    const topics = encodeEventTopics({
      abi: paymentRouterAbi,
      eventName: "PaymentCompleted",
      args: { intentId: INTENT_ID, merchantSafe: MERCHANT, refundTo: REFUND_TO },
    });
    const data = encodeAbiParameters(
      [
        { type: "address" },
        { type: "address" },
        { type: "uint256" },
        { type: "uint256" },
        { type: "uint256" },
        { type: "uint256" },
        { type: "uint256" },
      ],
      [INPUT_ASSET, SETTLEMENT_ASSET, 3_100_000n, 2_990_000n, 10_000n, 100_000n, 2_000n],
    );
    const server = Bun.serve({
      port: 0,
      async fetch(request) {
        const body = (await request.json()) as {
          id: number;
          method: string;
          params: [{ fromBlock: string; toBlock: string; address: string }];
        };
        if (body.method !== "eth_getLogs") {
          return Response.json({ jsonrpc: "2.0", id: body.id, result: null });
        }

        const filter = body.params[0];
        requested.push(filter);
        const result =
          filter.fromBlock === "0xa"
            ? [
                {
                  address: ROUTER,
                  topics,
                  data,
                  blockNumber: "0xb",
                  blockHash: `0x${"bb".repeat(32)}`,
                  transactionHash: `0x${"cc".repeat(32)}`,
                  transactionIndex: "0x2",
                  logIndex: "0x3",
                  removed: false,
                },
              ]
            : [];
        return Response.json({ jsonrpc: "2.0", id: body.id, result });
      },
    });

    try {
      const client = new EvmChainClient({
        rpcUrls: { "base-sepolia": `http://localhost:${server.port}` },
        tokens: { "base-sepolia": { USDC: SETTLEMENT_ASSET } },
        logRange: 2,
      });
      const settlements = await client.settlements({
        chain: "base-sepolia",
        router: ROUTER,
        fromBlock: 10n,
        toBlock: 13n,
      });

      expect(requested.map(({ fromBlock, toBlock }) => ({ fromBlock, toBlock }))).toEqual([
        { fromBlock: "0xa", toBlock: "0xb" },
        { fromBlock: "0xc", toBlock: "0xd" },
      ]);
      expect(requested.every(({ address }) => address.toLowerCase() === ROUTER.toLowerCase())).toBe(
        true,
      );
      expect(settlements).toEqual([
        {
          chain: "base-sepolia",
          txHash: `0x${"cc".repeat(32)}`,
          logIndex: 3,
          blockNumber: 11n,
          blockHash: `0x${"bb".repeat(32)}`,
          intentId: INTENT_ID,
          merchantSafe: MERCHANT.toLowerCase(),
          settledAmount: 2_990_000n,
          fee: 10_000n,
          refundAmount: 100_000n,
        },
      ]);
    } finally {
      server.stop(true);
    }
  });

  test("a per-chain log range replaces the default window for that chain only", async () => {
    const requested: { fromBlock: string; toBlock: string }[] = [];
    const server = Bun.serve({
      port: 0,
      fetch: async (request) => {
        const body = (await request.json()) as {
          id: number;
          method: string;
          params: [{ fromBlock: string; toBlock: string }];
        };
        if (body.method === "eth_getLogs") requested.push(body.params[0]);
        return Response.json({ jsonrpc: "2.0", id: body.id, result: [] });
      },
    });

    try {
      const url = `http://localhost:${server.port}`;
      const client = new EvmChainClient({
        rpcUrls: { "base-sepolia": url, "arbitrum-sepolia": url },
        tokens: {},
        logRange: 2,
        logRanges: { "arbitrum-sepolia": 100 },
      });

      await client.settlements({
        chain: "arbitrum-sepolia",
        router: ROUTER,
        fromBlock: 10n,
        toBlock: 13n,
      });
      expect(requested).toHaveLength(1);

      requested.length = 0;
      await client.settlements({
        chain: "base-sepolia",
        router: ROUTER,
        fromBlock: 10n,
        toBlock: 13n,
      });
      expect(requested).toHaveLength(2);
    } finally {
      server.stop(true);
    }
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
    idleTimeout: 30,
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

// ---------------------------------------------------------------------------
// Arc USDC deposits
//
// A wallet sends Arc USDC as the gas coin, a plain value transfer that writes a
// `Transfer` only on the 18-decimal native view. The token-log scan never saw
// one (tx 0xa092…cbca6 on Arc testnet, 11 September).
// ---------------------------------------------------------------------------

const ARC_NATIVE_VIEW = "0xfffffffffffffffffffffffffffffffffffffffe";
const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const topic = (address: string) => `0x${address.slice(2).toLowerCase().padStart(64, "0")}`;

describe("Arc USDC transfers", () => {
  test("are read from the native view and scaled to six decimals", async () => {
    const requested: { address: string }[] = [];
    const server = Bun.serve({
      port: 0,
      async fetch(request) {
        const body = (await request.json()) as { id: number; method: string; params: unknown[] };
        if (body.method !== "eth_getLogs") {
          return Response.json({ jsonrpc: "2.0", id: body.id, result: null });
        }
        requested.push(body.params[0] as { address: string });
        return Response.json({
          jsonrpc: "2.0",
          id: body.id,
          result: [
            {
              address: ARC_NATIVE_VIEW,
              topics: [TRANSFER_TOPIC, topic(OTHER), topic(DEPOSIT)],
              data: `0x${9_602_272_000_000_000_000n.toString(16).padStart(64, "0")}`,
              blockNumber: hex(10n),
              blockHash: `0x${"0a".repeat(32)}`,
              transactionHash: `0x${"aa".repeat(32)}`,
              transactionIndex: "0x7",
              logIndex: "0xc",
              removed: false,
            },
          ],
        });
      },
    });

    try {
      const client = new EvmChainClient({
        rpcUrls: { "arc-testnet": `http://localhost:${server.port}` },
        tokens: { "arc-testnet": { USDC: "0x3600000000000000000000000000000000000000" } },
      });
      const transfers = await client.transfers({
        chain: "arc-testnet",
        asset: "USDC",
        fromBlock: 10n,
        toBlock: 10n,
        addresses: [DEPOSIT],
      });

      expect(requested[0]?.address.toLowerCase()).toBe(ARC_NATIVE_VIEW);
      expect(transfers).toHaveLength(1);
      expect(transfers[0]?.amount).toBe(9_602_272n);
      expect(transfers[0]?.logIndex).toBe(12);
    } finally {
      server.stop(true);
    }
  });
});

describe("EVM transfers on a chain whose stablecoins carry 18 decimals", () => {
  const BSC_USDT = "0x0000000000000000000000000000000000000b57";
  const DEPOSIT = "0x0000000000000000000000000000000000000d01";
  const PAYER = "0x0000000000000000000000000000000000000a11";

  test("reports a deposit in the asset's own minor units", async () => {
    const topics = encodeEventTopics({
      abi: [
        {
          type: "event",
          name: "Transfer",
          inputs: [
            { type: "address", name: "from", indexed: true },
            { type: "address", name: "to", indexed: true },
            { type: "uint256", name: "value" },
          ],
        },
      ],
      eventName: "Transfer",
      args: { from: PAYER, to: DEPOSIT },
    });
    const server = Bun.serve({
      port: 0,
      async fetch(request) {
        const body = (await request.json()) as { id: number; method: string };
        const result =
          body.method === "eth_getLogs"
            ? [
                {
                  address: BSC_USDT,
                  topics,
                  // 1.5 tokens at 18 decimals.
                  data: encodeAbiParameters([{ type: "uint256" }], [15n * 10n ** 17n]),
                  blockNumber: "0xb",
                  blockHash: `0x${"bb".repeat(32)}`,
                  transactionHash: `0x${"cc".repeat(32)}`,
                  transactionIndex: "0x0",
                  logIndex: "0x0",
                  removed: false,
                },
              ]
            : null;
        return Response.json({ jsonrpc: "2.0", id: body.id, result });
      },
    });

    try {
      const client = new EvmChainClient({
        rpcUrls: { "bsc-testnet": `http://localhost:${server.port}` },
        tokens: { "bsc-testnet": { USDT: BSC_USDT } },
      });
      const logs = await client.transfers({
        chain: "bsc-testnet",
        asset: "USDT",
        fromBlock: 10n,
        toBlock: 12n,
        addresses: [DEPOSIT],
      });
      expect(logs.map((log) => log.amount)).toEqual([1_500_000n]);
    } finally {
      server.stop(true);
    }
  });
});

/** One PaymentCompleted that settled in `settlementToken`, served over JSON-RPC. */
async function settlementsOf(
  chain: "ethereum" | "base-sepolia",
  tokens: Record<string, string>,
  settlementToken: string,
  amounts: { settled: bigint; fee: bigint; refund: bigint },
) {
  const topics = encodeEventTopics({
    abi: paymentRouterAbi,
    eventName: "PaymentCompleted",
    args: { intentId: INTENT_ID, merchantSafe: MERCHANT, refundTo: REFUND_TO },
  });
  const data = encodeAbiParameters(
    [
      { type: "address" },
      { type: "address" },
      { type: "uint256" },
      { type: "uint256" },
      { type: "uint256" },
      { type: "uint256" },
      { type: "uint256" },
    ],
    [
      INPUT_ASSET,
      settlementToken as `0x${string}`,
      amounts.settled + amounts.fee + amounts.refund,
      amounts.settled,
      amounts.fee,
      amounts.refund,
      2_000n,
    ],
  );
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const body = (await request.json()) as { id: number; method: string };
      const result =
        body.method === "eth_getLogs"
          ? [
              {
                address: ROUTER,
                topics,
                data,
                blockNumber: "0xb",
                blockHash: `0x${"bb".repeat(32)}`,
                transactionHash: `0x${"cc".repeat(32)}`,
                transactionIndex: "0x2",
                logIndex: "0x3",
                removed: false,
              },
            ]
          : null;
      return Response.json({ jsonrpc: "2.0", id: body.id, result });
    },
  });
  try {
    const client = new EvmChainClient({
      rpcUrls: { [chain]: `http://localhost:${server.port}` },
      tokens: { [chain]: tokens },
      logRange: 10,
    });
    return await client.settlements({ chain, router: ROUTER, fromBlock: 10n, toBlock: 11n });
  } finally {
    server.stop(true);
  }
}

describe("EVM settlement amounts follow the asset the log names", () => {
  const DAI = "0x6b175474e89094c44da98b954eedeac495271d0f";
  const USDC = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48";

  test("a 6-decimal USDC settlement on Ethereum is read as it stands", async () => {
    const [settlement] = await settlementsOf("ethereum", { USDC, DAI }, USDC, {
      settled: 2_990_000n,
      fee: 10_000n,
      refund: 100_000n,
    });
    expect([settlement?.settledAmount, settlement?.fee, settlement?.refundAmount]).toEqual([
      2_990_000n,
      10_000n,
      100_000n,
    ]);
  });

  test("an 18-decimal DAI settlement on the same chain is scaled down to the domain's 6", async () => {
    const [settlement] = await settlementsOf("ethereum", { USDC, DAI }, DAI, {
      settled: 2_990_000n * 10n ** 12n,
      fee: 10_000n * 10n ** 12n,
      refund: 100_000n * 10n ** 12n,
    });
    expect([settlement?.settledAmount, settlement?.fee, settlement?.refundAmount]).toEqual([
      2_990_000n,
      10_000n,
      100_000n,
    ]);
  });

  test("a settlement in a token the deployment does not know is refused, not guessed", async () => {
    await expect(
      settlementsOf("ethereum", { USDC }, DAI, { settled: 1n, fee: 0n, refund: 0n }),
    ).rejects.toThrow(/not a configured token/);
  });
});

describe("EVM settlements read from a receipt", () => {
  const TX = `0x${"cc".repeat(32)}`;
  const USDC = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48";

  const completed = () => {
    const topics = encodeEventTopics({
      abi: paymentRouterAbi,
      eventName: "PaymentCompleted",
      args: { intentId: INTENT_ID, merchantSafe: MERCHANT, refundTo: REFUND_TO },
    });
    const data = encodeAbiParameters(
      [
        { type: "address" },
        { type: "address" },
        { type: "uint256" },
        { type: "uint256" },
        { type: "uint256" },
        { type: "uint256" },
        { type: "uint256" },
      ],
      [INPUT_ASSET, USDC as `0x${string}`, 3_100_000n, 2_990_000n, 10_000n, 100_000n, 2_000n],
    );
    return { topics, data };
  };

  /** Serves one receipt (or none) for any hash, and counts the calls made. */
  async function readReceipt(receipt: Record<string, unknown> | null) {
    const methods: string[] = [];
    const server = Bun.serve({
      port: 0,
      async fetch(request) {
        const body = (await request.json()) as { id: number; method: string };
        methods.push(body.method);
        return Response.json({ jsonrpc: "2.0", id: body.id, result: receipt });
      },
    });
    try {
      const client = new EvmChainClient({
        rpcUrls: { ethereum: `http://localhost:${server.port}` },
        tokens: { ethereum: { USDC } },
        logRange: 10,
      });
      const logs = await client.settlementsInTransaction({
        chain: "ethereum",
        router: ROUTER,
        txHash: TX,
      });
      return { logs, methods };
    } finally {
      server.stop(true);
    }
  }

  const receiptWith = (logs: unknown[], status = "0x1") => ({
    blockHash: `0x${"bb".repeat(32)}`,
    blockNumber: "0xb",
    contractAddress: null,
    cumulativeGasUsed: "0x5208",
    effectiveGasPrice: "0x1",
    from: MERCHANT,
    gasUsed: "0x5208",
    logs,
    logsBloom: `0x${"00".repeat(256)}`,
    status,
    to: ROUTER,
    transactionHash: TX,
    transactionIndex: "0x2",
    type: "0x2",
  });

  const routerLog = () => ({
    address: ROUTER,
    ...completed(),
    blockNumber: "0xb",
    blockHash: `0x${"bb".repeat(32)}`,
    transactionHash: TX,
    transactionIndex: "0x2",
    logIndex: "0x3",
    removed: false,
  });

  test("reads the router's PaymentCompleted from one receipt call, with no log scan", async () => {
    const { logs, methods } = await readReceipt(receiptWith([routerLog()]));

    expect(methods).toEqual(["eth_getTransactionReceipt"]);
    expect(logs).toEqual([
      {
        chain: "ethereum",
        txHash: TX,
        logIndex: 3,
        blockNumber: 11n,
        blockHash: `0x${"bb".repeat(32)}`,
        intentId: INTENT_ID,
        merchantSafe: MERCHANT.toLowerCase(),
        settledAmount: 2_990_000n,
        fee: 10_000n,
        refundAmount: 100_000n,
      },
    ]);
  });

  test("ignores the same event emitted by another contract", async () => {
    const stranger = { ...routerLog(), address: "0x000000000000000000000000000000000000dEaD" };

    expect((await readReceipt(receiptWith([stranger]))).logs).toEqual([]);
  });

  test("a reverted transaction has no settlement", async () => {
    expect((await readReceipt(receiptWith([routerLog()], "0x0"))).logs).toEqual([]);
  });

  test("a transaction not mined yet has none either", async () => {
    expect((await readReceipt(null)).logs).toEqual([]);
  });
});
