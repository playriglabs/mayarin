import { describe, expect, test } from "bun:test";
import { MockSettlementAdapter } from "../src/adapter.ts";

describe("MockSettlementAdapter mode", () => {
  test("defaults to external", () => {
    expect(new MockSettlementAdapter().mode).toBe("external");
  });

  test("can be overridden", () => {
    const internal = new MockSettlementAdapter({ mode: "internal" });
    expect(internal.mode).toBe("internal");
  });
});
