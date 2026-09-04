import { describe, expect, test } from "bun:test";
import type { ChainId } from "@mayarin/chain";
import { chooseRail } from "@mayarin/x402";
import type { FetchLike } from "../src/graphql.ts";
import { SubgraphRailObservations } from "../src/rail-observations.ts";

const BASE: ChainId = "base-sepolia";
const ARC: ChainId = "arc-testnet";

const ENDPOINTS = {
  "base-sepolia": "https://example.test/base",
  "arc-testnet": "https://example.test/arc",
} as const;

/** A fetch that answers each endpoint from a table, and records what it asked. */
function fetchFrom(bodies: Record<string, unknown>, status = 200) {
  const calls: { url: string; body: unknown }[] = [];
  const fake: FetchLike = async (url, init) => {
    calls.push({ url, body: JSON.parse(String(init.body)) });
    return new Response(JSON.stringify(bodies[url] ?? {}), {
      status,
      headers: { "content-type": "application/json" },
    });
  };
  return { fetch: fake, calls };
}

function settlements(...headroom: number[]) {
  return {
    data: { settlements: headroom.map((seconds) => ({ headroomSeconds: String(seconds) })) },
  };
}

describe("SubgraphRailObservations", () => {
  test("reads samples per chain, newest first", async () => {
    const { fetch, calls } = fetchFrom({
      [ENDPOINTS["base-sepolia"]]: settlements(509, 888, 869),
      [ENDPOINTS["arc-testnet"]]: settlements(),
    });
    const source = new SubgraphRailObservations({ endpoints: ENDPOINTS, fetch, sampleSize: 3 });

    const observed = await source.observe([BASE, ARC]);

    expect(observed).toEqual([
      { chain: BASE, headroomSeconds: [509, 888, 869] },
      { chain: ARC, headroomSeconds: [] },
    ]);
    expect(calls).toHaveLength(2);
    const first = calls[0];
    expect((first?.body as { variables: { first: number } } | undefined)?.variables.first).toBe(3);
  });

  test("never reports a failure count, because the chain cannot supply one", async () => {
    const { fetch } = fetchFrom({ [ENDPOINTS["base-sepolia"]]: settlements(100, 200) });
    const source = new SubgraphRailObservations({ endpoints: ENDPOINTS, fetch });

    const [observation] = await source.observe([BASE]);

    expect(observation?.failures).toBeUndefined();
  });

  test("a chain with no endpoint is not observed rather than reported empty", async () => {
    const { fetch, calls } = fetchFrom({});
    const source = new SubgraphRailObservations({
      endpoints: { "base-sepolia": "https://x" },
      fetch,
    });

    const observed = await source.observe([ARC]);

    expect(observed).toEqual([]);
    expect(calls).toEqual([]);
  });

  test("a GraphQL error is a failure, not an empty rail", async () => {
    const { fetch } = fetchFrom({
      [ENDPOINTS["base-sepolia"]]: { errors: [{ message: "bad field" }] },
    });
    const source = new SubgraphRailObservations({ endpoints: ENDPOINTS, fetch });

    await expect(source.observe([BASE])).rejects.toThrow(/answered with an error: bad field/);
  });

  test("an HTTP failure is raised rather than swallowed", async () => {
    const { fetch } = fetchFrom({ [ENDPOINTS["base-sepolia"]]: {} }, 502);
    const source = new SubgraphRailObservations({ endpoints: ENDPOINTS, fetch });

    await expect(source.observe([BASE])).rejects.toThrow(/answered 502/);
  });

  test("an unreachable subgraph raises with the cause attached", async () => {
    const boom: FetchLike = async () => {
      throw new Error("connect ECONNREFUSED");
    };
    const source = new SubgraphRailObservations({ endpoints: ENDPOINTS, fetch: boom });

    await expect(source.observe([BASE])).rejects.toThrow(/unreachable/);
  });

  test("feeds chooseRail, and an unindexed rail loses to an observed one", async () => {
    const { fetch } = fetchFrom({
      // The shape the live subgraphs are in right now: Base has history, Arc's
      // router was deployed minutes ago and has settled nothing.
      [ENDPOINTS["base-sepolia"]]: settlements(509, 888, 869, 828, 700),
      [ENDPOINTS["arc-testnet"]]: settlements(),
    });
    const source = new SubgraphRailObservations({ endpoints: ENDPOINTS, fetch });

    const choice = chooseRail([ARC, BASE], await source.observe([ARC, BASE]));

    expect(choice.chain).toBe(BASE);
    expect(choice.medianHeadroomSeconds).toBe(828);
    expect(choice.unobserved).toBe(false);
  });
});
