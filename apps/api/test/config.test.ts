import { describe, expect, test } from "bun:test";
import { loadConfig } from "../src/config.ts";

const BASE = { DATABASE_URL: "postgres://localhost:5433/mayarin" } as const;
const XPUB =
  "xpub6EF8jXqFeFEW5bwMU7RpQtHkzE4KJxcqJtvkCjJumzW8CPpacXkb92ek4WzLQXjL93HycJwTPUAcuNxCqFPKKU5m5Z2Vq4nCyh5CyPeBFFr";

describe("empty environment variables", () => {
  test("an unused optional key left blank does not fail the boot", () => {
    // How a dotenv file documents a key it does not use. Treating `""` as
    // present made `.env.example` itself unbootable.
    const config = loadConfig({
      ...BASE,
      TURNKEY_ORGANIZATION_ID: "",
      TURNKEY_SIGN_WITH: "",
      ZERO_EX_API_KEY: "",
      DEPOSIT_XPUB: "",
    });

    expect(config.turnkeyOrganizationId).toBeUndefined();
    expect(config.zeroExApiKey).toBeUndefined();
  });

  test("a blank key a layer requires still fails, as required", () => {
    expect(() =>
      loadConfig({
        ...BASE,
        CHAIN_ENABLED: "true",
        ASSET_RECEIPT_MODE: "manual",
        CHAIN_RPC_URLS: '{"base-sepolia":"https://sepolia.base.org"}',
        CHAIN_ASSETS: '{"base-sepolia":{"USDC":"0x036CbD53842c5426634e7929541eC2318f3dCF7e"}}',
        DEPOSIT_XPUB: "",
      }),
    ).toThrow(/DEPOSIT_XPUB is required/i);
  });

  test("a blank key with no default is reported as missing, not as too short", () => {
    let issues: string[] = [];
    try {
      loadConfig({ DATABASE_URL: "" });
    } catch (error) {
      issues = (error as { details?: { issues?: string[] } }).details?.issues ?? [];
    }

    expect(issues).toContain("databaseUrl: Required");
  });
});

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

  test("refuses on-chain-contract as the default while the contract path is off", () => {
    // Every payment would fail at the lock step — a boot failure, not a
    // per-payment one (#61).
    expect(() => loadConfig({ ...BASE, EXECUTION_PATH: "on-chain-contract" })).toThrow(
      /CONTRACT_PATH_ENABLED/,
    );
  });
});

