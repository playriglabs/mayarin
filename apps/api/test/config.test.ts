import { describe, expect, test } from "bun:test";
import { loadConfig } from "../src/config.ts";

const BASE = { DATABASE_URL: "postgres://localhost:5433/mayarin" } as const;
const XPUB =
  "xpub6EF8jXqFeFEW5bwMU7RpQtHkzE4KJxcqJtvkCjJumzW8CPpacXkb92ek4WzLQXjL93HycJwTPUAcuNxCqFPKKU5m5Z2Vq4nCyh5CyPeBFFr";

describe("chain configuration", () => {
  test("is absent unless enabled", () => {
    expect(loadConfig({ ...BASE }).chain).toBeUndefined();
  });

  test("parses the chain block when enabled", () => {
    const config = loadConfig({
      ...BASE,
      CHAIN_ENABLED: "true",
      ASSET_RECEIPT_MODE: "manual",
      CHAIN_RPC_URLS: '{"base-sepolia":"https://sepolia.base.org"}',
      CHAIN_ASSETS: '{"base-sepolia":{"USDC":"0x036CbD53842c5426634e7929541eC2318f3dCF7e"}}',
      CHAIN_CONFIRMATIONS: '{"base-sepolia":6}',
      DEPOSIT_XPUB: XPUB,
    });

    expect(config.chain?.confirmations["base-sepolia"]).toBe(6);
    // The watcher pairs now come from the stablecoin registry, not the chain block.
    expect(config.stablecoins).toEqual([
      { asset: "IDRX", onChain: [] },
      {
        asset: "USDC",
        onChain: [{ chain: "base-sepolia", address: "0x036cbd53842c5426634e7929541ec2318f3dcf7e" }],
      },
    ]);
  });

  test("refuses to boot with the watcher on and asset receipt on auto", () => {
    expect(() =>
      loadConfig({
        ...BASE,
        CHAIN_ENABLED: "true",
        ASSET_RECEIPT_MODE: "auto",
        CHAIN_RPC_URLS: '{"base-sepolia":"https://sepolia.base.org"}',
        CHAIN_ASSETS: '{"base-sepolia":{"USDC":"0x036CbD53842c5426634e7929541eC2318f3dCF7e"}}',
        DEPOSIT_XPUB: XPUB,
      }),
    ).toThrow(/ASSET_RECEIPT_MODE/);
  });

  test("refuses to boot with no deposit xpub", () => {
    expect(() =>
      loadConfig({
        ...BASE,
        CHAIN_ENABLED: "true",
        ASSET_RECEIPT_MODE: "manual",
        CHAIN_RPC_URLS: '{"base-sepolia":"https://sepolia.base.org"}',
        CHAIN_ASSETS: '{"base-sepolia":{"USDC":"0x036CbD53842c5426634e7929541eC2318f3dCF7e"}}',
      }),
    ).toThrow(/DEPOSIT_XPUB/);
  });

  test("refuses a configured asset with no RPC URL for its chain", () => {
    expect(() =>
      loadConfig({
        ...BASE,
        CHAIN_ENABLED: "true",
        ASSET_RECEIPT_MODE: "manual",
        CHAIN_RPC_URLS: "{}",
        CHAIN_ASSETS: '{"base-sepolia":{"USDC":"0x036CbD53842c5426634e7929541eC2318f3dCF7e"}}',
        DEPOSIT_XPUB: XPUB,
      }),
    ).toThrow(/RPC/);
  });
});

describe("stablecoin registry configuration", () => {
  test("builds the registry from SETTLEMENT_ASSETS unioned with CHAIN_ASSETS", () => {
    const config = loadConfig({
      ...BASE,
      SETTLEMENT_ASSETS: '["IDRX","USDC"]',
      CHAIN_ASSETS: '{"base-sepolia":{"USDC":"0xAbc"}}',
    });

    expect(config.stablecoins).toEqual([
      { asset: "IDRX", onChain: [] },
      { asset: "USDC", onChain: [{ chain: "base-sepolia", address: "0xabc" }] },
    ]);
  });

  test("defaults to IDRX when nothing is configured", () => {
    const config = loadConfig({ ...BASE });
    expect(config.stablecoins).toEqual([{ asset: "IDRX", onChain: [] }]);
  });

  test("refuses a non-stablecoin in SETTLEMENT_ASSETS", () => {
    expect(() => loadConfig({ ...BASE, SETTLEMENT_ASSETS: '["ETH"]' })).toThrow(/ETH/);
  });

  test("refuses an unknown asset in SETTLEMENT_ASSETS", () => {
    expect(() => loadConfig({ ...BASE, SETTLEMENT_ASSETS: '["NOPE"]' })).toThrow(/NOPE/);
  });

  test("refuses a non-stablecoin in CHAIN_ASSETS", () => {
    expect(() => loadConfig({ ...BASE, CHAIN_ASSETS: '{"base-sepolia":{"ETH":"0x0"}}' })).toThrow(
      /ETH/,
    );
  });

  test("refuses a default settlement asset outside the admitted set", () => {
    expect(() =>
      loadConfig({ ...BASE, SETTLEMENT_ASSETS: '["USDC"]', SETTLEMENT_ASSET: "IDRX" }),
    ).toThrow(/SETTLEMENT_ASSET/);
  });
});

describe("execution path configuration", () => {
  test("defaults to deposit-match", () => {
    expect(loadConfig({ ...BASE }).executionPath).toBe("deposit-match");
  });

  test("accepts the on-chain-contract path as a configured default", () => {
    // No boot guard: the engine stub fails a contract-path payment at runtime,
    // so the slot is reserved for Phase 3 to flip without a config redesign.
    expect(loadConfig({ ...BASE, EXECUTION_PATH: "on-chain-contract" }).executionPath).toBe(
      "on-chain-contract",
    );
  });
});
