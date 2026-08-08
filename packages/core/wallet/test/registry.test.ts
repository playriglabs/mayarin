/**
 * Wallet guard tests (#11, RFC #6).
 *
 * The gap these close is live today: `merchantSafe` is read from
 * `merchants.settlement_address` and signed with no claim about who controls
 * it — and since #95 that field is writable through an authenticated API.
 * Everything here is a refusal.
 */

import { describe, expect, test } from "bun:test";
import { ValidationError } from "@mayarin/shared";
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
      guard(wallets).assertPayable(MERCHANT, "base-sepolia", ADDRESS),
    ).resolves.toBeUndefined();
  });

  test("an address the deployment has never seen is refused", async () => {
    const wallets = new InMemoryMerchantWalletRepository();

    // The gap as it stands: a merchant sets any address through the settings
    // API and the order signer signs a payment to it.
    await expect(
      guard(wallets).assertPayable(MERCHANT, "base-sepolia", ADDRESS),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  test("a claimed but unverified wallet is refused", async () => {
    const wallets = new InMemoryMerchantWalletRepository();
    const { verifiedAt: _unverified, ...unverified } = wallet();
    await wallets.insert(unverified);

    await expect(
      guard(wallets).assertPayable(MERCHANT, "base-sepolia", ADDRESS),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  test("another merchant's wallet is refused, and says nothing about whose it is", async () => {
    const wallets = new InMemoryMerchantWalletRepository();
    await wallets.insert(wallet({ merchantId: "mrc_someone_else" }));

    let message = "";
    try {
      await guard(wallets).assertPayable(MERCHANT, "base-sepolia", ADDRESS);
    } catch (error) {
      message = error instanceof Error ? error.message : "";
    }

    // Same message as the unknown case: distinguishing them would confirm
    // another merchant's payout address to whoever guessed it.
    expect(message).toContain("not a wallet this deployment knows");
  });

  test("a treasury address is refused as a payout destination", async () => {
    const wallets = new InMemoryMerchantWalletRepository();
    await wallets.insert(wallet({ address: TREASURY }));

    // A fee recipient that is also a payout destination pays a merchant twice
    // and is invisible in the ledger.
    await expect(
      guard(wallets).assertPayable(MERCHANT, "base-sepolia", TREASURY),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  test("case is not a way past the guard", async () => {
    const wallets = new InMemoryMerchantWalletRepository();
    await wallets.insert(wallet());

    await expect(
      guard(wallets).assertPayable(MERCHANT, "base-sepolia", ADDRESS.toUpperCase()),
    ).resolves.toBeUndefined();

    expect(guard(wallets).isTreasury(TREASURY.toUpperCase())).toBe(true);
  });

  test("the same address cannot be claimed by two merchants", async () => {
    const wallets = new InMemoryMerchantWalletRepository();
    await wallets.insert(wallet());

    await expect(wallets.insert(wallet({ id: "wlt_2", merchantId: "mrc_2" }))).rejects.toThrow();
  });
});