describe("contract path configuration", () => {
  const QUOTE = {
    QUOTE_ENABLED: "true",
    QUOTE_VENUES: '["0x"]',
    ZERO_EX_API_KEY: "key",
    ZERO_EX_CHAIN_ID: "8453",
    ZERO_EX_PAIRS: '{"ETH/USDC":{"sellToken":"0xe","buyToken":"0xu"}}',
    PYTH_FEEDS: '{"ETH/USDC":"ff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace"}',
    QUOTE_SIGNER: "local",
    QUOTE_SIGNER_PRIVATE_KEY: `0x${"11".repeat(32)}`,
    NODE_ENV: "development",
  } as const;
  const CONTRACT = {
    CONTRACT_PATH_ENABLED: "true",
    PAYMENT_ROUTERS: '{"base":"0x552008c0f6870c2f77e5cC1d2eb9bdff03e30Ea0"}',
    // The settlement asset must be deployed on a router chain, or no order
    // could ever name it.
    CHAIN_ASSETS: '{"base":{"IDRX":"0x18Bc5bcC660cf2B9cE3cd51a404aFe1a0cBD3C22"}}',
  } as const;

  test("is absent unless enabled", () => {
    expect(loadConfig({ ...BASE }).contract).toBeUndefined();
  });

  test("resolves with a router and a route-capable venue", () => {
    const config = loadConfig({ ...BASE, ...QUOTE, ...CONTRACT });
    expect(config.contract?.paymentRouters.base).toBe("0x552008c0f6870c2f77e5cC1d2eb9bdff03e30Ea0");
  });

  test("requires the quote layer", () => {
    expect(() => loadConfig({ ...BASE, ...CONTRACT })).toThrow(/QUOTE_ENABLED/);
  });

  test("requires a deployed router", () => {
    expect(() => loadConfig({ ...BASE, ...QUOTE, ...CONTRACT, PAYMENT_ROUTERS: "{}" })).toThrow(
      /PAYMENT_ROUTERS/,
    );
  });

  test("refuses a settlement asset that is on no chain with a router", () => {
    // Otherwise the misconfiguration surfaces per payment, at the moment a
    // payer is waiting, rather than at boot.
    expect(() =>
      loadConfig({
        ...BASE,
        ...QUOTE,
        ...CONTRACT,
        CHAIN_ASSETS: '{"base-sepolia":{"IDRX":"0x18Bc5bcC660cf2B9cE3cd51a404aFe1a0cBD3C22"}}',
      }),
    ).toThrow(/has no CHAIN_ASSETS address on any chain in PAYMENT_ROUTERS/);
  });

  test("accepts a settlement asset deployed on one of several router chains", () => {
    const config = loadConfig({
      ...BASE,
      ...QUOTE,
      ...CONTRACT,
      PAYMENT_ROUTERS:
        '{"base":"0x552008c0f6870c2f77e5cC1d2eb9bdff03e30Ea0","base-sepolia":"0x552008c0f6870c2f77e5cC1d2eb9bdff03e30Ea0"}',
      CHAIN_ASSETS: '{"base-sepolia":{"IDRX":"0x18Bc5bcC660cf2B9cE3cd51a404aFe1a0cBD3C22"}}',
    });

    expect(config.contract?.paymentRouters["base-sepolia"]).toBeDefined();
  });

  test("refuses a venue set with no route-capable venue — LiFi is price-only", () => {
    expect(() =>
      loadConfig({
        ...BASE,
        ...QUOTE,
        ...CONTRACT,
        QUOTE_VENUES: '["lifi"]',
        LIFI_PAIRS: '{"ETH/USDC":{"chainId":8453,"fromToken":"0xe","toToken":"0xu"}}',
        LIFI_FROM_ADDRESS: "0x552008c0f6870c2f77e5cC1d2eb9bdff03e30Ea0",
      }),
    ).toThrow(/route-capable/);
  });

  test("the uniswap venue needs SwapRouter02 addresses to serve routes", () => {
    expect(() =>
      loadConfig({
        ...BASE,
        ...QUOTE,
        ...CONTRACT,
        QUOTE_VENUES: '["uniswap"]',
        UNISWAP_POOLS: '{"ETH/USDC":{"chain":"base","tokenIn":"0xe","tokenOut":"0xu","fee":500}}',
      }),
    ).toThrow(/UNISWAP_SWAP_ROUTERS/);
  });
});

