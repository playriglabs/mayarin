import { describe, expect, test } from "bun:test";
import { type AssetCode, assetDecimals, getAsset } from "@mayarin/shared";
import { isReviewedToken, REVIEWED_MAINNET_TOKENS } from "../src/reviewed-tokens.ts";
import { chainUnitScale } from "../src/token-units.ts";
import type { ChainId } from "../src/types.ts";

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

/**
 * `decimals()` of every reviewed token, as read back from its chain on 20 October 2026.
 * A token added to the reviewed list needs its line here, and the scale and the
 * registry are held against it: a stablecoin counted wrong is off by a power of ten.
 */
const ONCHAIN_DECIMALS: Readonly<Record<string, Readonly<Partial<Record<AssetCode, number>>>>> = {
  ethereum: {
    USDC: 6,
    USDT: 6,
    EURC: 6,
    DAI: 18,
    WETH: 18,
    WBTC: 8,
    LINK: 18,
    UNI: 18,
    AAVE: 18,
  },
  base: { USDC: 6, USDT: 6, EURC: 6, WETH: 18, CBBTC: 8 },
  arbitrum: {
    USDC: 6,
    USDT: 6,
    DAI: 18,
    USDG: 6,
    WETH: 18,
    WBTC: 8,
    ARB: 18,
    LINK: 18,
    UNI: 18,
    AAVE: 18,
  },
  polygon: { USDC: 6, USDT: 6, WETH: 18, WBTC: 8 },
  bsc: {
    USDC: 18,
    USDT: 18,
    DAI: 18,
    FDUSD: 18,
    WBNB: 18,
    BTCB: 18,
    UNI: 18,
    CAKE: 18,
  },
};

describe("reviewed tokens against what their contracts count in", () => {
  test("every reviewed token has its on-chain decimals recorded, and no more", () => {
    for (const [chain, tokens] of Object.entries(REVIEWED_MAINNET_TOKENS)) {
      expect(Object.keys(ONCHAIN_DECIMALS[chain] ?? {}).sort()).toEqual(
        Object.keys(tokens ?? {}).sort(),
      );
    }
  });

  test("a stablecoin's scale is what turns the registry's decimals into the contract's", () => {
    for (const [chain, tokens] of Object.entries(ONCHAIN_DECIMALS)) {
      for (const [asset, onChain] of Object.entries(tokens) as [AssetCode, number][]) {
        if (getAsset(asset).kind !== "stablecoin") continue;
        expect(chainUnitScale(chain as ChainId, asset)).toBe(
          10n ** BigInt(onChain - assetDecimals(asset)),
        );
      }
    }
  });

  test("a non-stablecoin is counted in the contract's own decimals, so it is never scaled", () => {
    for (const [chain, tokens] of Object.entries(ONCHAIN_DECIMALS)) {
      for (const [asset, onChain] of Object.entries(tokens) as [AssetCode, number][]) {
        if (getAsset(asset).kind === "stablecoin") continue;
        expect(assetDecimals(asset)).toBe(onChain);
        expect(chainUnitScale(chain as ChainId, asset)).toBe(1n);
      }
    }
  });
});

describe("the new Ethereum, Arbitrum and BNB Smart Chain tokens", () => {
  test("admit each at its address, whatever the case", () => {
    expect(isReviewedToken("ethereum", "DAI", "0x6b175474e89094c44da98b954eedeac495271d0f")).toBe(
      true,
    );
    expect(isReviewedToken("arbitrum", "USDG", "0x004b506865409877c9fa29bfb1eba929984b9bbc")).toBe(
      true,
    );
    expect(isReviewedToken("bsc", "FDUSD", "0xc5f0f7b66764f6ec8c8dff7ba683102295e16409")).toBe(
      true,
    );
    expect(isReviewedToken("bsc", "CAKE", "0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82")).toBe(true);
  });

  test("refuse another chain's address for the same asset", () => {
    expect(isReviewedToken("ethereum", "LINK", "0xf97f4df75117a78c1A5a0DBb814Af92458539FB4")).toBe(
      false,
    );
    expect(isReviewedToken("bsc", "WBNB", "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2")).toBe(
      false,
    );
  });

  test("BNB is the native coin of BNB Smart Chain and has no token address", () => {
    expect(REVIEWED_MAINNET_TOKENS.bsc?.BNB).toBeUndefined();
  });
});
