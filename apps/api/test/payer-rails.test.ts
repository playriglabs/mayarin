import { describe, expect, test } from "bun:test";
import type { OfferedRail } from "@mayarin/payment-intent";
import { payerRails } from "../src/rails.ts";

const BASE_RAIL: OfferedRail = {
  chain: "base-sepolia",
  asset: "USDC",
  contract: "0x3600",
  settlementAsset: "USDC",
};
const ARC_RAIL: OfferedRail = {
  chain: "arc-testnet",
  asset: "USDC",
  contract: "0x3600",
  settlementAsset: "USDC",
};

describe("payerRails", () => {
  test("keeps merchant/catalog order", async () => {
    const rails = await payerRails([BASE_RAIL, ARC_RAIL]);

    expect(rails).toEqual([
      { chain: "base-sepolia", asset: "USDC", contract: "0x3600", settlementAsset: "USDC" },
      { chain: "arc-testnet", asset: "USDC", contract: "0x3600", settlementAsset: "USDC" },
    ]);
  });
});
