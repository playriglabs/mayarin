import { describe, expect, test } from "bun:test";
import { openSecret, SecretBox, sealSecret } from "../src/secret-box.ts";

const KEY = "k".repeat(32);

describe("SecretBox (SEC-12)", () => {
  test("round-trips, and the stored form is not the secret", () => {
    const box = new SecretBox(KEY);
    const stored = box.seal("whsec_live_abc");
    expect(stored.startsWith("enc:v1:")).toBe(true);
    expect(stored).not.toContain("whsec_live_abc");
    expect(box.open(stored)).toBe("whsec_live_abc");
  });

  test("seals the same secret differently each time", () => {
    const box = new SecretBox(KEY);
    expect(box.seal("whsec_x")).not.toBe(box.seal("whsec_x"));
  });

  test("another key cannot open it", () => {
    const stored = new SecretBox(KEY).seal("whsec_x");
    expect(() => new SecretBox("z".repeat(32)).open(stored)).toThrow();
  });

  test("a tampered value does not open", () => {
    const box = new SecretBox(KEY);
    const stored = box.seal("whsec_x");
    const flipped = `${stored.slice(0, -2)}${stored.endsWith("A") ? "B" : "A"}=`;
    expect(() => box.open(flipped)).toThrow();
  });

  test("a row written before encryption is returned as it is", () => {
    expect(new SecretBox(KEY).open("whsec_plain")).toBe("whsec_plain");
    expect(openSecret(undefined, "whsec_plain")).toBe("whsec_plain");
  });

  test("an encrypted value with no key is an error, not a secret", () => {
    const stored = new SecretBox(KEY).seal("whsec_x");
    expect(() => openSecret(undefined, stored)).toThrow("no encryption key");
  });

  test("with no box, a secret is stored as given", () => {
    expect(sealSecret(undefined, "whsec_x")).toBe("whsec_x");
  });
});
