import { describe, expect, test } from "bun:test";
import { ConfigurationError } from "@mayarin/shared";
import { Create2DepositAddressDeriver, depositSalt } from "../src/forwarder-deriver.ts";

/**
 * The same vectors `DepositForwarder.t.sol` pins, computed there from the
 * CREATE2 formula in Solidity and here by viem. Agreement is the thing that
 * matters: if the two ever diverge, payers are shown addresses the deployed
 * factory cannot deploy to, and the deposit is unrecoverable.
 */
const FACTORY = "0x00000000000000000000000000000000DeaDBeef";
const INIT_CODE_HASH = "0x1111111111111111111111111111111111111111111111111111111111111111";

const VECTORS = [
  [0, "0x2Fd3C2C3fC236E326ff7088E7401583a8aB95772"],
  [1, "0x1CCfC85b51f0BB828c9389bB415fF8408fB97daE"],
  [42, "0x10C22331f580Fcca511b7d013DCA799df00581B3"],
] as const;

function deriver() {
  return new Create2DepositAddressDeriver({ factory: FACTORY, initCodeHash: INIT_CODE_HASH });
}

describe("Create2DepositAddressDeriver", () => {
  test.each(VECTORS)(
    "index %i derives the address the factory would deploy to",
    (index, expected) => {
      expect(deriver().derive(index)).toBe(expected);
    },
  );

  test("is deterministic across instances", () => {
    expect(deriver().derive(7)).toBe(deriver().derive(7));
  });

  test("gives distinct addresses to distinct indices", () => {
    const addresses = new Set([0, 1, 2, 3, 4].map((index) => deriver().derive(index)));
    expect(addresses.size).toBe(5);
  });

  test("the salt is hashed, not a padded counter", () => {
    // A left-padded integer salt would make consecutive deposit addresses
    // derivable from a small counter by anyone watching one of them.
    expect(depositSalt(1)).not.toContain(
      "000000000000000000000000000000000000000000000000000000000000000",
    );
    expect(depositSalt(0)).not.toBe(depositSalt(1));
  });

  test("a changed init code hash changes every address", () => {
    const other = new Create2DepositAddressDeriver({
      factory: FACTORY,
      initCodeHash: "0x2222222222222222222222222222222222222222222222222222222222222222",
    });

    expect(other.derive(0)).not.toBe(deriver().derive(0));
  });

  test("a changed factory changes every address", () => {
    const other = new Create2DepositAddressDeriver({
      factory: "0x000000000000000000000000000000000000beef",
      initCodeHash: INIT_CODE_HASH,
    });

    expect(other.derive(0)).not.toBe(deriver().derive(0));
  });

  test("rejects an address whose checksum does not match, which is how a typo shows up", () => {
    // viem's `isAddress` is strict by default. A lowercase address is accepted
    // as unchecksummed; a mixed-case one with the wrong casing is a corrupted
    // copy-paste, and catching it at boot beats deriving deposit addresses from
    // it for the rest of the deployment's life.
    expect(
      () =>
        new Create2DepositAddressDeriver({
          factory: "0x000000000000000000000000000000000000BEEF",
          initCodeHash: INIT_CODE_HASH,
        }),
    ).toThrow(ConfigurationError);
  });

  test("rejects a malformed factory address at construction", () => {
    expect(
      () => new Create2DepositAddressDeriver({ factory: "nope", initCodeHash: INIT_CODE_HASH }),
    ).toThrow(ConfigurationError);
  });

  test("rejects an init code hash that is not 32 bytes", () => {
    expect(
      () => new Create2DepositAddressDeriver({ factory: FACTORY, initCodeHash: "0x1234" }),
    ).toThrow(ConfigurationError);
  });

  test("rejects a negative or fractional index", () => {
    expect(() => deriver().derive(-1)).toThrow(ConfigurationError);
    expect(() => deriver().derive(1.5)).toThrow(ConfigurationError);
  });
});
