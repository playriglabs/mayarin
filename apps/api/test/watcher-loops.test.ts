import { describe, expect, test } from "bun:test";
import type { TickResult } from "@mayarin/chain";
import { type AssetCode, ProviderError } from "@mayarin/shared";
import {
  startIndexerLoops,
  startWatcherLoops,
  type TimerPort,
  type WatchedPair,
} from "../src/services/watcher-loops.ts";

const CHAIN = "base-sepolia" as const;

function result(asset: AssetCode, scannedTo: bigint, headNumber: bigint): TickResult {
  return {
    chain: CHAIN,
    asset,
    scannedFrom: scannedTo,
    scannedTo,
    headNumber,
    recorded: 0,
    confirmed: 0,
    orphaned: 0,
    funded: 0,
  };
}

interface ScheduledRun {
  readonly run: () => void;
  readonly delayMs: number;
}

function fakeTimers(): { readonly port: TimerPort; readonly scheduled: ScheduledRun[] } {
  const scheduled: ScheduledRun[] = [];
  return {
    scheduled,
    port: {
      schedule: (run, delayMs) => {
        const entry = { run, delayMs };
        scheduled.push(entry);
        return () => {
          const index = scheduled.indexOf(entry);
          if (index >= 0) scheduled.splice(index, 1);
        };
      },
    },
  };
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("watcher loops", () => {
  test("runs immediately, catches up rapidly, then returns to the normal interval", async () => {
    const timers = fakeTimers();
    const results = [result("USDC", 100n, 250n), result("USDC", 250n, 250n)];
    let calls = 0;
    const watcher = {
      tick: async () => {
        const next = results[calls];
        calls += 1;
        if (next === undefined) throw new Error("unexpected tick");
        return next;
      },
    };

    const stop = startWatcherLoops({
      pairs: [{ chain: CHAIN, asset: "USDC" }],
      watchers: new Map([[CHAIN, watcher]]),
      intervalMs: 60_000,
      catchUpIntervalMs: 250,
      rangeOf: () => 100,
      timers: timers.port,
      logger: { info: () => {}, warn: () => {}, error: () => {} },
    });

    await flush();
    expect(calls).toBe(1);
    expect(timers.scheduled.map((entry) => entry.delayMs)).toEqual([250]);

    timers.scheduled.shift()?.run();
    await flush();
    expect(calls).toBe(2);
    expect(timers.scheduled.map((entry) => entry.delayMs)).toEqual([60_000]);

    stop();
    expect(timers.scheduled).toHaveLength(0);
  });

  test("starts every asset independently", async () => {
    const pairs: readonly WatchedPair[] = [
      { chain: CHAIN, asset: "USDC" },
      { chain: CHAIN, asset: "ETH" },
    ];
    const seen: AssetCode[] = [];
    const watcher = {
      tick: async (_chain: typeof CHAIN, asset: AssetCode) => {
        seen.push(asset);
        return result(asset, 10n, 10n);
      },
    };
    const timers = fakeTimers();

    const stop = startWatcherLoops({
      pairs,
      watchers: new Map([[CHAIN, watcher]]),
      intervalMs: 60_000,
      catchUpIntervalMs: 250,
      rangeOf: () => 100,
      timers: timers.port,
      logger: { info: () => {}, warn: () => {}, error: () => {} },
    });

    await flush();
    expect(seen).toEqual(["USDC", "ETH"]);
    expect(timers.scheduled).toHaveLength(2);
    stop();
  });

  test("does not schedule another pass until the current tick completes", async () => {
    const timers = fakeTimers();
    let finish: ((value: TickResult) => void) | undefined;
    const pending = new Promise<TickResult>((resolve) => {
      finish = resolve;
    });
    let calls = 0;
    const watcher = {
      tick: () => {
        calls += 1;
        return pending;
      },
    };

    const stop = startWatcherLoops({
      pairs: [{ chain: CHAIN, asset: "USDC" }],
      watchers: new Map([[CHAIN, watcher]]),
      intervalMs: 1,
      catchUpIntervalMs: 0,
      rangeOf: () => 100,
      timers: timers.port,
      logger: { info: () => {}, warn: () => {}, error: () => {} },
    });

    await flush();
    expect(calls).toBe(1);
    expect(timers.scheduled).toHaveLength(0);

    finish?.(result("USDC", 10n, 10n));
    await flush();
    expect(timers.scheduled).toHaveLength(1);
    stop();
  });
});

describe("indexer loops", () => {
  test("runs immediately and schedules only after the tick completes", async () => {
    const timers = fakeTimers();
    let finish: (() => void) | undefined;
    const pending = new Promise<void>((resolve) => {
      finish = resolve;
    });
    let calls = 0;
    const indexer = {
      tick: () => {
        calls += 1;
        return pending;
      },
    };

    const stop = startIndexerLoops({
      indexers: new Map([[CHAIN, indexer]]),
      intervalMs: 15_000,
      timers: timers.port,
      logger: { info: () => {}, warn: () => {}, error: () => {} },
    });

    await flush();
    expect(calls).toBe(1);
    expect(timers.scheduled).toHaveLength(0);

    finish?.();
    await flush();
    expect(timers.scheduled.map((entry) => entry.delayMs)).toEqual([15_000]);

    stop();
    expect(timers.scheduled).toHaveLength(0);
  });

  test("backs off while passes fail, and resets once one succeeds", async () => {
    const timers = fakeTimers();
    const outcomes: (Error | undefined)[] = [
      new Error("boom"),
      new Error("boom"),
      new Error("boom"),
      undefined,
    ];
    let calls = 0;
    const indexer = {
      tick: async () => {
        const outcome = outcomes[calls];
        calls += 1;
        if (outcome !== undefined) throw outcome;
      },
    };

    const stop = startIndexerLoops({
      indexers: new Map([[CHAIN, indexer]]),
      intervalMs: 15_000,
      maxBackoffMs: 45_000,
      timers: timers.port,
      logger: { info: () => {}, warn: () => {}, error: () => {} },
    });

    const delays: number[] = [];
    for (let pass = 0; pass < 4; pass++) {
      await flush();
      const scheduled = timers.scheduled.at(-1);
      if (scheduled === undefined) throw new Error("nothing scheduled");
      delays.push(scheduled.delayMs);
      scheduled.run();
    }

    // Doubling, capped at 45s, and back to the interval after the success.
    expect(delays).toEqual([30_000, 45_000, 45_000, 15_000]);
    stop();
  });

  test("an interval of zero starts nothing, rather than looping with no gap", async () => {
    const timers = fakeTimers();
    let calls = 0;
    const indexer = {
      tick: async () => {
        calls += 1;
      },
    };

    const stop = startIndexerLoops({
      indexers: new Map([[CHAIN, indexer]]),
      intervalMs: 0,
      timers: timers.port,
      logger: { info: () => {}, warn: () => {}, error: () => {} },
    });

    await flush();
    expect(calls).toBe(0);
    expect(timers.scheduled).toHaveLength(0);
    stop();
  });

  test("waits as long as a rate limiter asked, when that is longer than the backoff", async () => {
    const timers = fakeTimers();
    const indexer = {
      tick: async () => {
        throw new ProviderError("subgraph at https://example.test answered 429", {
          status: 429,
          retryAfterMs: 120_000,
        });
      },
    };

    const stop = startIndexerLoops({
      indexers: new Map([[CHAIN, indexer]]),
      intervalMs: 15_000,
      maxBackoffMs: 45_000,
      timers: timers.port,
      logger: { info: () => {}, warn: () => {}, error: () => {} },
    });

    await flush();
    expect(timers.scheduled.map((entry) => entry.delayMs)).toEqual([120_000]);
    stop();
  });
});
