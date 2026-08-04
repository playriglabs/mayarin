import { describe, expect, test } from "bun:test";
import { Argon2PasswordHasher } from "../src/hasher.ts";

const hasher = new Argon2PasswordHasher({ memoryCost: 4_096, timeCost: 1, parallelism: 1 });

describe("Argon2PasswordHasher", () => {
  test("hashes and verifies a password round-trip", async () => {
    const hashed = await hasher.hash("correct horse battery staple");
    expect(hashed).toMatch(/^\$argon2id\$/);
    await expect(hasher.verify("correct horse battery staple", hashed)).resolves.toBe(true);
  });

  test("rejects a wrong password", async () => {
    const hashed = await hasher.hash("correct horse battery staple");
    await expect(hasher.verify("wrong password", hashed)).resolves.toBe(false);
  });

  test("produces a fresh salt each hash", async () => {
    const a = await hasher.hash("same password");
    const b = await hasher.hash("same password");
    expect(a).not.toBe(b);
    await expect(hasher.verify("same password", a)).resolves.toBe(true);
    await expect(hasher.verify("same password", b)).resolves.toBe(true);
  });
});
