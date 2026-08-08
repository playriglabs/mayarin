import { describe, expect, test } from "bun:test";
import { disabledScreening } from "../src/index.ts";

const NOW = new Date("2026-02-01T00:00:00.000Z");

describe("disabledScreening", () => {
  test("returns NOT_SCREENED rather than CLEAR", async () => {
    const decision = await disabledScreening.screen({ merchantId: "M-1", reference: "clr_1" }, NOW);

    // The distinction the whole outcome union exists for: an unscreened payment
    // must never read back as a cleared one.
    expect(decision.outcome).toBe("NOT_SCREENED");
    expect(decision.provider).toBe("disabled");
    expect(decision.at).toEqual(NOW);
  });
});
