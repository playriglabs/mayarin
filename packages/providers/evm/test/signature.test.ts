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

    expect(await new ViemSignatureVerifier().recover(message, signature)).toBe(
      account.address.toLowerCase(),
    );
  });

  test("a different message recovers a different address", async () => {
    const account = privateKeyToAccount(KEY);
    const signature = await account.signMessage({ message: "one" });

    // Not an error — recovery always yields *some* address. That is exactly why
    // the caller compares it rather than trusting that recovery succeeded.
    expect(await new ViemSignatureVerifier().recover("two", signature)).not.toBe(
      account.address.toLowerCase(),
    );
  });

  test("a malformed signature throws rather than yielding an address", async () => {
    await expect(new ViemSignatureVerifier().recover("one", "0xnope")).rejects.toThrow();
  });
});
