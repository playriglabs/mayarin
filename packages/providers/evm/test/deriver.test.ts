import { describe, expect, test } from "bun:test";
import { mnemonicToSeedSync } from "@scure/bip39";
import { HDKey, mnemonicToAccount } from "viem/accounts";
import { HdDepositAddressDeriver } from "../src/deriver.ts";

/** The public Hardhat/Anvil test mnemonic. Never used for real funds. */
const MNEMONIC = "test test test test test test test test test test test junk";
const BASE_PATH = "m/44'/60'/0'/0";

/**
 * The extended public key for the deposit branch, derived from the master seed
 * rather than from an account's `getHdKey()`: in this viem version that returns
 * the depth-5 account key, not the root, so deriving the branch path from it is
 * meaningless. The seed gives the true root, and `derive(BASE_PATH)` the branch
 * whose children `mnemonicToAccount({ addressIndex })` also produces.
 */
function accountXpub(): string {
  const master = HDKey.fromMasterSeed(mnemonicToSeedSync(MNEMONIC));
  const branch = master.derive(BASE_PATH);
  const xpub = branch.publicExtendedKey;
  if (xpub === null) throw new Error("expected an extended public key");
  return xpub;
}

describe("HdDepositAddressDeriver", () => {
  test("derives the same address the private key would", () => {
    const deriver = new HdDepositAddressDeriver({ xpub: accountXpub() });

    for (const index of [0, 1, 7]) {
      const expected = mnemonicToAccount(MNEMONIC, {
        addressIndex: index,
      }).address.toLowerCase();
      expect(deriver.derive(index)).toBe(expected);
    }
  });

  test("is deterministic across instances", () => {
    const xpub = accountXpub();
    expect(new HdDepositAddressDeriver({ xpub }).derive(3)).toBe(
      new HdDepositAddressDeriver({ xpub }).derive(3),
    );
  });

  test("gives distinct addresses to distinct indices", () => {
    const deriver = new HdDepositAddressDeriver({ xpub: accountXpub() });
    expect(deriver.derive(0)).not.toBe(deriver.derive(1));
  });

  test("rejects a malformed extended public key at construction", () => {
    expect(() => new HdDepositAddressDeriver({ xpub: "not-an-xpub" })).toThrow();
  });

  test("keeps HDKey out of the picture for private keys", () => {
    const deriver = new HdDepositAddressDeriver({ xpub: accountXpub() });
    expect(HDKey.fromExtendedKey(accountXpub()).privateKey).toBeNull();
    expect(deriver.derive(0)).toMatch(/^0x[0-9a-f]{40}$/);
  });
});
