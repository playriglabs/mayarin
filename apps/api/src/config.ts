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
   * Phase 1 stand-in for the wallet watcher Phase 2 introduces. `manual` leaves
   * the payment waiting until something records the receipt.
   */
  assetReceiptMode: z.enum(["auto", "manual"]).default("auto"),
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

export type Config = RawConfig & {
  readonly chain?: ChainConfig;
  readonly stablecoins: readonly Stablecoin[];
};

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

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const result = configSchema.safeParse({
    port: env.PORT,
    databaseUrl: env.DATABASE_URL,
    settlementAsset: env.SETTLEMENT_ASSET,
    settlementAssets: env.SETTLEMENT_ASSETS,
    feeBasisPoints: env.FEE_BASIS_POINTS,
    defaultProvider: env.DEFAULT_SETTLEMENT_PROVIDER,
    paymentIntentTtlSeconds: env.PAYMENT_INTENT_TTL_SECONDS,
    assetReceiptMode: env.ASSET_RECEIPT_MODE,
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
  });

  if (!result.success) {
    throw new ConfigurationError("Invalid environment configuration", {
      issues: result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`),
    });
  }

  const stablecoins = resolveStablecoins(result.data);
  const chain = resolveChain(result.data);
  return { ...result.data, stablecoins, ...(chain === undefined ? {} : { chain }) };
}
