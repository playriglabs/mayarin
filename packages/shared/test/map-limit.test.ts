import { describe, expect, test } from "bun:test";
import { mapLimit } from "../src/map-limit.ts";

describe("mapLimit", () => {
  test("returns results in input order, whatever order they finish in", async () => {
    const out = await mapLimit([30, 5, 20, 1], 4, async (ms, i) => {
      await Bun.sleep(ms);
      return i;
    });
    expect(out).toEqual([0, 1, 2, 3]);
  });

  test("never has more than the limit in flight", async () => {
    let active = 0;
    let peak = 0;
    await mapLimit(
      Array.from({ length: 12 }, (_, i) => i),
      3,
      async () => {
        active += 1;
        peak = Math.max(peak, active);
        await Bun.sleep(2);
        active -= 1;
      },
    );
    expect(peak).toBe(3);
  });

  test("an empty list is an empty result, and a rejection propagates", async () => {
    expect(await mapLimit([], 4, async () => 1)).toEqual([]);
    await expect(
      mapLimit([1, 2], 2, async (n) => {
        if (n === 2) throw new Error("boom");
        return n;
      }),
    ).rejects.toThrow("boom");
  });
});
