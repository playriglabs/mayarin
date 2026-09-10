import { describe, expect, test } from "bun:test";
import { loadConfig } from "../src/config.ts";

const BASE = {
  DATABASE_URL: "postgres://localhost:5433/mayarin",
  PYTH_API_KEY: "test-key",
} as const;
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

describe("rate limit configuration", () => {
  test("has safe defaults and accepts deployment overrides", () => {
    expect(loadConfig({ ...BASE }).rateLimitRequests).toBe(120);

    const config = loadConfig({
      ...BASE,
      API_RATE_LIMIT_REQUESTS: "240",
      RATE_LIMIT_WINDOW_SECONDS: "30",
      RATE_LIMIT_BLOCK_SECONDS: "240",
      RATE_LIMIT_MAX_CLIENTS: "5000",
      RATE_LIMIT_CLIENT_IP_SOURCE: "cf-connecting-ip",
    });

    expect(config.rateLimitRequests).toBe(240);
    expect(config.rateLimitWindowSeconds).toBe(30);
    expect(config.rateLimitBlockSeconds).toBe(240);
    expect(config.rateLimitMaxClients).toBe(5_000);
    expect(config.rateLimitClientIpSource).toBe("cf-connecting-ip");
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
    expect(config.chain?.catchUpIntervalMs).toBe(1_000);
    expect(config.chain?.tokenBalanceCatchUp).toBe(false);
    // The watcher pairs now come from the stablecoin registry, not the chain block.
    expect(config.stablecoins).toEqual([
      {
        asset: "USDC",
        onChain: [{ chain: "base-sepolia", address: "0x036cbd53842c5426634e7929541ec2318f3dcf7e" }],
      },
    ]);
  });

  test("configures the watcher's rapid catch-up delay", () => {
    const config = loadConfig({
      ...BASE,
      CHAIN_ENABLED: "true",
      ASSET_RECEIPT_MODE: "manual",
      CHAIN_RPC_URLS: '{"base-sepolia":"https://sepolia.base.org"}',
      CHAIN_ASSETS: '{"base-sepolia":{"USDC":"0x036CbD53842c5426634e7929541eC2318f3dCF7e"}}',
      DEPOSIT_XPUB: XPUB,
      WATCHER_CATCH_UP_INTERVAL_MS: "250",
    });

    expect(config.chain?.catchUpIntervalMs).toBe(250);
  });

  test("token balance catch-up is explicit", () => {
    const config = loadConfig({
      ...BASE,
      CHAIN_ENABLED: "true",
      ASSET_RECEIPT_MODE: "manual",
      CHAIN_RPC_URLS: '{"base-sepolia":"https://sepolia.base.org"}',
      CHAIN_ASSETS: '{"base-sepolia":{"USDC":"0x036CbD53842c5426634e7929541eC2318f3dCF7e"}}',
      DEPOSIT_XPUB: XPUB,
      WATCHER_TOKEN_BALANCE_CATCH_UP: "true",
    });

    expect(config.chain?.tokenBalanceCatchUp).toBe(true);
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
      SETTLEMENT_ASSETS: '["USDT","USDC"]',
      CHAIN_ASSETS: '{"base-sepolia":{"USDC":"0xAbc"}}',
    });

    expect(config.stablecoins).toEqual([
      { asset: "USDC", onChain: [{ chain: "base-sepolia", address: "0xabc" }] },
      { asset: "USDT", onChain: [] },
    ]);
  });

  test("defaults to USDC when nothing is configured", () => {
    const config = loadConfig({ ...BASE });
    expect(config.stablecoins).toEqual([{ asset: "USDC", onChain: [] }]);
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
      loadConfig({ ...BASE, SETTLEMENT_ASSETS: '["USDC"]', SETTLEMENT_ASSET: "USDT" }),
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
    CHAIN_ASSETS: '{"base":{"USDC":"0x18Bc5bcC660cf2B9cE3cd51a404aFe1a0cBD3C22"}}',
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
        CHAIN_ASSETS: '{"base-sepolia":{"USDC":"0x18Bc5bcC660cf2B9cE3cd51a404aFe1a0cBD3C22"}}',
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
      CHAIN_ASSETS: '{"base-sepolia":{"USDC":"0x18Bc5bcC660cf2B9cE3cd51a404aFe1a0cBD3C22"}}',
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
      fallbackOracles: [],
      deviationBps: 100,
      unguardedTestnetPairs: [],
      oracleAgreementBps: 100,
      maxReferenceAgeSeconds: 60,
      peggedPairs: [],
      fxMaxAgeSeconds: 300,
      // Unset, so the closed market inherits the trading-hours bound and takes
      // no spread: a deployment that has said nothing keeps today's behaviour.
      fxClosedMaxAgeSeconds: 300,
      fxClosedSpreadBps: 0,
      slippageBps: 30,
      ttlSeconds: 45,
      signer: "turnkey",
    });
  });

  test("carries an explicit closed-market bound and spread through", () => {
    const config = loadConfig({
      ...BASE,
      ...ZERO_EX,
      ...TURNKEY,
      QUOTE_ENABLED: "true",
      QUOTE_VENUES: '["0x"]',
      PYTH_FEEDS,
      QUOTE_FX_CLOSED_MAX_AGE_SECONDS: "259200",
      QUOTE_FX_CLOSED_SPREAD_BPS: "75",
    });

    expect(config.quote?.fxClosedMaxAgeSeconds).toBe(259_200);
    expect(config.quote?.fxClosedSpreadBps).toBe(75);
  });

  test("refuses a closed-market bound tighter than the trading-hours one", () => {
    expect(() =>
      loadConfig({
        ...BASE,
        ...ZERO_EX,
        ...TURNKEY,
        QUOTE_ENABLED: "true",
        QUOTE_VENUES: '["0x"]',
        PYTH_FEEDS,
        QUOTE_FX_MAX_AGE_SECONDS: "300",
        QUOTE_FX_CLOSED_MAX_AGE_SECONDS: "60",
      }),
    ).toThrow(/QUOTE_FX_CLOSED_MAX_AGE_SECONDS/);
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

  test("resolves an ordered fallback oracle", () => {
    const config = loadConfig({
      ...BASE,
      ...ZERO_EX,
      ...TURNKEY,
      QUOTE_ENABLED: "true",
      QUOTE_VENUES: '["0x"]',
      PYTH_FEEDS,
      QUOTE_ORACLE_FALLBACKS: '["chainlink"]',
      CHAINLINK_FEEDS:
        '{"ETH/USDC":{"chain":"base-sepolia","address":"0x0000000000000000000000000000000000000001"}}',
    });

    expect(config.quote?.fallbackOracles).toEqual(["chainlink"]);
  });

  test("resolves the FX oracle as the fiat leg beside Pyth's crypto feeds", () => {
    const config = loadConfig({
      ...BASE,
      ...ZERO_EX,
      ...TURNKEY,
      QUOTE_ENABLED: "true",
      QUOTE_VENUES: '["0x"]',
      PYTH_FEEDS,
      QUOTE_ORACLE_FALLBACKS: '["fx"]',
      FX_FEEDS: '{"IDR/USDC":{"symbol":"USD/IDR","invert":true}}',
    });

    expect(config.quote?.fallbackOracles).toEqual(["fx"]);
    expect(config.fxFeeds).toEqual({ "IDR/USDC": { symbol: "USD/IDR", invert: true } });
  });

  test("refuses the FX oracle with no series — it could price no fiat leg", () => {
    expect(() =>
      loadConfig({
        ...BASE,
        ...ZERO_EX,
        ...TURNKEY,
        QUOTE_ENABLED: "true",
        QUOTE_VENUES: '["0x"]',
        PYTH_FEEDS,
        QUOTE_ORACLE_FALLBACKS: '["fx"]',
      }),
    ).toThrow(/FX_FEEDS/);
  });

  // The bug the split exists to prevent: a testnet has to widen the venue bound
  // to ~9900 for a toy pool, and while one knob served both, that also told two
  // oracles they could disagree by 99%.
  test("a wide venue bound does not widen the oracle cross-check", () => {
    const config = loadConfig({
      ...BASE,
      ...ZERO_EX,
      ...TURNKEY,
      QUOTE_ENABLED: "true",
      QUOTE_VENUES: '["0x"]',
      PYTH_FEEDS,
      QUOTE_DEVIATION_BPS: "9900",
    });

    expect(config.quote?.deviationBps).toBe(9_900);
    expect(config.quote?.oracleAgreementBps).toBe(100);
  });

  test("carries an explicit oracle agreement bound through", () => {
    const config = loadConfig({
      ...BASE,
      ...ZERO_EX,
      ...TURNKEY,
      QUOTE_ENABLED: "true",
      QUOTE_VENUES: '["0x"]',
      PYTH_FEEDS,
      QUOTE_ORACLE_AGREEMENT_BPS: "50",
    });

    expect(config.quote?.oracleAgreementBps).toBe(50);
  });

  test("resolves a second crypto source beside Pyth", () => {
    const config = loadConfig({
      ...BASE,
      ...ZERO_EX,
      ...TURNKEY,
      QUOTE_ENABLED: "true",
      QUOTE_VENUES: '["0x"]',
      PYTH_FEEDS,
      QUOTE_ORACLE_FALLBACKS: '["coinbase"]',
      COINBASE_PRODUCTS: '{"ETH/USDC":"ETH-USD"}',
    });

    expect(config.quote?.fallbackOracles).toEqual(["coinbase"]);
    expect(config.coinbaseProducts).toEqual({ "ETH/USDC": "ETH-USD" });
  });

  test("refuses the Coinbase oracle with no products", () => {
    expect(() =>
      loadConfig({
        ...BASE,
        ...ZERO_EX,
        ...TURNKEY,
        QUOTE_ENABLED: "true",
        QUOTE_VENUES: '["0x"]',
        PYTH_FEEDS,
        QUOTE_ORACLE_FALLBACKS: '["coinbase"]',
      }),
    ).toThrow(/COINBASE_PRODUCTS/);
  });

  test("refuses duplicate oracle sources", () => {
    expect(() =>
      loadConfig({
        ...BASE,
        ...ZERO_EX,
        ...TURNKEY,
        QUOTE_ENABLED: "true",
        QUOTE_VENUES: '["0x"]',
        PYTH_FEEDS,
        QUOTE_ORACLE_FALLBACKS: '["pyth"]',
      }),
    ).toThrow(/must not contain duplicates/);
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
  test("refuses the local signer for a mainnet router", () => {
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
        PAYMENT_ROUTERS: '{"base":"0x552008c0f6870c2f77e5cC1d2eb9bdff03e30Ea0"}',
      }),
    ).toThrow(/refused for mainnet PaymentRouter chains: base/);
  });

  test("allows the local signer for a testnet router in a production runtime", () => {
    const config = loadConfig({
      ...BASE,
      ...ZERO_EX,
      QUOTE_ENABLED: "true",
      QUOTE_VENUES: '["0x"]',
      PYTH_FEEDS,
      QUOTE_SIGNER: "local",
      QUOTE_SIGNER_PRIVATE_KEY: `0x${"44".repeat(32)}`,
      NODE_ENV: "production",
      PAYMENT_ROUTERS: '{"base-sepolia":"0x552008c0f6870c2f77e5cC1d2eb9bdff03e30Ea0"}',
    });

    expect(config.quote?.signer).toBe("local");
  });

  test("requires complete AWS KMS signer configuration", () => {
    expect(() =>
      loadConfig({
        ...BASE,
        ...ZERO_EX,
        QUOTE_ENABLED: "true",
        QUOTE_VENUES: '["0x"]',
        PYTH_FEEDS,
        QUOTE_SIGNER: "aws-kms",
      }),
    ).toThrow(/AWS_KMS_KEY_ID/);
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

describe("treasury execution configuration", () => {
  const CONTRACT = {
    ...BASE,
    CHAIN_ENABLED: "true",
    ASSET_RECEIPT_MODE: "manual",
    CHAIN_RPC_URLS: '{"base-sepolia":"https://sepolia.base.org"}',
    CHAIN_ASSETS: '{"base-sepolia":{"USDC":"0x036CbD53842c5426634e7929541eC2318f3dCF7e"}}',
    DEPOSIT_XPUB: XPUB,
    QUOTE_ENABLED: "true",
    QUOTE_VENUES: '["uniswap"]',
    PYTH_FEEDS: '{"ETH/USDC":"0xff"}',
    UNISWAP_POOLS:
      '{"ETH/USDC":{"chain":"base-sepolia","tokenIn":"0x4200000000000000000000000000000000000006","tokenOut":"0x036CbD53842c5426634e7929541eC2318f3dCF7e","fee":3000}}',
    UNISWAP_QUOTERS: '{"base-sepolia":"0xC5290058841028F1614F3A6F0F5816cAd0df5E27"}',
    UNISWAP_SWAP_ROUTERS: '{"base-sepolia":"0x94cC0AaC535CCDB3C01d6787D6413C739ae12bc4"}',
    QUOTE_SIGNER: "local",
    QUOTE_SIGNER_PRIVATE_KEY: `0x${"11".repeat(32)}`,
    SETTLEMENT_ASSET: "USDC",
    CONTRACT_PATH_ENABLED: "true",
    PAYMENT_ROUTERS: '{"base-sepolia":"0xEe7c5B5a9eeAf667A6EFb217A8a77534C873f7a9"}',
  } as const;

  const EXECUTOR = {
    TREASURY_EXECUTION_ENABLED: "true",
    TREASURY_ADDRESS: "0x616e2B9Bc83D60790E70CbaAc6c8612AFc6A7896",
    OPERATOR_PRIVATE_KEY: `0x${"22".repeat(32)}`,
    DEPOSIT_FORWARDERS: '{"base-sepolia":"0x5b73C5498c1E3b4dbA84de0F1833c4a029d90519"}',
    DEPOSIT_FORWARDER_INIT_CODE_HASH: `0x${"33".repeat(32)}`,
  } as const;

  test("is off by default, leaving the deposit path as it was", () => {
    expect(loadConfig({ ...CONTRACT }).treasuryExecutionEnabled).toBe(false);
  });

  test("accepts a complete executor configuration", () => {
    const config = loadConfig({ ...CONTRACT, ...EXECUTOR });

    expect(config.treasuryExecutionEnabled).toBe(true);
    expect(config.treasuryAddress).toBe("0x616e2B9Bc83D60790E70CbaAc6c8612AFc6A7896");
    expect(config.treasuryMaxAttempts).toBe(3);
  });

  test("refuses relayed fees that consume the merchant payout", () => {
    expect(() =>
      loadConfig({
        ...CONTRACT,
        ...EXECUTOR,
        FEE_BASIS_POINTS: "9999",
        RELAYER_GAS_FEE_BASIS_POINTS: "1",
      }),
    ).toThrow(/must leave a positive merchant payout/);
  });

  test.each([
    ["TREASURY_ADDRESS", "TREASURY_ADDRESS"],
    ["OPERATOR_PRIVATE_KEY", "OPERATOR_PRIVATE_KEY"],
    ["DEPOSIT_FORWARDER_INIT_CODE_HASH", "DEPOSIT_FORWARDER_INIT_CODE_HASH"],
  ])("refuses a half-configured executor: missing %s", (missing, message) => {
    // A half-configured executor fails per payment, with the payer's asset
    // already sitting at a deposit address. Boot is the only safe place.
    const env: Record<string, string | undefined> = { ...CONTRACT, ...EXECUTOR };
    env[missing] = undefined;

    expect(() => loadConfig(env)).toThrow(new RegExp(message));
  });

  test("refuses a router chain with no forwarder factory", () => {
    expect(() => loadConfig({ ...CONTRACT, ...EXECUTOR, DEPOSIT_FORWARDERS: "{}" })).toThrow(
      /DEPOSIT_FORWARDERS/,
    );
  });

  test("refuses execution without the quote layer that prices and signs it", () => {
    expect(() =>
      loadConfig({
        ...CONTRACT,
        ...EXECUTOR,
        QUOTE_ENABLED: "false",
        CONTRACT_PATH_ENABLED: "false",
      }),
    ).toThrow(/quote layer/);
  });
});
