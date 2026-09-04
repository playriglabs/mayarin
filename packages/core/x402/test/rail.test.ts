import { describe, expect, test } from "bun:test";
import type { ChainId } from "@mayarin/chain";
import type { RailObservation } from "../src/rail.ts";
import { chooseRail } from "../src/rail.ts";

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
