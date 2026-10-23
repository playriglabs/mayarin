import { beforeEach, describe, expect, test } from "bun:test";
import { type DomainEvent, FixedClock, ProviderError, ValidationError } from "@mayarin/shared";
import type { PaymentCompletionSink } from "../src/index.ts";
import { SettlementIndexer } from "../src/indexer.ts";
import {
  FakeChainClient,
  InMemorySettlementEventRepository,
  InMemoryWatcherCursorRepository,
} from "../testing/index.ts";

const NOW = new Date("2026-01-01T00:00:00.000Z");
const CHAIN = "base-sepolia" as const;
const ROUTER = "0x552008c0f6870c2f77e5cC1d2eb9bdff03e30Ea0";
const INTENT = "0xdeadbeef";

/** Narrows a published event's payload, which `DomainEvent` types as unknown. */
function payloadOf(event: DomainEvent | undefined): Record<string, unknown> {
  return (event?.payload ?? {}) as Record<string, unknown>;
}

/** Records what the engine was told, and whether it claimed the payment. */
class RecordingSink implements PaymentCompletionSink {
  readonly calls: { intentId: string; txHash: string }[] = [];
  matched = true;
  /** What the engine raises instead of answering, when set. */
  rejectsWith: Error | undefined;

  async complete(intentId: string, completion: { txHash: string }): Promise<boolean> {
    this.calls.push({ intentId, txHash: completion.txHash });
    if (this.rejectsWith !== undefined) throw this.rejectsWith;
    return this.matched;
  }
}

function setup(depth = 2) {
  const chain = new FakeChainClient();
  const settlements = new InMemorySettlementEventRepository();
  const cursors = new InMemoryWatcherCursorRepository();
  const sink = new RecordingSink();
  const published: DomainEvent[] = [];

  const indexer = new SettlementIndexer({
    client: chain,
    settlements,
    cursors,
    sink,
    clock: new FixedClock(NOW),
    policy: { depth, reorgWatchWindow: 2 },
    routers: { [CHAIN]: ROUTER },
    blockRange: 100,
    events: {
      publish: async (events) => {
        published.push(...events);
      },
    },
  });

  return { indexer, chain, settlements, cursors, sink, published };
}

