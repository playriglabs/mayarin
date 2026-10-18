import { describe, expect, test } from "bun:test";
import { isReviewedToken } from "../src/reviewed-tokens.ts";

const BASE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

describe("reviewed mainnet tokens (SEC-18)", () => {
  test("admits a listed mainnet token, whatever the address case", () => {
    expect(isReviewedToken("base", "USDC", BASE_USDC)).toBe(true);
    expect(isReviewedToken("base", "USDC", BASE_USDC.toLowerCase())).toBe(true);
  });

  test("refuses an unlisted address, asset or chain on a mainnet", () => {
    expect(isReviewedToken("base", "USDC", "0x1111111111111111111111111111111111111111")).toBe(
      false,
    );
    expect(isReviewedToken("base", "USDT", BASE_USDC)).toBe(false);
    expect(isReviewedToken("arbitrum", "USDC", BASE_USDC)).toBe(false);
  });

  test("does not check a testnet", () => {
    expect(
      isReviewedToken("base-sepolia", "USDC", "0x1111111111111111111111111111111111111111"),
    ).toBe(true);
  });
});
