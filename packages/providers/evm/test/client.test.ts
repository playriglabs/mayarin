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
