import { describe, expect, test } from "bun:test";
import type { Config } from "../src/config.ts";
import { watchedPairs } from "../src/container.ts";

const CAKE = "0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82";
const USDC = "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d";

function configOf(overrides: Partial<Config>): Config {
  return {
    stablecoins: [{ asset: "USDC", onChain: [{ chain: "bsc", address: USDC }] }],
    chainNativeAssets: { bsc: "BNB" },
    chainAssets: { bsc: { USDC, CAKE } },
    ...overrides,
  } as unknown as Config;
}

describe("watchedPairs", () => {
  test("polls a payer-only token that is in CHAIN_ASSETS but not the registry", () => {
    const pairs = watchedPairs(configOf({}));
    expect(pairs).toContainEqual({ chain: "bsc", asset: "CAKE" });
  });

  test("still polls the registry's stablecoins and the native asset", () => {
    const pairs = watchedPairs(configOf({}));
    expect(pairs).toContainEqual({ chain: "bsc", asset: "USDC" });
    expect(pairs).toContainEqual({ chain: "bsc", asset: "BNB" });
  });

  test("lists a token once even when the registry and CHAIN_ASSETS both name it", () => {
    const pairs = watchedPairs(configOf({}));
    expect(pairs.filter((pair) => pair.asset === "USDC")).toHaveLength(1);
  });
});
