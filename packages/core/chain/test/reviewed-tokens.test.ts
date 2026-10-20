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

  test("Base admits USDT at Tether's bridged address and nowhere else", () => {
    expect(isReviewedToken("base", "USDT", "0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2")).toBe(
      true,
    );
    expect(isReviewedToken("base", "USDT", "0x1111111111111111111111111111111111111111")).toBe(
      false,
    );
  });

  test("Polygon admits Circle's native USDC and USDT0 at the old USDT address", () => {
    expect(isReviewedToken("polygon", "USDC", "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359")).toBe(
      true,
    );
    expect(isReviewedToken("polygon", "USDT", "0xc2132D05D31c914a87C6611C10748AEb04B58e8F")).toBe(
      true,
    );
    // The bridged USDC.e is a different token at a different address.
    expect(isReviewedToken("polygon", "USDC", "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174")).toBe(
      false,
    );
  });

  test("Base and Polygon admit the payer-only ERC-20s at their canonical addresses", () => {
    expect(isReviewedToken("base", "WETH", "0x4200000000000000000000000000000000000006")).toBe(
      true,
    );
    expect(isReviewedToken("base", "CBBTC", "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf")).toBe(
      true,
    );
    expect(isReviewedToken("polygon", "WETH", "0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619")).toBe(
      true,
    );
    expect(isReviewedToken("polygon", "WBTC", "0x1BFD67037B42Cf73acF2047067bd4F2C47D9BfD6")).toBe(
      true,
    );
    // Not the other chain's token, and not an unlisted address.
    expect(isReviewedToken("polygon", "WETH", "0x4200000000000000000000000000000000000006")).toBe(
      false,
    );
    expect(isReviewedToken("base", "WBTC", "0x1BFD67037B42Cf73acF2047067bd4F2C47D9BfD6")).toBe(
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