describe("quote configuration", () => {
  const PYTH_FEEDS =
    '{"ETH/USDC":"ff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace"}';
  const TURNKEY = {
    TURNKEY_ORGANIZATION_ID: "org-1",
    TURNKEY_SIGN_WITH: "key-1",
    TURNKEY_SIGNER_ADDRESS: "0x000000000000000000000000000000000000a11c",
    TURNKEY_API_PUBLIC_KEY: "02aaaa",
    TURNKEY_API_PRIVATE_KEY: "33".repeat(32),
  } as const;
  const ZERO_EX = {
    ZERO_EX_API_KEY: "key",
    ZERO_EX_CHAIN_ID: "8453",
    ZERO_EX_PAIRS: '{"ETH/USDC":{"sellToken":"0xe","buyToken":"0xu"}}',
  } as const;

  test("is absent unless enabled", () => {
    expect(loadConfig({ ...BASE }).quote).toBeUndefined();
  });

  test("parses the quote block when enabled", () => {
    const config = loadConfig({
      ...BASE,
      ...ZERO_EX,
      ...TURNKEY,
      QUOTE_ENABLED: "true",
      QUOTE_VENUES: '["0x"]',
      QUOTE_ORACLE: "pyth",
      PYTH_FEEDS,
      QUOTE_SLIPPAGE_BPS: "30",
      QUOTE_TTL_SECONDS: "45",
    });

    expect(config.quote).toEqual({
      venues: ["0x"],
      oracle: "pyth",
      deviationBps: 100,
      maxReferenceAgeSeconds: 60,
      peggedPairs: [],
      fxMaxAgeSeconds: 300,
      slippageBps: 30,
      ttlSeconds: 45,
      signer: "turnkey",
    });
  });

  test("refuses a venue with no pairs — it would price nothing", () => {
    expect(() =>
      loadConfig({
        ...BASE,
        ...TURNKEY,
        QUOTE_ENABLED: "true",
        QUOTE_VENUES: '["0x"]',
        PYTH_FEEDS,
        ZERO_EX_API_KEY: "key",
        ZERO_EX_CHAIN_ID: "8453",
      }),
    ).toThrow(/ZERO_EX_PAIRS/);
  });

  test("refuses an oracle with no feeds — it could not guard a deviation", () => {
    expect(() =>
      loadConfig({
        ...BASE,
        ...ZERO_EX,
        ...TURNKEY,
        QUOTE_ENABLED: "true",
        QUOTE_VENUES: '["0x"]',
        QUOTE_ORACLE: "chainlink",
      }),
    ).toThrow(/CHAINLINK_FEEDS/);
  });

  test("refuses an unsupported venue rather than ignoring it", () => {
    expect(() =>
      loadConfig({
        ...BASE,
        ...TURNKEY,
        QUOTE_ENABLED: "true",
        QUOTE_VENUES: '["sushiswap"]',
        PYTH_FEEDS,
      }),
    ).toThrow(/unsupported venue "sushiswap"/);
  });

  test("refuses turnkey signing with no credentials", () => {
    expect(() =>
      loadConfig({
        ...BASE,
        ...ZERO_EX,
        QUOTE_ENABLED: "true",
        QUOTE_VENUES: '["0x"]',
        PYTH_FEEDS,
      }),
    ).toThrow(/TURNKEY_ORGANIZATION_ID/);
  });

  // The promise docs/quote-signing.md makes. An in-process signing key can
  // authorize settlement amounts, so production must not be able to opt into it
  // by setting one environment variable.
  test("refuses the local signer outside development", () => {
    expect(() =>
      loadConfig({
        ...BASE,
        ...ZERO_EX,
        QUOTE_ENABLED: "true",
        QUOTE_VENUES: '["0x"]',
        PYTH_FEEDS,
        QUOTE_SIGNER: "local",
        QUOTE_SIGNER_PRIVATE_KEY: `0x${"44".repeat(32)}`,
        NODE_ENV: "production",
      }),
    ).toThrow(/refused when NODE_ENV is "production"/);
  });

  test("allows the local signer in development, with a key", () => {
    const config = loadConfig({
      ...BASE,
      ...ZERO_EX,
      QUOTE_ENABLED: "true",
      QUOTE_VENUES: '["0x"]',
      PYTH_FEEDS,
      QUOTE_SIGNER: "local",
      QUOTE_SIGNER_PRIVATE_KEY: `0x${"44".repeat(32)}`,
      NODE_ENV: "development",
    });
    expect(config.quote?.signer).toBe("local");
  });

  test("refuses the local signer without a key", () => {
    expect(() =>
      loadConfig({
        ...BASE,
        ...ZERO_EX,
        QUOTE_ENABLED: "true",
        QUOTE_VENUES: '["0x"]',
        PYTH_FEEDS,
        QUOTE_SIGNER: "local",
        NODE_ENV: "development",
      }),
    ).toThrow(/QUOTE_SIGNER_PRIVATE_KEY/);
  });
});
