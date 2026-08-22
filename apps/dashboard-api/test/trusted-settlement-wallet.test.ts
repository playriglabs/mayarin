import { describe, expect, test } from "bun:test";
import { InMemoryMerchantWalletRepository } from "@mayarin/wallet/testing";
import { trustedSettlementWallet } from "../scripts/trusted-settlement-wallet.ts";

const MERCHANT_ID = "mrc_seeded";
const ADDRESS = "0xAAbbCCddEEff0011223344556677889900aAbBcC";
const TRUSTED_AT = new Date("2026-08-22T07:25:00.000Z");

describe("trustedSettlementWallet", () => {
  test("creates an explicitly trusted linked wallet for a disposable fixture", async () => {
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
    expect(await wallets.findByAddress("base-sepolia", ADDRESS)).toEqual(wallet);
  });
});
