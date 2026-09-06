import { describe, expect, test } from "bun:test";
import type { ChainId } from "@mayarin/chain";
import type { FetchLike } from "../src/graphql.ts";
import { SubgraphSettlementSource } from "../src/settlement-source.ts";

const CHAIN: ChainId = "base-sepolia";
const ENDPOINT = "https://example.test/base";
const ROUTER = "0xee7c5b5a9eeaf667a6efb217a8a77534c873f7a9";

function settlementRow(blockNumber: number, logIndex: number) {
  return {
    intentId: `0x${"11".repeat(32)}`,
    merchantSafe: "0x0000000000000000000000000000000000000001",
    settledAmount: "1961517",
    fee: "11840",
    refundAmount: "0",
    blockNumber: String(blockNumber),
    blockHash: `0x${"ab".repeat(32)}`,
    logIndex,
    transactionHash: `0x${"cd".repeat(32)}`,
  };
}

const HEALTHY_META = { block: { number: 46374607 }, hasIndexingErrors: false };

/**
 * Answers each query by its operation, and records what it was asked.
 *
 * Both queries select `_meta` now, so the settlements query is told apart by
 * the entity it selects, not by the field they share.
 */
function fetchAnswering(answers: {
  settlements?: readonly (readonly unknown[])[];
  meta?: unknown;
  status?: number;
}) {
  const variables: Record<string, unknown>[] = [];
  const operations: string[] = [];
  let page = 0;
  const fetch: FetchLike = async (_url, init) => {
    const body = JSON.parse(String(init.body)) as {
      query: string;
      variables?: Record<string, unknown>;
    };
    if (body.variables !== undefined) variables.push(body.variables);

    const isSettlements = body.query.includes("settlements(");
    operations.push(isSettlements ? "settlements" : "meta");

    const meta = "meta" in answers ? answers.meta : HEALTHY_META;
    const data = isSettlements
      ? { settlements: answers.settlements?.[page++] ?? [], _meta: meta }
      : { _meta: meta };

    return new Response(JSON.stringify({ data }), {
      status: answers.status ?? 200,
      headers: { "content-type": "application/json" },
    });
  };
  return { fetch, variables, operations };
}

function sourceWith(fetch: FetchLike, router = ROUTER) {
  return new SubgraphSettlementSource({
    endpoints: { [CHAIN]: ENDPOINT },
    routers: { [CHAIN]: router },
    fetch,
  });
}

describe("SubgraphSettlementSource", () => {
  test("maps a settlement into the shape the indexer keys on", async () => {
    const { fetch, variables } = fetchAnswering({ settlements: [[settlementRow(45986017, 3)]] });

    const logs = await sourceWith(fetch).settlements({
      chain: CHAIN,
      router: ROUTER,
      fromBlock: 45000000n,
      toBlock: 46000000n,
    });

    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      chain: CHAIN,
      logIndex: 3,
      blockNumber: 45986017n,
      settledAmount: 1961517n,
      fee: 11840n,
      refundAmount: 0n,
    });
    expect(variables[0]).toMatchObject({ from: "45000000", to: "46000000", skip: 0 });
  });

  test("matches the router case-insensitively, and refuses another one", async () => {
    const { fetch } = fetchAnswering({ settlements: [[]] });

    await expect(
      sourceWith(fetch, ROUTER.toUpperCase().replace("0X", "0x")).settlements({
        chain: CHAIN,
        router: ROUTER,
        fromBlock: 1n,
        toBlock: 2n,
      }),
    ).resolves.toEqual([]);

    await expect(
      sourceWith(fetch, "0x0000000000000000000000000000000000000009").settlements({
        chain: CHAIN,
        router: ROUTER,
        fromBlock: 1n,
        toBlock: 2n,
      }),
    ).rejects.toThrow(/indexes 0x0000000000000000000000000000000000000009, not/);
  });

  test("a chain with no endpoint is a configuration error, not an empty range", async () => {
    const { fetch } = fetchAnswering({ settlements: [[]] });
    const source = new SubgraphSettlementSource({ endpoints: {}, routers: {}, fetch });

    await expect(
      source.settlements({ chain: CHAIN, router: ROUTER, fromBlock: 1n, toBlock: 2n }),
    ).rejects.toThrow(/no subgraph endpoint configured/);
  });

  test("reports how far it has indexed", async () => {
    const { fetch } = fetchAnswering({
      meta: { block: { number: 46374607 }, hasIndexingErrors: false },
    });

    await expect(sourceWith(fetch).indexedHead(CHAIN)).resolves.toBe(46374607n);
  });

  test("a deployment that has indexed nothing reports zero, not unknown", async () => {
    const { fetch } = fetchAnswering({ meta: null });

    await expect(sourceWith(fetch).indexedHead(CHAIN)).resolves.toBe(0n);
  });

  test("refuses to report progress for a deployment stuck on an indexing error", async () => {
    const { fetch } = fetchAnswering({ meta: { block: { number: 100 }, hasIndexingErrors: true } });

    await expect(sourceWith(fetch).indexedHead(CHAIN)).rejects.toThrow(/indexing errors/);
  });

  test("pages until a short page ends it", async () => {
    const full = Array.from({ length: 1000 }, (_, index) => settlementRow(45000000 + index, 0));
    const { fetch, variables } = fetchAnswering({
      settlements: [full, [settlementRow(45001000, 1)]],
    });

    const logs = await sourceWith(fetch).settlements({
      chain: CHAIN,
      router: ROUTER,
      fromBlock: 1n,
      toBlock: 46000000n,
    });

    expect(logs).toHaveLength(1001);
    expect(variables.map((one) => one.skip)).toEqual([0, 1000]);
  });

  test("reuses the head the scan already paid for, then asks again", async () => {
    const { fetch, operations } = fetchAnswering({ settlements: [[]] });
    const source = sourceWith(fetch);
    const range = { chain: CHAIN, router: ROUTER, fromBlock: 1n, toBlock: 2n } as const;

    await source.settlements(range);
    // The `_meta` that rode along with the logs, not a second billed query.
    await expect(source.indexedHead(CHAIN)).resolves.toBe(46374607n);
    expect(operations).toEqual(["settlements"]);

    // Consumed once: a head that stayed would freeze the indexer's cursor at a
    // height it has already scanned.
    await expect(source.indexedHead(CHAIN)).resolves.toBe(46374607n);
    expect(operations).toEqual(["settlements", "meta"]);
  });

  test("a scan onto a broken deployment fails rather than banking its head", async () => {
    const { fetch } = fetchAnswering({
      settlements: [[]],
      meta: { block: { number: 100 }, hasIndexingErrors: true },
    });

    await expect(
      sourceWith(fetch).settlements({ chain: CHAIN, router: ROUTER, fromBlock: 1n, toBlock: 2n }),
    ).rejects.toThrow(/indexing errors/);
  });
});
