import { describe, expect, test } from "bun:test";
import type { ChainId } from "@mayarin/chain";
import type { RailObservation } from "../src/rail.ts";
import { chooseRail, rankRails, summariseRails } from "../src/rail.ts";

const ARC: ChainId = "arc-testnet";
const BASE: ChainId = "base-sepolia";

/** `count` settlements, every one with the same headroom. */
function observed(chain: ChainId, headroom: number, count: number, failures?: number) {
  const observation: RailObservation = {
    chain,
    headroomSeconds: Array.from({ length: count }, () => headroom),
    ...(failures === undefined ? {} : { failures }),
  };
  return observation;
}

describe("chooseRail", () => {
  test("takes the rail with the most headroom", () => {
    const choice = chooseRail([BASE, ARC], [observed(BASE, 12, 112), observed(ARC, 58, 340, 0)]);

    expect(choice.chain).toBe(ARC);
    expect(choice.medianHeadroomSeconds).toBe(58);
    expect(choice.samples).toBe(340);
    expect(choice.unobserved).toBe(false);
    expect(choice.reason).toBe(
      "arc-testnet: median headroom 58s over 340 settlements, no recorded failures",
    );
  });

  test("ignores a rail the resource does not accept", () => {
    const choice = chooseRail([BASE], [observed(BASE, 12, 112), observed(ARC, 58, 340)]);

    expect(choice.chain).toBe(BASE);
  });

  test("does not rank a rail with too few settlements to mean anything", () => {
    const choice = chooseRail([BASE, ARC], [observed(BASE, 12, 112), observed(ARC, 300, 1)], {
      minSamples: 5,
    });

    expect(choice.chain).toBe(BASE);
    expect(choice.unobserved).toBe(false);
  });

  test("announces the fallback rather than presenting it as a choice", () => {
    const choice = chooseRail([ARC, BASE], [observed(ARC, 300, 2)], { minSamples: 5 });

    expect(choice.chain).toBe(ARC);
    expect(choice.unobserved).toBe(true);
    expect(choice.samples).toBe(2);
    expect(choice.medianHeadroomSeconds).toBeUndefined();
    expect(choice.reason).toBe(
      "arc-testnet: no rail has 5 observed settlements, so this is the first accepted rail rather than a choice",
    );
  });

  test("with nothing observed at all, still falls back and says so", () => {
    const choice = chooseRail([BASE, ARC], []);

    expect(choice.chain).toBe(BASE);
    expect(choice.samples).toBe(0);
    expect(choice.unobserved).toBe(true);
  });

  test("reports recorded failures without ranking on them", () => {
    // Base has failures and more headroom; headroom is what decides.
    const choice = chooseRail([ARC, BASE], [observed(ARC, 20, 50, 0), observed(BASE, 90, 50, 3)]);

    expect(choice.chain).toBe(BASE);
    expect(choice.failures).toBe(3);
    expect(choice.reason).toContain("3 recorded failure(s)");
  });

  test("an unrecorded failure count is not a zero", () => {
    const choice = chooseRail([ARC], [observed(ARC, 20, 50)]);

    expect(choice.failures).toBeUndefined();
    expect(choice.reason).toContain("failures not recorded");
  });

  test("takes the median, so one generous settlement cannot carry a rail", () => {
    const choice = chooseRail(
      [ARC, BASE],
      [
        { chain: ARC, headroomSeconds: [1, 1, 1, 1, 600] },
        { chain: BASE, headroomSeconds: [30, 30, 30, 30, 30] },
      ],
    );

    expect(choice.chain).toBe(BASE);
    expect(choice.medianHeadroomSeconds).toBe(30);
  });

  test("averages the middle two on an even sample count", () => {
    const choice = chooseRail([ARC], [{ chain: ARC, headroomSeconds: [10, 20, 30, 50, 4, 6] }]);

    expect(choice.medianHeadroomSeconds).toBe(15);
    expect(choice.reason).toContain("median headroom 15s");
  });

  test("breaks a tie by sample count, then by the order the resource listed", () => {
    const bySamples = chooseRail([BASE, ARC], [observed(BASE, 40, 10), observed(ARC, 40, 90)]);
    expect(bySamples.chain).toBe(ARC);

    const byOrder = chooseRail([BASE, ARC], [observed(BASE, 40, 90), observed(ARC, 40, 90)]);
    expect(byOrder.chain).toBe(BASE);
  });

  test("refuses to choose from nothing", () => {
    expect(() => chooseRail([], [observed(ARC, 58, 340)])).toThrow(/at least one accepted rail/);
  });
});

