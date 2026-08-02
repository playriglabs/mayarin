import { describe, expect, test } from "bun:test";
import { generateId, hasPrefix, timestampFromId, ulid } from "../src/id.ts";

describe("generateId", () => {
  test("prefixes and produces a 26-character ULID", () => {
    const id = generateId("pi");
    expect(id).toMatch(/^pi_[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(hasPrefix(id, "pi")).toBe(true);
    expect(hasPrefix(id, "clr")).toBe(false);
  });

  test("is monotonic within a single millisecond", () => {
    const ids = Array.from({ length: 1_000 }, () => generateId("clr", 1_700_000_000_000));
    const sorted = [...ids].sort();
    expect(ids).toEqual(sorted);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("sorts by creation time across milliseconds", () => {
    const earlier = ulid(1_700_000_000_000);
    const later = ulid(1_700_000_000_001);
    expect(earlier < later).toBe(true);
  });

  test("round-trips the embedded timestamp", () => {
    const now = 1_700_000_000_000;
    expect(timestampFromId(generateId("ltxn", now)).getTime()).toBe(now);
    expect(timestampFromId(ulid(now)).getTime()).toBe(now);
  });
});
