import { describe, expect, test } from "bun:test";
import { validateTreasurySafe } from "../src/treasury-safe.ts";

const A = "0x00000000000000000000000000000000000000a1";
const B = "0x00000000000000000000000000000000000000b2";
const C = "0x00000000000000000000000000000000000000c3";

describe("validateTreasurySafe", () => {
  test("accepts a 2-of-3 and normalises the owners", () => {
    const safe = validateTreasurySafe({ owners: [A, B, C], threshold: 2, salt: "treasury-1" });
    expect(safe.owners).toHaveLength(3);
    expect(safe.threshold).toBe(2);
    expect(safe.owners[0]?.toLowerCase()).toBe(A);
  });

  test("the salt names the Safe: another salt is another one", () => {
    const one = validateTreasurySafe({ owners: [A, B, C], threshold: 2, salt: "one" });
    const two = validateTreasurySafe({ owners: [A, B, C], threshold: 2, salt: "two" });
    expect(one.salt).not.toBe(two.salt);
    expect(one.salt).toBe(
      validateTreasurySafe({ owners: [A, B, C], threshold: 2, salt: "one" }).salt,
    );
  });

  test("is not a multisig below 2, nor above the owners", () => {
    expect(() => validateTreasurySafe({ owners: [A, B, C], threshold: 1, salt: "s" })).toThrow(
      "at least 2",
    );
    expect(() => validateTreasurySafe({ owners: [A, B], threshold: 3, salt: "s" })).toThrow(
      "higher than the number of owners",
    );
  });

  test("refuses a duplicate, a zero address and a malformed one", () => {
    expect(() => validateTreasurySafe({ owners: [A, A, C], threshold: 2, salt: "s" })).toThrow(
      "twice",
    );
    expect(() =>
      validateTreasurySafe({
        owners: [A, "0x0000000000000000000000000000000000000000", C],
        threshold: 2,
        salt: "s",
      }),
    ).toThrow("not an address");
    expect(() => validateTreasurySafe({ owners: [A, "0x12", C], threshold: 2, salt: "s" })).toThrow(
      "not an address",
    );
  });

  test("a key a service holds cannot be an owner, whatever its case", () => {
    expect(() =>
      validateTreasurySafe({
        owners: [A, B, C],
        threshold: 2,
        salt: "s",
        forbiddenOwners: [B.toUpperCase().replace("0X", "0x")],
      }),
    ).toThrow("cannot be an owner");
  });

  test("needs a salt", () => {
    expect(() => validateTreasurySafe({ owners: [A, B, C], threshold: 2, salt: " " })).toThrow(
      "salt",
    );
  });
});