describe("rankRails", () => {
  const arcRail = { chain: ARC, asset: "USDC" };
  const baseRail = { chain: BASE, asset: "USDC" };

  test("orders healthy before unobserved before degraded", () => {
    const ranked = rankRails(
      [baseRail, arcRail, { chain: "arbitrum-sepolia" as ChainId, asset: "USDC" }],
      [observed(BASE, 12, 112), observed(ARC, 58, 340)],
    );

    expect(ranked.map((entry) => entry.standing)).toEqual(["healthy", "unobserved", "degraded"]);
    expect(ranked.map((entry) => entry.rail.chain)).toEqual([ARC, "arbitrum-sepolia", BASE]);
  });

  test("a rail below the minimum sample count is unobserved, never degraded", () => {
    // Four settlements at 1 second each: grim, but not yet evidence.
    const ranked = rankRails([baseRail], [{ chain: BASE, headroomSeconds: [1, 1, 1, 1] }], {
      minSamples: 5,
    });

    expect(ranked[0]?.standing).toBe("unobserved");
  });

  test("keeps catalog order among rails with the same standing", () => {
    const ranked = rankRails([baseRail, arcRail], [observed(BASE, 58, 90), observed(ARC, 58, 90)]);

    expect(ranked.map((entry) => entry.rail.chain)).toEqual([BASE, ARC]);
    expect(ranked.every((entry) => entry.standing === "healthy")).toBe(true);
  });

  test("ranks within healthy by the chooseRail rule: median, then samples", () => {
    const byMedian = rankRails(
      [baseRail, arcRail],
      [observed(BASE, 40, 10), observed(ARC, 58, 90)],
    );
    expect(byMedian.map((entry) => entry.rail.chain)).toEqual([ARC, BASE]);

    const bySamples = rankRails(
      [baseRail, arcRail],
      [observed(BASE, 58, 10), observed(ARC, 58, 90)],
    );
    expect(bySamples.map((entry) => entry.rail.chain)).toEqual([ARC, BASE]);
  });

  test("keeps the rails it is given, including unobserved ones", () => {
    const ranked = rankRails([baseRail, arcRail], []);

    expect(ranked).toHaveLength(2);
    expect(ranked.map((entry) => entry.standing)).toEqual(["unobserved", "unobserved"]);
  });

  test("the degraded cut is configurable", () => {
    const ranked = rankRails([baseRail], [observed(BASE, 58, 90)], { degradedBelowSeconds: 60 });

    expect(ranked[0]?.standing).toBe("degraded");
  });

  test("rails on one chain share that chain's standing", () => {
    const ranked = rankRails([arcRail, { chain: ARC, asset: "ETH" }], [observed(ARC, 12, 112)]);

    expect(ranked.map((entry) => entry.standing)).toEqual(["degraded", "degraded"]);
  });

  test("does not rank on recorded failures", () => {
    // Arc has the failures but the headroom; headroom is what decides.
    const ranked = rankRails(
      [baseRail, arcRail],
      [observed(BASE, 58, 90), observed(ARC, 12, 90, 7)],
    );

    expect(ranked.map((entry) => entry.rail.chain)).toEqual([BASE, ARC]);
    expect(ranked.map((entry) => entry.standing)).toEqual(["healthy", "degraded"]);
  });
});

describe("summariseRails", () => {
  test("reports the tail the median hides", () => {
    // Base Sepolia's real shape: a comfortable middle with settlements landing
    // seconds from the deadline. A summary reporting only the median would
    // describe this rail as safe.
    const summaries = summariseRails(
      ["base-sepolia"],
      [{ chain: "base-sepolia", headroomSeconds: [828, 1797, 28, 900, 40] }],
    );

    expect(summaries[0]).toEqual({
      chain: "base-sepolia",
      samples: 5,
      medianHeadroomSeconds: 828,
      minHeadroomSeconds: 28,
      maxHeadroomSeconds: 1797,
    });
  });

  test("keeps a rail nobody has observed, with zero samples", () => {
    // Dropping it would make "never seen this rail settle" and "did not ask
    // about this rail" the same answer.
    const summaries = summariseRails(
      ["base-sepolia", "arc-testnet"],
      [{ chain: "base-sepolia", headroomSeconds: [10, 20, 30] }],
    );

    expect(summaries).toHaveLength(2);
    expect(summaries[1]).toEqual({ chain: "arc-testnet", samples: 0 });
    expect(summaries[1]?.medianHeadroomSeconds).toBeUndefined();
  });

  test("carries failures through without inventing a zero", () => {
    const summaries = summariseRails(
      ["base-sepolia", "arc-testnet"],
      [
        { chain: "base-sepolia", headroomSeconds: [10], failures: 2 },
        { chain: "arc-testnet", headroomSeconds: [10] },
      ],
    );

    expect(summaries[0]?.failures).toBe(2);
    expect(summaries[1]?.failures).toBeUndefined();
  });
});
