/**
 * Wallet guard tests (#11, RFC #6).
 *
 * Explicit external addresses are authorised by the merchant's scoped,
 * audited settings write. Managed fallbacks are chosen by Mayarin and remain
 * payable only while the registry proves they belong to that merchant.
 */

import { describe, expect, test } from "bun:test";
import { ConfigurationError, ValidationError } from "@mayarin/shared";
import { type MerchantWallet, WalletGuard } from "../src/index.ts";
import { InMemoryMerchantWalletRepository } from "../testing/index.ts";

const MERCHANT = "mrc_1";
const ADDRESS = "0x1111111111111111111111111111111111111111";
const TREASURY = "0x2222222222222222222222222222222222222222";
const NOW = new Date("2026-01-01T00:00:00.000Z");

function wallet(overrides: Partial<MerchantWallet> = {}): MerchantWallet {
  return {
    id: "wlt_1",
    merchantId: MERCHANT,
    chain: "base-sepolia",
    address: ADDRESS,
    provenance: "linked",
    verifiedAt: NOW,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function guard(wallets: InMemoryMerchantWalletRepository) {
  return new WalletGuard({ wallets, treasuryAddresses: [TREASURY] });
}

describe("assertPayable", () => {
  test("a verified wallet belonging to the merchant is payable", async () => {
    const wallets = new InMemoryMerchantWalletRepository();
    await wallets.insert(wallet());

    await expect(
      guard(wallets).assertPayable(MERCHANT, "base-sepolia", {
        source: "managed",
        address: ADDRESS,
      }),
    ).resolves.toBeUndefined();
  });

  test("a configured external address need not exist in the wallet registry", async () => {
    const wallets = new InMemoryMerchantWalletRepository();

    await expect(
      guard(wallets).assertPayable(MERCHANT, "base-sepolia", {
        source: "configured",
        address: ADDRESS,
      }),
    ).resolves.toBeUndefined();
  });

  test("an unknown managed fallback is refused", async () => {
    const wallets = new InMemoryMerchantWalletRepository();

    await expect(
      guard(wallets).assertPayable(MERCHANT, "base-sepolia", {
        source: "managed",
        address: ADDRESS,
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  test("a claimed but unverified wallet is refused", async () => {
    const wallets = new InMemoryMerchantWalletRepository();
    const { verifiedAt: _unverified, ...unverified } = wallet();
    await wallets.insert(unverified);

    await expect(
      guard(wallets).assertPayable(MERCHANT, "base-sepolia", {
        source: "managed",
        address: ADDRESS,
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  test("another merchant's wallet is refused, and says nothing about whose it is", async () => {
    const wallets = new InMemoryMerchantWalletRepository();
    await wallets.insert(wallet({ merchantId: "mrc_someone_else" }));

    let message = "";
    try {
      await guard(wallets).assertPayable(MERCHANT, "base-sepolia", {
        source: "managed",
        address: ADDRESS,
      });
    } catch (error) {
      message = error instanceof Error ? error.message : "";
    }

    // Same message as the unknown case: distinguishing them would confirm
    // another merchant's payout address to whoever guessed it.
    expect(message).toContain("managed settlement wallet is missing");
  });

  test("a treasury address is refused as a payout destination", async () => {
    const wallets = new InMemoryMerchantWalletRepository();
    // A fee recipient that is also a payout destination pays a merchant twice
    // and is invisible in the ledger.
    await expect(
      guard(wallets).assertPayable(MERCHANT, "base-sepolia", {
        source: "configured",
        address: TREASURY,
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  test("case is not a way past the guard", async () => {
    const wallets = new InMemoryMerchantWalletRepository();
    await wallets.insert(wallet());

    await expect(
      guard(wallets).assertPayable(MERCHANT, "base-sepolia", {
        source: "managed",
        address: ADDRESS.toUpperCase(),
      }),
    ).resolves.toBeUndefined();

    expect(guard(wallets).isTreasury(TREASURY.toUpperCase())).toBe(true);
  });

  test("the same address cannot be claimed by two merchants", async () => {
    const wallets = new InMemoryMerchantWalletRepository();
    await wallets.insert(wallet());

    await expect(wallets.insert(wallet({ id: "wlt_2", merchantId: "mrc_2" }))).rejects.toThrow();
  });
});

describe("assertTreasuryUnclaimed", () => {
  test("passes when no merchant holds a fee destination", async () => {
    const wallets = new InMemoryMerchantWalletRepository();
    await wallets.insert(wallet());

    await expect(guard(wallets).assertTreasuryUnclaimed(["base-sepolia"])).resolves.toBeUndefined();
  });

  test("fails the boot when a merchant already holds the fee destination", async () => {
    // The inverse of the refusal above, and the one no payment can catch: a
    // treasury address configured after a merchant already registered it looks
    // fine at every request, and quietly pays fees into a merchant's wallet.
    const wallets = new InMemoryMerchantWalletRepository();
    await wallets.insert(wallet({ address: TREASURY }));

    await expect(guard(wallets).assertTreasuryUnclaimed(["base-sepolia"])).rejects.toBeInstanceOf(
      ConfigurationError,
    );
  });

  test("checks every chain, not only the one the wallet was found on", async () => {
    const wallets = new InMemoryMerchantWalletRepository();
    await wallets.insert(wallet({ chain: "base", address: TREASURY }));

    await expect(
      guard(wallets).assertTreasuryUnclaimed(["base-sepolia", "base"]),
    ).rejects.toBeInstanceOf(ConfigurationError);
  });
});