describe("SettlementIndexer", () => {
  let harness: ReturnType<typeof setup>;

  beforeEach(() => {
    harness = setup();
  });

  describe("ingestion", () => {
    test("records a PaymentCompleted log and holds it below the depth", async () => {
      const { indexer, chain, sink } = harness;
      chain.settle({ intentId: INTENT }).mine();

      const result = await indexer.tick(CHAIN);

      expect(result.recorded).toBe(1);
      // One confirmation against a depth of two: recorded, and nothing told.
      expect(result.completed).toBe(0);
      expect(sink.calls).toEqual([]);
    });

    test("completes the payment once the log reaches the depth", async () => {
      const { indexer, chain, sink } = harness;
      chain.settle({ intentId: INTENT }).mine().mine();

      const result = await indexer.tick(CHAIN);

      expect(result.confirmed).toBe(1);
      expect(result.completed).toBe(1);
      expect(sink.calls).toHaveLength(1);
      expect(sink.calls[0]?.intentId).toBe(INTENT);
      expect(sink.calls[0]?.txHash).toMatch(/^0xstl/);
    });

    test("classifies a newly discovered settlement even beyond the reorg watch window", async () => {
      const { indexer, chain, sink } = harness;
      chain.settle({ intentId: INTENT });
      for (let block = 0; block < 10; block++) chain.mine();

      const result = await indexer.tick(CHAIN);

      expect(result.confirmed).toBe(1);
      expect(result.completed).toBe(1);
      expect(sink.calls).toHaveLength(1);
    });

    test("tells the engine exactly once, however many passes run", async () => {
      const { indexer, chain, sink } = harness;
      chain.settle({ intentId: INTENT }).mine().mine();

      await indexer.tick(CHAIN);
      await indexer.tick(CHAIN);
      await indexer.tick(CHAIN);

      expect(sink.calls).toHaveLength(1);
    });

    test("re-scanning a range records the same log once", async () => {
      // The cursor is written last, so a crash mid-pass re-scans. That is only
      // free because the key comes from the log envelope.
      const { indexer, chain, settlements, cursors } = harness;
      chain.settle({ intentId: INTENT }).mine().mine();

      await indexer.tick(CHAIN);
      // Rewind the cursor the way a crash before the final write would.
      await cursors.set(CHAIN, ROUTER, 0n);
      await indexer.tick(CHAIN);

      expect(await settlements.listProbable(CHAIN, 10)).toHaveLength(1);
    });

    test("advances the cursor so a later pass does not re-read the range", async () => {
      const { indexer, chain, cursors } = harness;
      chain.settle({ intentId: INTENT }).mine().mine();

      const result = await indexer.tick(CHAIN);

      expect(await cursors.get(CHAIN, ROUTER)).toBe(result.scannedTo);
    });

    test("keys the cursor by router, not by chain alone", async () => {
      // The wallet watcher's cursor for the same chain is keyed by asset. Both
      // share the table, so a collision would make one stream skip the other's
      // blocks.
      const { indexer, chain, cursors } = harness;
      chain.settle({ intentId: INTENT }).mine().mine();

      await indexer.tick(CHAIN);

      expect(await cursors.get(CHAIN, "USDC")).toBeNull();
      expect(await cursors.get(CHAIN, ROUTER)).not.toBeNull();
    });
  });

  describe("reorg", () => {
    test("orphans a settlement whose block left the canonical chain", async () => {
      const { indexer, chain, settlements } = harness;
      chain.settle({ intentId: INTENT }).mine();

      await indexer.tick(CHAIN);
      chain.reorg({ depth: 1 });
      const result = await indexer.tick(CHAIN);

      expect(result.orphaned).toBe(1);
      const [event] = await settlements.listProbable(CHAIN, 10);
      expect(event).toBeUndefined();
    });

    test("a reorg with no new blocks still reclassifies", async () => {
      // A reorg replaces blocks without advancing the head, so a pass that
      // skipped reclassification when there was nothing new to scan would be
      // blind to exactly the case this exists to catch.
      const { indexer, chain } = harness;
      chain.settle({ intentId: INTENT }).mine();
      await indexer.tick(CHAIN);

      chain.reorg({ depth: 1 });
      const result = await indexer.tick(CHAIN);

      expect(result.recorded).toBe(0);
      expect(result.orphaned).toBe(1);
    });

    test("never completes a payment from an orphaned settlement", async () => {
      const { indexer, chain, sink } = harness;
      chain.settle({ intentId: INTENT }).mine();

      await indexer.tick(CHAIN);
      chain.reorg({ depth: 1 });
      await indexer.tick(CHAIN);
      chain.mine().mine();
      await indexer.tick(CHAIN);

      expect(sink.calls).toEqual([]);
    });

    test("publishes a settlement reorged away after it settled a payment", async () => {
      // The case needing a human: the merchant has been paid on-chain and told
      // so, and SETTLED -> unsettled is not a legal transition.
      const { indexer, chain, published } = harness;
      chain.settle({ intentId: INTENT }).mine().mine();
      await indexer.tick(CHAIN);

      chain.reorg({ depth: 2 });
      await indexer.tick(CHAIN);

      const orphaned = published.find((event) => event.type === "chain.settlement.orphaned");
      expect(payloadOf(orphaned).wasCompleted).toBe(true);
      expect(payloadOf(orphaned).intentId).toBe(INTENT);
    });

    test("a settlement lost before it was acted on is not flagged as needing a human", async () => {
      const { indexer, chain, published } = harness;
      chain.settle({ intentId: INTENT }).mine();
      await indexer.tick(CHAIN);

      chain.reorg({ depth: 1 });
      await indexer.tick(CHAIN);

      const orphaned = published.find((event) => event.type === "chain.settlement.orphaned");
      expect(payloadOf(orphaned).wasCompleted).toBe(false);
    });
  });

  describe("reconciliation", () => {
    test("publishes a confirmed settlement that matches no known payment", async () => {
      // The router only emits PaymentCompleted for an order this backend
      // signed, so no match means the chain and the database disagree.
      const { indexer, chain, sink, published } = harness;
      sink.matched = false;
      chain.settle({ intentId: "0xunknown", settledAmount: 4_200n }).mine().mine();

      const result = await indexer.tick(CHAIN);

      expect(result.completed).toBe(0);
      expect(result.unmatched).toBe(1);
      const unmatched = published.find((event) => event.type === "chain.settlement.unmatched");
      expect(payloadOf(unmatched).intentId).toBe("0xunknown");
      expect(payloadOf(unmatched).settledAmount).toBe("4200");
    });

    test("does not retry an unmatched settlement every pass", async () => {
      // Repeating the lookup would bury the finding rather than surface it.
      const { indexer, chain, sink } = harness;
      sink.matched = false;
      chain.settle({ intentId: "0xunknown" }).mine().mine();

      await indexer.tick(CHAIN);
      await indexer.tick(CHAIN);

      expect(sink.calls).toHaveLength(1);
    });

    test("a refused settlement is marked, not retried every pass", async () => {
      // A sink that refuses non-retryably has decided about this log, and the
      // log will not change. Re-raising would stall the pass, and the pass
      // repeats every tick — one disagreeing record becoming a permanent error
      // loop that also blocks every settlement queued behind it.
      const { indexer, chain, sink } = harness;
      sink.rejectsWith = new ValidationError("not on the on-chain-contract path", {});
      chain.settle({ intentId: INTENT }).mine().mine();

      const result = await indexer.tick(CHAIN);
      await indexer.tick(CHAIN);

      expect(result.unmatched).toBe(1);
      expect(sink.calls).toHaveLength(1);
    });

    test("a retryable failure still propagates, so the next pass picks it up", async () => {
      const { indexer, chain, sink } = harness;
      sink.rejectsWith = new ProviderError("the node is unreachable");
      chain.settle({ intentId: INTENT }).mine().mine();

      expect(indexer.tick(CHAIN)).rejects.toThrow(/unreachable/);
    });

    test("carries the on-chain settled amounts, not the quoted ones", async () => {
      const { indexer, chain, settlements } = harness;
      chain
        .settle({
          intentId: INTENT,
          settledAmount: 2_990_000n,
          fee: 10_000n,
          refundAmount: 80_000n,
        })
        .mine();

      await indexer.tick(CHAIN);

      const [event] = await settlements.listProbable(CHAIN, 10);
      expect(event?.settledAmount).toBe(2_990_000n);
      expect(event?.fee).toBe(10_000n);
      expect(event?.refundAmount).toBe(80_000n);
    });
  });

  describe("configuration", () => {
    test("refuses to scan a chain with no deployed router", async () => {
      const { indexer } = harness;

      await expect(indexer.tick("base")).rejects.toThrow(/No PaymentRouter configured/);
    });
  });
});

