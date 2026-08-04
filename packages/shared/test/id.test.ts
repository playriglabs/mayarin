import { describe, expect, test } from "bun:test";
import { generateId, hasPrefix, timestampFromId, ulid } from "../src/id.ts";
import { idSchema } from "../src/schema.ts";

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

describe("auth id prefixes", () => {
  test("user, session and merchant ids carry their prefix", () => {
    const user = generateId("usr");
    const session = generateId("ses");
    const merchant = generateId("mrc");
    expect(user).toMatch(/^usr_[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(session).toMatch(/^ses_[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(merchant).toMatch(/^mrc_[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(hasPrefix(user, "usr")).toBe(true);
    expect(hasPrefix(session, "ses")).toBe(true);
    expect(hasPrefix(merchant, "mrc")).toBe(true);
  });

  test("idSchema accepts the matching prefix and rejects others", () => {
    const userId = generateId("usr");
    const sessionId = generateId("ses");
    const merchantId = generateId("mrc");
    expect(idSchema("usr").parse(userId)).toBe(userId);
    expect(idSchema("ses").parse(sessionId)).toBe(sessionId);
    expect(idSchema("mrc").parse(merchantId)).toBe(merchantId);
    expect(() => idSchema("usr").parse(sessionId)).toThrow();
    expect(() => idSchema("ses").parse(generateId("pi"))).toThrow();
    expect(() => idSchema("mrc").parse(generateId("pi"))).toThrow();
  });
});
