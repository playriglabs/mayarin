import { describe, expect, test } from "bun:test";
import { FakeChainClient } from "../src/fake-chain.ts";

const CHAIN = "base-sepolia" as const;
const ALICE = "0x0000000000000000000000000000000000000a11";
const BOB = "0x0000000000000000000000000000000000000b0b";

describe("FakeChainClient", () => {
  test("starts at block zero", async () => {
    const chain = new FakeChainClient();
    expect((await chain.head(CHAIN)).number).toBe(0n);
  });

  test("mining advances the head and gives each block a distinct hash", async () => {
    const chain = new FakeChainClient();
    chain.mine(3);
    const head = await chain.head(CHAIN);
    expect(head.number).toBe(3n);
    expect(await chain.blockHash(CHAIN, 1n)).not.toBe(await chain.blockHash(CHAIN, 2n));
  });

  test("a transfer lands in the next mined block", async () => {
    const chain = new FakeChainClient();
    chain.transfer({ asset: "USDC", to: ALICE, amount: 1_000_000n });
    chain.mine(1);

    const logs = await chain.transfers({
      chain: CHAIN,
      asset: "USDC",
      fromBlock: 1n,
      toBlock: 1n,
      addresses: [ALICE],
    });

    expect(logs).toHaveLength(1);
    expect(logs[0]?.amount).toBe(1_000_000n);
    expect(logs[0]?.blockNumber).toBe(1n);
  });

  test("filters by recipient", async () => {
    const chain = new FakeChainClient();
    chain.transfer({ asset: "USDC", to: BOB, amount: 5n });
    chain.mine(1);

    const logs = await chain.transfers({
      chain: CHAIN,
      asset: "USDC",
      fromBlock: 1n,
      toBlock: 1n,
      addresses: [ALICE],
    });

    expect(logs).toHaveLength(0);
  });

  test("filters by asset", async () => {
    const chain = new FakeChainClient();
    chain.transfer({ asset: "USDT", to: ALICE, amount: 5n });
    chain.mine(1);

    const logs = await chain.transfers({
      chain: CHAIN,
      asset: "USDC",
      fromBlock: 1n,
      toBlock: 1n,
      addresses: [ALICE],
    });

    expect(logs).toHaveLength(0);
  });

  test("a reorg replaces block hashes from the fork point", async () => {
    const chain = new FakeChainClient();
    chain.mine(5);
    const before = await chain.blockHash(CHAIN, 5n);
    const untouched = await chain.blockHash(CHAIN, 3n);

    chain.reorg({ depth: 2 });

    expect(await chain.blockHash(CHAIN, 5n)).not.toBe(before);
    expect(await chain.blockHash(CHAIN, 3n)).toBe(untouched);
    expect((await chain.head(CHAIN)).number).toBe(5n);
  });

  test("a reorg drops the transfers that were in the replaced blocks", async () => {
    const chain = new FakeChainClient();
    chain.mine(3);
    chain.transfer({ asset: "USDC", to: ALICE, amount: 7n });
    chain.mine(1);

    chain.reorg({ depth: 1 });

    const logs = await chain.transfers({
      chain: CHAIN,
      asset: "USDC",
      fromBlock: 1n,
      toBlock: 4n,
      addresses: [ALICE],
    });
    expect(logs).toHaveLength(0);
  });

  test("returns null for a height above the head", async () => {
    const chain = new FakeChainClient();
    chain.mine(1);
    expect(await chain.blockHash(CHAIN, 9n)).toBeNull();
  });
});
