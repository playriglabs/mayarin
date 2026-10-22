import { describe, expect, test } from "bun:test";
import { registerCopy } from "./network-copy";

describe("registerCopy", () => {
  test("a testnet says it is a sandbox with no real value", () => {
    const copy = registerCopy("testnet");
    expect(copy.title).toBe("Create your sandbox account");
    expect(copy.intro).toContain("no real-world value");
  });

  test("a mainnet says nothing about sandboxes or test assets", () => {
    const copy = registerCopy("mainnet");
    expect(`${copy.title} ${copy.intro}`).not.toMatch(/sandbox|test|real-world/i);
  });
});
