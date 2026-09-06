import { describe, expect, test } from "bun:test";
import type { ChainId } from "@mayarin/chain";
import { ProviderError } from "@mayarin/shared";
import type { RailObservation, RailObservationSource } from "@mayarin/x402";
import { CachedRailObservations } from "../src/services/rail-observations.ts";

const CHAINS: ChainId[] = ["base-sepolia", "arc-testnet"];

function sourceAnswering(answers: (RailObservation[] | Error)[]): {
  source: RailObservationSource;
  calls: () => number;
} {
  let call = 0;
  return {
    calls: () => call,
    source: {
      observe: async () => {
        const answer = answers[call] ?? answers.at(-1);
        call += 1;
        if (answer instanceof Error) throw answer;
        return answer ?? [];
      },
    },
  };
}

function cached(source: RailObservationSource, now: () => Date, ttlMs = 300_000) {
  return new CachedRailObservations({
    source,
    ttlMs,
    now,
    logger: { warn: () => {} },
  });
}

describe("CachedRailObservations", () => {
  test("reads once inside the window, and again after it", async () => {
    const observations: RailObservation[] = [{ chain: "base-sepolia", headroomSeconds: [800] }];
    const { source, calls } = sourceAnswering([observations, observations]);
    let clock = new Date("2026-09-06T10:00:00Z");
    const rails = cached(source, () => clock);

    await rails.observe(CHAINS);
    await rails.observe(CHAINS);
    expect(calls()).toBe(1);

    clock = new Date("2026-09-06T10:05:01Z");
    await rails.observe(CHAINS);
    expect(calls()).toBe(2);
  });

  test("two different chain sets are two different questions", async () => {
    const { source, calls } = sourceAnswering([[], []]);
    const rails = cached(source, () => new Date("2026-09-06T10:00:00Z"));

    await rails.observe(["base-sepolia"]);
    await rails.observe(["arc-testnet"]);
    expect(calls()).toBe(2);

    // Order is not part of the question.
    await rails.observe(["arc-testnet", "base-sepolia"]);
    await rails.observe(["base-sepolia", "arc-testnet"]);
    expect(calls()).toBe(3);
  });

  test("an outage serves the last good read rather than failing the 402", async () => {
    const good: RailObservation[] = [{ chain: "base-sepolia", headroomSeconds: [800, 900] }];
    const { source } = sourceAnswering([good, new ProviderError("subgraph answered 429", {})]);
    let clock = new Date("2026-09-06T10:00:00Z");
    const rails = cached(source, () => clock);

    await rails.observe(CHAINS);
    clock = new Date("2026-09-06T10:05:01Z");

    await expect(rails.observe(CHAINS)).resolves.toEqual(good);
  });

  test("a stale read keeps expiring, so one outage cannot freeze it forever", async () => {
    const good: RailObservation[] = [{ chain: "base-sepolia", headroomSeconds: [800] }];
    const later: RailObservation[] = [{ chain: "base-sepolia", headroomSeconds: [40] }];
    const { source, calls } = sourceAnswering([
      good,
      new ProviderError("subgraph answered 429", {}),
      later,
    ]);
    let clock = new Date("2026-09-06T10:00:00Z");
    const rails = cached(source, () => clock);

    await rails.observe(CHAINS);
    clock = new Date("2026-09-06T10:05:01Z");
    await rails.observe(CHAINS);
    // The failed read did not re-stamp the entry, so the next call still asks.
    await expect(rails.observe(CHAINS)).resolves.toEqual(later);
    expect(calls()).toBe(3);
  });

  test("an outage with nothing cached reports no rail, not an empty rail's worth of confidence", async () => {
    const { source } = sourceAnswering([new ProviderError("subgraph is unreachable", {})]);
    const rails = cached(source, () => new Date("2026-09-06T10:00:00Z"));

    await expect(rails.observe(CHAINS)).resolves.toEqual([]);
  });
});