describe("settlements read from their receipt", () => {
  /** A settlement mined well past where a 100-block scan from the start can reach. */
  async function farBehind() {
    const harness = setup();
    harness.chain.mine(500).settle({ intentId: INTENT }).mine().mine();
    const [log] = await harness.chain.settlements({
      chain: CHAIN,
      router: ROUTER,
      fromBlock: 0n,
      toBlock: 10_000n,
    });
    if (log === undefined) throw new Error("the fake chain recorded no settlement");
    return { ...harness, txHash: log.txHash };
  }

  test("completes a payment the range scan has not reached", async () => {
    const { indexer, settlements, sink, txHash } = await farBehind();
    settlements.expectTransaction(CHAIN, txHash, NOW);

    const result = await indexer.tick(CHAIN);

    // The scan covered blocks 1 to 100 and found nothing; the receipt did the work.
    expect(result.scannedTo).toBeLessThan(result.headNumber);
    expect(result.recorded).toBe(1);
    expect(sink.calls).toEqual([{ intentId: INTENT, txHash }]);
  });

  test("without a known transaction the same payment stays behind the scan", async () => {
    const { indexer, sink } = await farBehind();

    const result = await indexer.tick(CHAIN);

    expect(result.recorded).toBe(0);
    expect(sink.calls).toEqual([]);
  });

  test("reads a transaction once, then leaves it", async () => {
    const { indexer, settlements, sink, txHash } = await farBehind();
    settlements.expectTransaction(CHAIN, txHash, NOW);

    await indexer.tick(CHAIN);
    const second = await indexer.tick(CHAIN);

    expect(second.recorded).toBe(0);
    expect(sink.calls).toHaveLength(1);
  });

  test("a transaction with no settlement in it is asked about again, and costs nothing", async () => {
    const { indexer, settlements, sink } = await farBehind();
    settlements.expectTransaction(CHAIN, "0xnotmined", NOW);

    const first = await indexer.tick(CHAIN);
    const second = await indexer.tick(CHAIN);

    expect(first.recorded).toBe(0);
    expect(second.recorded).toBe(0);
    expect(sink.calls).toEqual([]);
  });

  test("ignores a transaction older than the lookback window", async () => {
    const { indexer, settlements, sink, txHash } = await farBehind();
    settlements.expectTransaction(CHAIN, txHash, new Date(NOW.getTime() - 8 * 24 * 60 * 60_000));

    await indexer.tick(CHAIN);

    expect(sink.calls).toEqual([]);
  });
});

describe("a receipt that cannot be read", () => {
  test("does not stop the scan, and is reported", async () => {
    const harness = setup();
    harness.chain.settle({ intentId: INTENT }).mine().mine();
    // The listing itself fails, the way a bad query or a dropped connection would.
    harness.settlements.listUnindexedTransactions = async () => {
      throw new Error("connection reset");
    };

    const result = await harness.indexer.tick(CHAIN);

    expect(result.receiptError).toBe("connection reset");
    // The ordinary scan still found, confirmed and completed the settlement.
    expect(result.recorded).toBe(1);
    expect(harness.sink.calls).toHaveLength(1);
  });

  test("a failing receipt read for one transaction is reported, not thrown", async () => {
    const harness = setup();
    harness.settlements.expectTransaction(CHAIN, "0xabc", NOW);
    harness.chain.settlementsInTransaction = async () => {
      throw new ProviderError("rate limited", {});
    };

    const result = await harness.indexer.tick(CHAIN);

    expect(result.receiptError).toBe("rate limited");
  });
});
