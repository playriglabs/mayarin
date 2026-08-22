import { describe, expect, test } from "bun:test";
import { WalletGuard } from "@mayarin/wallet";
import { InMemoryMerchantWalletRepository } from "@mayarin/wallet/testing";
import { trustedSettlementWallet } from "../scripts/trusted-settlement-wallet.ts";

const MERCHANT_ID = "mrc_seeded";
const ADDRESS = "0xAAbbCCddEEff0011223344556677889900aAbBcC";
const TRUSTED_AT = new Date("2026-08-22T07:25:00.000Z");

describe("trustedSettlementWallet", () => {
  test("creates the linked verified wallet that makes a seeded destination payable", async () => {
    const wallets = new InMemoryMerchantWalletRepository();
    const wallet = trustedSettlementWallet({
      merchantId: MERCHANT_ID,
      chain: "base-sepolia",
      address: ADDRESS,
      trustedAt: TRUSTED_AT,
    });

    expect(wallet).toMatchObject({
      id: expect.stringMatching(/^wlt_/),
      merchantId: MERCHANT_ID,
      chain: "base-sepolia",
      address: ADDRESS.toLowerCase(),
      provenance: "linked",
      verifiedAt: TRUSTED_AT,
      createdAt: TRUSTED_AT,
      updatedAt: TRUSTED_AT,
    });

    await wallets.insert(wallet);
    const guard = new WalletGuard({ wallets, treasuryAddresses: [] });
    await expect(
      guard.assertPayable(MERCHANT_ID, "base-sepolia", ADDRESS),
    ).resolves.toBeUndefined();
  });
});
