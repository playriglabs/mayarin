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

  test("Ethereum admits USDC, USDT and EURC at their canonical addresses", () => {
    expect(isReviewedToken("ethereum", "USDC", "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48")).toBe(
      true,
    );
    expect(isReviewedToken("ethereum", "USDT", "0xdac17f958d2ee523a2206206994597c13d831ec7")).toBe(
      true,
    );
    expect(isReviewedToken("ethereum", "EURC", "0x1aBaEA1f7C830bD89Acc67eC4af516284b1bC33c")).toBe(
      true,
    );
    // A PYUSD or any other token is not reviewed here.
    expect(isReviewedToken("ethereum", "PYUSD", "0x6c3ea9036406852006290770BEdFcAbA0e23A0e8")).toBe(
      false,
    );
  });

  test("Polygon admits Circle's native USDC and nothing else", () => {
    expect(isReviewedToken("polygon", "USDC", "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359")).toBe(
      true,
    );
    // The address Polygon USDT lived at now answers as USDT0, an OFT: not reviewed.
    expect(isReviewedToken("polygon", "USDT", "0xc2132D05D31c914a87C6611C10748AEb04B58e8F")).toBe(
      false,
    );
    // The bridged USDC.e is a different token at a different address.
    expect(isReviewedToken("polygon", "USDC", "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174")).toBe(
      false,
    );
  });

  test("BNB Smart Chain admits its two reviewed stablecoins, whatever the case", () => {
    expect(isReviewedToken("bsc", "USDT", "0x55d398326f99059ff775485246999027b3197955")).toBe(true);
    expect(isReviewedToken("bsc", "USDC", "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d")).toBe(true);
    expect(isReviewedToken("bsc", "USDC", "0x1111111111111111111111111111111111111111")).toBe(
      false,
    );
  });

  test("does not check a testnet", () => {
    expect(
      isReviewedToken("base-sepolia", "USDC", "0x1111111111111111111111111111111111111111"),
    ).toBe(true);
  });
});
