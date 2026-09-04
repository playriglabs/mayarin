import { beforeEach, describe, expect, test } from "bun:test";
import { type DomainEvent, FixedClock, ProviderError, ValidationError } from "@mayarin/shared";
import type {
  PaymentCompletionSink,
  SettlementLog,
  SettlementQuery,
  SettlementSource,
} from "../src/index.ts";
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

  describe("a source that indexes on its own behalf", () => {
    /** A source wrapping the fake chain, but only as far as it claims to have read. */
    function sourceAt(chain: FakeChainClient, indexedTo: bigint | undefined) {
      const asked: { fromBlock: bigint; toBlock: bigint }[] = [];
      const source = {
        async settlements(query: SettlementQuery): Promise<SettlementLog[]> {
          asked.push({ fromBlock: query.fromBlock, toBlock: query.toBlock });
          return await chain.settlements(query);
        },
        async indexedHead(): Promise<bigint | undefined> {
          return indexedTo;
        },
      };
      return { source, asked };
    }

    function indexerReading(source: SettlementSource, chain: FakeChainClient) {
      return new SettlementIndexer({
        client: chain,
        source,
        settlements: harness.settlements,
        cursors: harness.cursors,
        sink: harness.sink,
        clock: new FixedClock(NOW),
        policy: { depth: 2, reorgWatchWindow: 2 },
        routers: { [CHAIN]: ROUTER },
        blockRange: 100,
      });
    }

    test("never scans past what the source has indexed", async () => {
      harness.chain.mine(10);
      const { source, asked } = sourceAt(harness.chain, 4n);

      const result = await indexerReading(source, harness.chain).tick(CHAIN);

      expect(asked).toEqual([{ fromBlock: 1n, toBlock: 4n }]);
      expect(result.scannedTo).toBe(4n);
      expect(result.sourceIndexedTo).toBe(4n);
      // The cursor stops with it, so the blocks the source has not reached are
      // scanned by the next pass rather than skipped by this one.
      expect(await harness.cursors.get(CHAIN, ROUTER)).toBe(4n);
    });

    test("scans nothing at all while the source is behind the cursor", async () => {
      harness.chain.mine(10);
      await harness.cursors.set(CHAIN, ROUTER, 6n);
      const { source, asked } = sourceAt(harness.chain, 5n);

      const result = await indexerReading(source, harness.chain).tick(CHAIN);

      expect(asked).toEqual([]);
      expect(result.recorded).toBe(0);
      expect(await harness.cursors.get(CHAIN, ROUTER)).toBe(6n);
    });

    test("a source that cannot lag is not clamped", async () => {
      harness.chain.mine(10);
      const { source, asked } = sourceAt(harness.chain, undefined);

      const result = await indexerReading(source, harness.chain).tick(CHAIN);

      expect(asked).toEqual([{ fromBlock: 1n, toBlock: 10n }]);
      expect(result.sourceIndexedTo).toBeUndefined();
    });
  });

  describe("configuration", () => {
    test("refuses to scan a chain with no deployed router", async () => {
      const { indexer } = harness;

      await expect(indexer.tick("base")).rejects.toThrow(/No PaymentRouter configured/);
    });
  });
});
