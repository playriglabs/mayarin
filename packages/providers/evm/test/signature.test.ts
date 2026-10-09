/**
 * Signature recovery tests (#11).
 *
 * Real keys and real signatures — the point of this adapter is that it agrees
 * with what a wallet actually produces, which a stub cannot demonstrate.
 */

import { describe, expect, test } from "bun:test";
import { privateKeyToAccount } from "viem/accounts";
import { ViemSignatureVerifier } from "../src/signature.ts";

const KEY = `0x${"11".repeat(32)}` as const;

describe("ViemSignatureVerifier", () => {
  test("recovers the address that signed", async () => {
    const account = privateKeyToAccount(KEY);
    const message = "Mayarin wallet verification\n\nMerchant: mrc_1";
    const signature = await account.signMessage({ message });

    expect(
      await new ViemSignatureVerifier().verify({
        message,
        signature,
        address: account.address,
        chain: "base-sepolia",
      }),
    ).toBe(true);
  });

  test("a different message recovers a different address", async () => {
    const account = privateKeyToAccount(KEY);
    const signature = await account.signMessage({ message: "one" });

    // Not an error — recovery always yields *some* address. That is exactly why
    // the caller compares it rather than trusting that recovery succeeded.
    expect(
      await new ViemSignatureVerifier().verify({
        message: "two",
        signature,
        address: account.address,
        chain: "base-sepolia",
      }),
    ).toBe(false);
  });

  test("a malformed signature throws rather than yielding an address", async () => {
    const account = privateKeyToAccount(KEY);
    await expect(
      new ViemSignatureVerifier().verify({
        message: "one",
        signature: "0xnope",
        address: account.address,
        chain: "base-sepolia",
      }),
    ).rejects.toThrow();
  });
});
