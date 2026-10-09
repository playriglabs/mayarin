import { describe, expect, test } from "bun:test";
import { requestSolanaAccount, type SolanaWalletProvider, solanaSign } from "../src/lib/wallet.ts";

function provider(overrides: Partial<SolanaWalletProvider> = {}): SolanaWalletProvider {
  return {
    connect: async () => ({ publicKey: { toString: () => "MerchantSolanaAddress" } }),
    signMessage: async () => ({ signature: Uint8Array.from({ length: 64 }, (_, i) => i) }),
    ...overrides,
  };
}

describe("the injected Solana wallet adapter", () => {
  test("preserves the connected base58 address", async () => {
    expect(await requestSolanaAccount(provider())).toBe("MerchantSolanaAddress");
  });

  test("signs the exact UTF-8 challenge and returns base64", async () => {
    let received: readonly number[] = [];
    const signature = await solanaSign(
      provider({
        signMessage: async (message) => {
          received = [...message];
          return { signature: Uint8Array.from({ length: 64 }, () => 7) };
        },
      }),
      "Mayarin ✓",
    );

    expect(new TextDecoder().decode(Uint8Array.from(received))).toBe("Mayarin ✓");
    expect(Uint8Array.from(atob(signature), (character) => character.charCodeAt(0))).toHaveLength(
      64,
    );
  });

  test("rejects a wallet response that is not an Ed25519 signature", async () => {
    let message = "";
    try {
      await solanaSign(
        provider({ signMessage: async () => ({ signature: new Uint8Array(63) }) }),
        "message",
      );
    } catch (error) {
      message = error instanceof Error ? error.message : "";
    }
    expect(message).toContain("invalid signature");
  });
});
