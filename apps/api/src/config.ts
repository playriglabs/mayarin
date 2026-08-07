/**
 * Runtime configuration.
 *
 * Validated once at startup: a deployment with a bad settlement asset or fee
 * should fail to boot, not fail on the first payment.
 */

import { CHAIN_IDS, type ChainId } from "@mayarin/chain";
import {
  type AssetCode,
  assetCodeSchema,
  ConfigurationError,
  getAsset,
  isAssetCode,
} from "@mayarin/shared";
import type { Stablecoin, StablecoinOnChain } from "@mayarin/stablecoin";
import { z } from "zod";

type RpcUrlMap = Partial<Record<ChainId, string>>;
type TokenMap = Partial<Record<ChainId, Partial<Record<AssetCode, string>>>>;
type ConfirmationMap = Partial<Record<ChainId, number>>;
type StartBlockMap = Partial<Record<ChainId, string>>;

/** Parses a JSON env var into a plain object, failing the boot rather than the first request. */
function jsonObject<T>(name: string, fallback: string) {
  return z
    .string()
    .default(fallback)
    .transform((value, ctx): T => {
      try {
        return JSON.parse(value) as T;
      } catch {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${name} must be valid JSON`,
        });
        return z.NEVER;
      }
    });
}

const configSchema = z.object({
  port: z.coerce.number().int().positive().default(3000),
  databaseUrl: z.string().min(1),
  settlementAsset: assetCodeSchema.default("IDRX"),
  /** Admissible settlement set, JSON array of AssetCode. Defaults to IDRX only. */
  settlementAssets: jsonObject<string[]>("SETTLEMENT_ASSETS", '["IDRX"]'),
  feeBasisPoints: z.coerce.number().int().min(0).max(10_000).default(50),
  defaultProvider: z.string().min(1).default("mock"),
  paymentIntentTtlSeconds: z.coerce.number().int().positive().default(900),
  /**
   * `auto` treats a payment as funded when it reaches PAYMENT_PENDING — the
   * stand-in for the wallet watcher that confirms a deposit-match payment's
   * asset arrived. `manual` leaves the payment waiting until something records
   * the receipt. Deposit-matching is the fallback execution path; the Phase 3
   * on-chain-contract path funds atomically and does not wait here.
   */
  assetReceiptMode: z.enum(["auto", "manual"]).default("auto"),
  /**
   * How a payment rail is executed. `deposit-match` (the fallback) watches a
   * per-intent deposit address; `on-chain-contract` is the Phase 3 primary path
   * that settles atomically via PaymentRouter.sol. Only `deposit-match` is
   * implemented today; the engine fails a contract-path payment until Phase 3.
   */
  executionPath: z.enum(["deposit-match", "on-chain-contract"]).default("deposit-match"),
  /** Minor units of the target asset per whole unit of the source asset. */
  exchangeRates: z
    .string()
    .default('{"IDR/IDRX":"100"}')
    .transform((value, ctx) => {
      try {
        const parsed = z.record(z.string(), z.string()).parse(JSON.parse(value));
        return Object.fromEntries(
          Object.entries(parsed).map(([pair, rate]) => [pair, BigInt(rate)]),
        );
      } catch {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'EXCHANGE_RATES must be JSON like {"IDR/IDRX":"100"}',
        });
        return z.NEVER;
      }
    }),
  chainEnabled: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  chainRpcUrls: jsonObject<RpcUrlMap>("CHAIN_RPC_URLS", "{}"),
  chainAssets: jsonObject<TokenMap>("CHAIN_ASSETS", "{}"),
  chainConfirmations: jsonObject<ConfirmationMap>("CHAIN_CONFIRMATIONS", "{}"),
  chainStartBlocks: jsonObject<StartBlockMap>("CHAIN_START_BLOCKS", "{}"),
  depositXpub: z.string().min(1).optional(),
  watcherIntervalMs: z.coerce.number().int().min(0).default(15_000),
  watcherBlockRange: z.coerce.number().int().positive().default(2_000),
  watcherRetentionSeconds: z.coerce.number().int().positive().default(86_400),
  watcherReorgWatchWindow: z.coerce.number().int().positive().default(2),
  adminToken: z.string().min(16).optional(),
  mockWebhookSecret: z.string().min(1).optional(),

  // --- Quote layer (RFC #6/#7, wired in the container) -------------------
  /**
   * Off by default, like the chain layer. A deployment that has not configured
   * a venue, an oracle and a signer should boot without a quote engine rather
   * than boot with a half-built one.
   */
  quoteEnabled: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  /** Venue adapters to price against, in preference order for tie-breaks. */
  quoteVenues: jsonObject<string[]>("QUOTE_VENUES", "[]"),
  /** Reference oracle for the deviation guard. */
  quoteOracle: z.enum(["pyth", "chainlink"]).default("pyth"),
  /** How far the venue price may sit from the oracle before the quote fails. */
  quoteDeviationBps: z.coerce.number().int().min(1).max(10_000).default(100),
  /** How stale a reference may be and still vouch for a price. */
  quoteMaxReferenceAgeSeconds: z.coerce.number().int().positive().default(60),
  /**
   * Fiat/stablecoin pairs that are the same currency in two representations,
   * e.g. `["IDR/IDRX"]`. Declared, never inferred: whether an issuer holds its
   * peg is a judgement about that issuer, not something an asset code implies.
   */
  quotePeggedPairs: jsonObject<string[]>("QUOTE_PEGGED_PAIRS", "[]"),
  /**
   * Staleness bound for the FX leg. Separate from the swap leg's bound because
   * an FX feed and a DEX quote go stale at very different rates.
   */
  quoteFxMaxAgeSeconds: z.coerce.number().int().positive().default(300),
  /** Slippage bound on the payer estimate. Never moves the merchant's `minOut`. */
  quoteSlippageBps: z.coerce.number().int().min(0).max(9_999).default(50),
  /** Lock TTL, which becomes the order `deadline`. */
  quoteTtlSeconds: z.coerce.number().int().positive().default(60),
  /** Pyth pair to Hermes feed id. */
  pythFeeds: jsonObject<Record<string, string>>("PYTH_FEEDS", "{}"),
  /** Chainlink pair to `{ chain, address }`. */
  chainlinkFeeds: jsonObject<Record<string, { chain: ChainId; address: string }>>(
    "CHAINLINK_FEEDS",
    "{}",
  ),
  zeroExApiKey: z.string().min(1).optional(),
  zeroExChainId: z.coerce.number().int().positive().optional(),
  zeroExPairs: jsonObject<Record<string, unknown>>("ZERO_EX_PAIRS", "{}"),
  uniswapQuoters: jsonObject<Partial<Record<ChainId, string>>>("UNISWAP_QUOTERS", "{}"),
  uniswapPools: jsonObject<Record<string, unknown>>("UNISWAP_POOLS", "{}"),
  lifiPairs: jsonObject<Record<string, unknown>>("LIFI_PAIRS", "{}"),
  lifiFromAddress: z.string().min(1).optional(),
  lifiApiKey: z.string().min(1).optional(),

  // --- Quote signing (RFC #6 — #41) --------------------------------------
  /**
   * `turnkey` keeps the key in an enclave. `local` holds it in this process and
   * is refused outside development — see `docs/quote-signing.md`.
   */
  quoteSigner: z.enum(["turnkey", "local"]).default("turnkey"),
  turnkeyOrganizationId: z.string().min(1).optional(),
  turnkeySignWith: z.string().min(1).optional(),
  turnkeySignerAddress: z.string().min(1).optional(),
  turnkeyApiPublicKey: z.string().min(1).optional(),
  turnkeyApiPrivateKey: z.string().min(1).optional(),
  /** Development only. Refused when `NODE_ENV` is not `development`. */
  quoteSignerPrivateKey: z.string().min(1).optional(),

  // --- Contract execution path (#61) --------------------------------------
  /**
   * Off by default. Requires the quote layer: the contract path locks
   * through the quote engine and signs with the quote signer.
   */
  contractPathEnabled: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  /** Deployed `PaymentRouter` address per chain. */
  paymentRouters: jsonObject<Partial<Record<ChainId, string>>>("PAYMENT_ROUTERS", "{}"),
  /**
   * Treasury execution (#69/#81): converts a matched deposit into the
   * settlement asset instead of settling it internally.
   */
  treasuryExecutionEnabled: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  /** Deployed `DepositForwarderFactory` per chain. */
  depositForwarders: jsonObject<Partial<Record<ChainId, string>>>("DEPOSIT_FORWARDERS", "{}"),
  /** `DepositForwarderFactory.INIT_CODE_HASH()`, which deposit addresses derive from. */
  depositForwarderInitCodeHash: z.string().min(1).optional(),
  /** Receives swap output above `minOut` — the deposit path's `refundTo`. */
  treasuryAddress: z.string().min(1).optional(),
  /** The operator key. Pays gas and is the one key that can move funds. */
  operatorPrivateKey: z.string().min(1).optional(),
  treasuryMaxAttempts: z.coerce.number().int().positive().default(3),
  /**
   * The Safe that receives settlements. One address for the whole deployment
   * — per-merchant wallets arrive with Phase 4 (#11).
   */
  /** `SwapRouter02` address per chain, for the Uniswap route source. */
  uniswapSwapRouters: jsonObject<Partial<Record<ChainId, string>>>("UNISWAP_SWAP_ROUTERS", "{}"),
  nodeEnv: z.string().default("development"),
});

export type RawConfig = z.infer<typeof configSchema>;

export interface ChainConfig {
  readonly rpcUrls: Readonly<Partial<Record<ChainId, string>>>;
  readonly confirmations: Readonly<Record<ChainId, number>>;
  readonly startBlocks: Readonly<Partial<Record<ChainId, bigint>>>;
  readonly xpub: string;
  readonly intervalMs: number;
  readonly blockRange: number;
  readonly retentionSeconds: number;
  readonly reorgWatchWindow: number;
}

/** Resolved quote-layer configuration. Present only when `QUOTE_ENABLED=true`. */
export interface QuoteConfig {
  readonly venues: readonly string[];
  readonly oracle: "pyth" | "chainlink";
  readonly deviationBps: number;
  readonly maxReferenceAgeSeconds: number;
  readonly peggedPairs: readonly string[];
  readonly fxMaxAgeSeconds: number;
  readonly slippageBps: number;
  readonly ttlSeconds: number;
  readonly signer: "turnkey" | "local";
}

/** Resolved contract-path configuration. Present only when `CONTRACT_PATH_ENABLED=true`. */
export interface ContractConfig {
  readonly paymentRouters: Readonly<Partial<Record<ChainId, string>>>;
}

export type Config = RawConfig & {
  readonly chain?: ChainConfig;
  readonly quote?: QuoteConfig;
  readonly contract?: ContractConfig;
  readonly stablecoins: readonly Stablecoin[];
};

const SUPPORTED_VENUES = ["0x", "uniswap", "lifi"] as const;

/**
 * Resolves the quote layer, failing the boot rather than the first quote.
 *
 * A half-configured quote engine is worse than none: a venue with no pairs
 * prices nothing, an oracle with no feeds cannot guard, and a signer with no key
 * produces orders the contract rejects. Every one of those is a deployment
 * mistake that should never reach a payer.
 */
function resolveQuote(data: RawConfig): QuoteConfig | undefined {
  if (!data.quoteEnabled) {
    return undefined;
  }

  const issues: string[] = [];

  if (data.quoteVenues.length === 0) {
    issues.push("QUOTE_VENUES must name at least one venue when QUOTE_ENABLED is true");
  }
  for (const venue of data.quoteVenues) {
    if (!(SUPPORTED_VENUES as readonly string[]).includes(venue)) {
      issues.push(`QUOTE_VENUES names an unsupported venue "${venue}"`);
      continue;
    }
    if (venue === "0x") {
      if (data.zeroExApiKey === undefined)
        issues.push("ZERO_EX_API_KEY is required for the 0x venue");
      if (data.zeroExChainId === undefined)
        issues.push("ZERO_EX_CHAIN_ID is required for the 0x venue");
      if (Object.keys(data.zeroExPairs).length === 0)
        issues.push("ZERO_EX_PAIRS must configure at least one pair");
    }
    if (venue === "uniswap" && Object.keys(data.uniswapPools).length === 0) {
      issues.push("UNISWAP_POOLS must configure at least one pool for the uniswap venue");
    }
    if (venue === "lifi") {
      if (data.lifiFromAddress === undefined)
        issues.push("LIFI_FROM_ADDRESS is required for the lifi venue");
      if (Object.keys(data.lifiPairs).length === 0)
        issues.push("LIFI_PAIRS must configure at least one pair");
    }
  }

  if (data.quoteOracle === "pyth" && Object.keys(data.pythFeeds).length === 0) {
    issues.push("PYTH_FEEDS must configure at least one feed when QUOTE_ORACLE is pyth");
  }
  if (data.quoteOracle === "chainlink" && Object.keys(data.chainlinkFeeds).length === 0) {
    issues.push("CHAINLINK_FEEDS must configure at least one feed when QUOTE_ORACLE is chainlink");
  }

  if (data.quoteSigner === "turnkey") {
    if (data.turnkeyOrganizationId === undefined)
      issues.push("TURNKEY_ORGANIZATION_ID is required");
    if (data.turnkeySignWith === undefined) issues.push("TURNKEY_SIGN_WITH is required");
    if (data.turnkeySignerAddress === undefined) issues.push("TURNKEY_SIGNER_ADDRESS is required");
    if (data.turnkeyApiPublicKey === undefined) issues.push("TURNKEY_API_PUBLIC_KEY is required");
    if (data.turnkeyApiPrivateKey === undefined) issues.push("TURNKEY_API_PRIVATE_KEY is required");
  } else {
    // The promise `docs/quote-signing.md` makes: the composition root refuses an
    // in-process signing key outside development. Anything that can read the
    // process could otherwise authorize settlement amounts.
    if (data.nodeEnv !== "development") {
      issues.push(
        `QUOTE_SIGNER=local holds the quote-signing key in this process and is refused when ` +
          `NODE_ENV is "${data.nodeEnv}"; use QUOTE_SIGNER=turnkey outside development`,
      );
    }
    if (data.quoteSignerPrivateKey === undefined) {
      issues.push("QUOTE_SIGNER_PRIVATE_KEY is required when QUOTE_SIGNER is local");
    }
  }

  if (issues.length > 0) {
    throw new ConfigurationError(`Invalid quote configuration: ${issues.join("; ")}`, { issues });
  }

  return {
    venues: data.quoteVenues,
    oracle: data.quoteOracle,
    deviationBps: data.quoteDeviationBps,
    maxReferenceAgeSeconds: data.quoteMaxReferenceAgeSeconds,
    peggedPairs: data.quotePeggedPairs,
    fxMaxAgeSeconds: data.quoteFxMaxAgeSeconds,
    slippageBps: data.quoteSlippageBps,
    ttlSeconds: data.quoteTtlSeconds,
    signer: data.quoteSigner,
  };
}

const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;

/**
 * Resolves the contract execution path (#61), failing the boot rather than
 * the first payment. The path needs the quote layer (it locks and signs
 * through it), a deployed router per served chain, a settlement Safe, and at
 * least one venue that can produce an executable route.
 */
function resolveContract(
  data: RawConfig,
  quote: QuoteConfig | undefined,
  stablecoins: readonly Stablecoin[],
): ContractConfig | undefined {
  if (!data.contractPathEnabled) {
    return undefined;
  }

  const issues: string[] = [];

  if (quote === undefined) {
    issues.push(
      "CONTRACT_PATH_ENABLED requires QUOTE_ENABLED: the path locks through the quote engine",
    );
  }

  const routers = Object.entries(data.paymentRouters);
  if (routers.length === 0) {
    issues.push("PAYMENT_ROUTERS must configure at least one deployed PaymentRouter address");
  }
  for (const [chain, address] of routers) {
    if (!(CHAIN_IDS as readonly string[]).includes(chain)) {
      issues.push(`PAYMENT_ROUTERS names an unsupported chain "${chain}"`);
    }
    if (address === undefined || !ADDRESS_PATTERN.test(address)) {
      issues.push(`PAYMENT_ROUTERS has a malformed address for "${chain}"`);
    }
  }

  const routeCapable = (quote?.venues ?? []).filter(
    (venue) => venue === "0x" || venue === "uniswap",
  );
  if (quote !== undefined && routeCapable.length === 0) {
    issues.push(
      "the contract path needs a route-capable venue (0x or uniswap); LiFi is price-only",
    );
  }
  if (routeCapable.includes("uniswap") && Object.keys(data.uniswapSwapRouters).length === 0) {
    issues.push("UNISWAP_SWAP_ROUTERS is required when the uniswap venue serves routes");
  }

  // A settlement asset with no token address on a router chain cannot be named
  // in a signed order: `stablecoins.address(asset, chain)` returns nothing and
  // the lock throws. Without this the misconfiguration surfaces per payment, at
  // the moment a payer is waiting, instead of at boot.
  const routerChains = Object.keys(data.paymentRouters);
  const deployedOn = new Set(
    stablecoins
      .filter((coin) => coin.asset === data.settlementAsset)
      .flatMap((coin) => coin.onChain.map((entry) => entry.chain as string)),
  );
  if (routerChains.length > 0 && !routerChains.some((chain) => deployedOn.has(chain))) {
    issues.push(
      `SETTLEMENT_ASSET "${data.settlementAsset}" has no CHAIN_ASSETS address on any chain in ` +
        "PAYMENT_ROUTERS: the contract path could never sign an order for it",
    );
  }

  if (issues.length > 0) {
    throw new ConfigurationError(`Invalid contract-path configuration: ${issues.join("; ")}`, {
      issues,
    });
  }

  return { paymentRouters: data.paymentRouters };
}

/**
 * Resolves the stablecoin registry: the admitted settlement set, unioning
 * `SETTLEMENT_ASSETS` with the assets named in `CHAIN_ASSETS`, each carrying its
 * on-chain identities. Every check is a boot-time failure by design — a
 * deployment that admits a non-stablecoin or a default settlement asset it does
 * not support is a misconfiguration that must not survive to serve a payment.
 */
function resolveStablecoins(data: RawConfig): readonly Stablecoin[] {
  const issues: string[] = [];
  const admitted = new Set<AssetCode>();

  for (const raw of data.settlementAssets) {
    if (!isAssetCode(raw)) {
      issues.push(`SETTLEMENT_ASSETS names an unknown asset "${raw}"`);
      continue;
    }
    if (getAsset(raw).kind !== "stablecoin") {
      issues.push(`SETTLEMENT_ASSETS names a non-stablecoin asset "${raw}"`);
      continue;
    }
    admitted.add(raw);
  }

  const onChain = new Map<AssetCode, StablecoinOnChain[]>();
  for (const [chain, tokens] of Object.entries(data.chainAssets)) {
    for (const rawAsset of Object.keys(tokens ?? {})) {
      if (!isAssetCode(rawAsset)) {
        issues.push(`CHAIN_ASSETS names an unknown asset "${rawAsset}"`);
        continue;
      }
      if (getAsset(rawAsset).kind !== "stablecoin") {
        issues.push(`CHAIN_ASSETS names a non-stablecoin asset "${rawAsset}"`);
        continue;
      }
      admitted.add(rawAsset);
      const address = (tokens?.[rawAsset] ?? "").toLowerCase() as `0x${string}`;
      const entries = onChain.get(rawAsset) ?? [];
      entries.push({ chain: chain as ChainId, address });
      onChain.set(rawAsset, entries);
    }
  }

  if (admitted.size === 0) {
    issues.push("no stablecoins configured: set SETTLEMENT_ASSETS or CHAIN_ASSETS");
  }
  if (!admitted.has(data.settlementAsset)) {
    issues.push(`SETTLEMENT_ASSET "${data.settlementAsset}" is not in the admitted stablecoin set`);
  }

  if (issues.length > 0) {
    throw new ConfigurationError(`Invalid stablecoin configuration: ${issues.join("; ")}`, {
      issues,
    });
  }

  return [...admitted].sort().map((asset) => ({ asset, onChain: onChain.get(asset) ?? [] }));
}

/**
 * Resolves the chain block, or `undefined` when the layer is off.
 *
 * Every check here is a boot-time failure by design: a deployment that watches
 * nothing, or auto-confirms payments while a watcher is running, is a
 * misconfiguration that must not survive to serve a single payment.
 */
function resolveChain(data: RawConfig): ChainConfig | undefined {
  if (!data.chainEnabled) return undefined;

  const issues: string[] = [];

  if (data.assetReceiptMode === "auto") {
    issues.push(
      "ASSET_RECEIPT_MODE must be `manual` when CHAIN_ENABLED is true: auto-confirming " +
        "alongside a live watcher would fund payments nobody paid",
    );
  }
  if (data.depositXpub === undefined) {
    issues.push("DEPOSIT_XPUB is required when CHAIN_ENABLED is true");
  }

  const confirmations: Partial<Record<ChainId, number>> = {};
  let tokenCount = 0;

  for (const [chain, tokens] of Object.entries(data.chainAssets)) {
    if (!(CHAIN_IDS as readonly string[]).includes(chain)) {
      issues.push(`CHAIN_ASSETS names an unsupported chain "${chain}"`);
      continue;
    }
    const chainId = chain as ChainId;
    if (data.chainRpcUrls[chainId] === undefined) {
      issues.push(`CHAIN_ASSETS configures ${chainId} but CHAIN_RPC_URLS has no RPC URL for it`);
    }
    confirmations[chainId] = data.chainConfirmations[chainId] ?? 6;
    tokenCount += Object.keys(tokens ?? {}).length;
  }

  if (tokenCount === 0) {
    issues.push("CHAIN_ASSETS must configure at least one token when CHAIN_ENABLED is true");
  }

  if (issues.length > 0) {
    throw new ConfigurationError(`Invalid chain configuration: ${issues.join("; ")}`, {
      issues,
    });
  }

  return {
    rpcUrls: data.chainRpcUrls,
    confirmations: confirmations as Record<ChainId, number>,
    startBlocks: Object.fromEntries(
      Object.entries(data.chainStartBlocks).map(([chain, block]) => [chain, BigInt(block ?? "0")]),
    ),
    xpub: data.depositXpub ?? "",
    intervalMs: data.watcherIntervalMs,
    blockRange: data.watcherBlockRange,
    retentionSeconds: data.watcherRetentionSeconds,
    reorgWatchWindow: data.watcherReorgWatchWindow,
  };
}

/**
 * An env var present but empty is unset.
 *
 * A dotenv file documents its keys by listing them — `TURNKEY_SIGN_WITH=` says
 * "this is the name, fill it in". Zod sees `""`, which is present, so
 * `.optional()` never applies and `.min(1)` fails. The result is a boot that
 * dies on a variable the deployment does not use and never intended to set:
 * `.env.example` itself could not boot, and neither could any file copied from
 * it until every unused key was deleted rather than left blank.
 *
 * Collapsing `""` to `undefined` here makes the schema mean what it reads as.
 * A genuinely required key still fails — as "required" rather than as a length
 * complaint, which is the more useful message anyway.
 */
function withoutEmpty(env: Record<string, string | undefined>): Record<string, string | undefined> {
  return Object.fromEntries(
    Object.entries(env).map(([key, value]) => [key, value === "" ? undefined : value]),
  );
}

/**
 * Treasury execution's own requirements.
 *
 * Checked outside `resolveContract` because that function returns early when
 * the contract path is off — which is exactly the misconfiguration worth
 * catching: an executor with no router to call would fail per payment, with
 * the payer's asset already sitting at a deposit address.
 */
function assertTreasuryExecution(data: RawConfig, quote: QuoteConfig | undefined): void {
  if (!data.treasuryExecutionEnabled) return;

  const issues: string[] = [];

  if (!data.contractPathEnabled) {
    issues.push(
      "TREASURY_EXECUTION_ENABLED needs CONTRACT_PATH_ENABLED: the executor settles by calling PaymentRouter",
    );
  }
  if (quote === undefined) {
    issues.push(
      "TREASURY_EXECUTION_ENABLED needs the quote layer: the deposit path is priced and signed by the same planner the contract path uses",
    );
  }
  if (data.treasuryAddress === undefined) {
    issues.push("TREASURY_ADDRESS is required when TREASURY_EXECUTION_ENABLED is true");
  }
  if (data.operatorPrivateKey === undefined) {
    issues.push("OPERATOR_PRIVATE_KEY is required when TREASURY_EXECUTION_ENABLED is true");
  }
  if (data.depositForwarderInitCodeHash === undefined) {
    issues.push(
      "DEPOSIT_FORWARDER_INIT_CODE_HASH is required when TREASURY_EXECUTION_ENABLED is true",
    );
  }
  for (const chain of Object.keys(data.paymentRouters)) {
    if (data.depositForwarders[chain as ChainId] === undefined) {
      issues.push(`DEPOSIT_FORWARDERS has no factory for ${chain}, which has a PaymentRouter`);
    }
  }
  if (Object.keys(data.depositForwarders).length === 0) {
    // A deposit address must be a forwarder the operator can deploy and sweep.
    // An HD-derived EOA cannot pay its own gas, which is the entire reason the
    // forwarder exists, so an xpub-derived address would take deposits nothing
    // can move.
    issues.push(
      "TREASURY_EXECUTION_ENABLED derives deposit addresses from DEPOSIT_FORWARDERS, not DEPOSIT_XPUB",
    );
  }

  if (issues.length > 0) {
    throw new ConfigurationError(`Invalid treasury execution configuration: ${issues.join("; ")}`, {
      issues,
    });
  }
}

export function loadConfig(rawEnv: Record<string, string | undefined> = process.env): Config {
  const env = withoutEmpty(rawEnv);
  const result = configSchema.safeParse({
    port: env.PORT,
    databaseUrl: env.DATABASE_URL,
    settlementAsset: env.SETTLEMENT_ASSET,
    settlementAssets: env.SETTLEMENT_ASSETS,
    feeBasisPoints: env.FEE_BASIS_POINTS,
    defaultProvider: env.DEFAULT_SETTLEMENT_PROVIDER,
    paymentIntentTtlSeconds: env.PAYMENT_INTENT_TTL_SECONDS,
    assetReceiptMode: env.ASSET_RECEIPT_MODE,
    executionPath: env.EXECUTION_PATH,
    exchangeRates: env.EXCHANGE_RATES,
    chainEnabled: env.CHAIN_ENABLED,
    chainRpcUrls: env.CHAIN_RPC_URLS,
    chainAssets: env.CHAIN_ASSETS,
    chainConfirmations: env.CHAIN_CONFIRMATIONS,
    chainStartBlocks: env.CHAIN_START_BLOCKS,
    depositXpub: env.DEPOSIT_XPUB,
    watcherIntervalMs: env.WATCHER_INTERVAL_MS,
    watcherBlockRange: env.WATCHER_BLOCK_RANGE,
    watcherRetentionSeconds: env.WATCHER_RETENTION_SECONDS,
    watcherReorgWatchWindow: env.WATCHER_REORG_WATCH_WINDOW,
    adminToken: env.ADMIN_TOKEN,
    mockWebhookSecret: env.MOCK_WEBHOOK_SECRET,
    quoteEnabled: env.QUOTE_ENABLED,
    quoteVenues: env.QUOTE_VENUES,
    quoteOracle: env.QUOTE_ORACLE,
    quoteDeviationBps: env.QUOTE_DEVIATION_BPS,
    quoteMaxReferenceAgeSeconds: env.QUOTE_MAX_REFERENCE_AGE_SECONDS,
    quotePeggedPairs: env.QUOTE_PEGGED_PAIRS,
    quoteFxMaxAgeSeconds: env.QUOTE_FX_MAX_AGE_SECONDS,
    quoteSlippageBps: env.QUOTE_SLIPPAGE_BPS,
    quoteTtlSeconds: env.QUOTE_TTL_SECONDS,
    pythFeeds: env.PYTH_FEEDS,
    chainlinkFeeds: env.CHAINLINK_FEEDS,
    zeroExApiKey: env.ZERO_EX_API_KEY,
    zeroExChainId: env.ZERO_EX_CHAIN_ID,
    zeroExPairs: env.ZERO_EX_PAIRS,
    uniswapQuoters: env.UNISWAP_QUOTERS,
    uniswapPools: env.UNISWAP_POOLS,
    lifiPairs: env.LIFI_PAIRS,
    lifiFromAddress: env.LIFI_FROM_ADDRESS,
    lifiApiKey: env.LIFI_API_KEY,
    quoteSigner: env.QUOTE_SIGNER,
    turnkeyOrganizationId: env.TURNKEY_ORGANIZATION_ID,
    turnkeySignWith: env.TURNKEY_SIGN_WITH,
    turnkeySignerAddress: env.TURNKEY_SIGNER_ADDRESS,
    turnkeyApiPublicKey: env.TURNKEY_API_PUBLIC_KEY,
    turnkeyApiPrivateKey: env.TURNKEY_API_PRIVATE_KEY,
    quoteSignerPrivateKey: env.QUOTE_SIGNER_PRIVATE_KEY,
    contractPathEnabled: env.CONTRACT_PATH_ENABLED,
    paymentRouters: env.PAYMENT_ROUTERS,
    treasuryExecutionEnabled: env.TREASURY_EXECUTION_ENABLED,
    depositForwarders: env.DEPOSIT_FORWARDERS,
    depositForwarderInitCodeHash: env.DEPOSIT_FORWARDER_INIT_CODE_HASH,
    treasuryAddress: env.TREASURY_ADDRESS,
    operatorPrivateKey: env.OPERATOR_PRIVATE_KEY,
    treasuryMaxAttempts: env.TREASURY_MAX_ATTEMPTS,
    uniswapSwapRouters: env.UNISWAP_SWAP_ROUTERS,
    nodeEnv: env.NODE_ENV,
  });

  if (!result.success) {
    throw new ConfigurationError("Invalid environment configuration", {
      issues: result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`),
    });
  }

  const stablecoins = resolveStablecoins(result.data);
  const chain = resolveChain(result.data);
  const quote = resolveQuote(result.data);
  const contract = resolveContract(result.data, quote, stablecoins);
  assertTreasuryExecution(result.data, quote);

  if (result.data.executionPath === "on-chain-contract" && contract === undefined) {
    throw new ConfigurationError(
      "EXECUTION_PATH defaults to on-chain-contract but CONTRACT_PATH_ENABLED is false: " +
        "every payment would fail at the lock step",
      {},
    );
  }

  return {
    ...result.data,
    stablecoins,
    ...(chain === undefined ? {} : { chain }),
    ...(quote === undefined ? {} : { quote }),
    ...(contract === undefined ? {} : { contract }),
  };
}
