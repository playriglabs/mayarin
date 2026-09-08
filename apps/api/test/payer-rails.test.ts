/**
 * The payer's ranked rail list (#260).
 *
 * `rankRails` is tested exhaustively in `@mayarin/x402`. What is tested here is
 * the composition around it: that the observation read cannot block or break
 * the page, that a single rail is left untouched, and that the list a payer is
 * offered arrives ordered with each rail's standing attached.
 */

import { describe, expect, test } from "bun:test";
import type { OfferedRail, RailReport } from "@mayarin/payment-intent";
import type { RailObservation } from "@mayarin/x402";
import { payerRails } from "../src/rails.ts";

const BASE_RAIL: OfferedRail = { chain: "base-sepolia", asset: "USDC", contract: "0x3600" };
const ARC_RAIL: OfferedRail = { chain: "arc-testnet", asset: "USDC", contract: "0x3600" };

/** A catalog report offering the rails it is given, as `describe` returns one. */
function report(rails: readonly OfferedRail[]): RailReport {
  return { rails, unavailable: [], settlementAsset: "USDC" };
}

/** An observation source that answers with the given observations. */
function source(observations: readonly RailObservation[]) {
  return {
    railObservations: {
      observe: async () => observations,
    },
  };
}

function settled(chain: string, headroom: number): RailObservation {
  return {
    chain: chain as RailObservation["chain"],
    headroomSeconds: Array.from({ length: 5 }, () => headroom),
  };
}

describe("payerRails", () => {
  test("orders what the payer is offered by how the rails have been behaving", async () => {
    // Catalog order puts Base first; Base has been settling 12s from the
    // deadline and Arc 58s, so the payer is offered Arc first.
    const rails = await payerRails(
      source([settled("base-sepolia", 12), settled("arc-testnet", 58)]),
      report([BASE_RAIL, ARC_RAIL]),
    );

    expect(rails.map((rail) => rail.chain)).toEqual(["arc-testnet", "base-sepolia"]);
    expect(rails.map((rail) => rail.standing)).toEqual(["healthy", "degraded"]);
  });

  test("a rail below the minimum sample count keeps its catalog position", async () => {
    const rails = await payerRails(
      source([{ chain: "arc-testnet", headroomSeconds: [300] }]),
      report([BASE_RAIL, ARC_RAIL]),
    );

    expect(rails.map((rail) => rail.chain)).toEqual(["base-sepolia", "arc-testnet"]);
    expect(rails.map((rail) => rail.standing)).toEqual(["unobserved", "unobserved"]);
  });

  test("a single rail is returned untouched, with nothing observed", async () => {
    let asked = 0;
    const rails = await payerRails(
      {
        railObservations: {
          observe: async () => {
            asked += 1;
            return [];
          },
        },
      },
      report([BASE_RAIL]),
    );

    expect(rails).toEqual([{ chain: "base-sepolia", asset: "USDC", contract: "0x3600" }]);
    expect(asked).toBe(0);
  });

  test("an observation source that fails leaves the list in catalog order", async () => {
    const rails = await payerRails(
      {
        railObservations: {
          observe: async () => {
            throw new Error("subgraph unreachable");
          },
        },
      },
      report([BASE_RAIL, ARC_RAIL]),
    );

    expect(rails.map((rail) => rail.chain)).toEqual(["base-sepolia", "arc-testnet"]);
    expect(rails.map((rail) => rail.standing)).toEqual(["unobserved", "unobserved"]);
  });

  test("an observation source that hangs does not block the page", async () => {
    const rails = await payerRails(
      {
        railObservations: {
          // Never settles: the deadline is the only way out.
          observe: () => new Promise<readonly RailObservation[]>(() => {}),
        },
      },
      report([BASE_RAIL, ARC_RAIL]),
    );

    expect(rails.map((rail) => rail.chain)).toEqual(["base-sepolia", "arc-testnet"]);
    expect(rails.map((rail) => rail.standing)).toEqual(["unobserved", "unobserved"]);
  }, 5_000);

  test("no observation source leaves the list in catalog order", async () => {
    const rails = await payerRails({}, report([BASE_RAIL, ARC_RAIL]));

    expect(rails.map((rail) => rail.chain)).toEqual(["base-sepolia", "arc-testnet"]);
    expect(rails.map((rail) => rail.standing)).toEqual(["unobserved", "unobserved"]);
  });
});
