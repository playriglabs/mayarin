/**
 * Runtime configuration.
 *
 * Validated once at startup: a deployment with a bad settlement asset or fee
 * should fail to boot, not fail on the first payment.
 */

import { fileURLToPath } from "node:url";
import {
  CHAIN_IDS,
  type ChainId,
  isChainId,
  isEvmChainId,
  isMainnetChain,
  isReviewedToken,
  isSolanaChainId,
} from "@mayarin/chain";
import { parseHostList } from "@mayarin/http";
import type { FxFeed } from "@mayarin/provider-fx";
import type { PythFeed } from "@mayarin/provider-pyth";
import {
  type AssetCode,
  assetCodeSchema,
  ConfigurationError,
  fromDecimalString,
  getAsset,
  isAssetCode,
  isTokenizedCrypto,
} from "@mayarin/shared";
import type { Stablecoin, StablecoinOnChain } from "@mayarin/stablecoin";
import { z } from "zod";

type RpcUrlMap = Partial<Record<ChainId, string>>;
type TokenMap = Partial<Record<ChainId, Partial<Record<AssetCode, string>>>>;
type ConfirmationMap = Partial<Record<ChainId, number>>;
type StartBlockMap = Partial<Record<ChainId, string>>;
type LogRangeMap = Partial<Record<ChainId, number>>;

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
  settlementAsset: assetCodeSchema.default("USDC"),
  /** Admissible settlement set, JSON array of AssetCode. Defaults to USDC only. */
  settlementAssets: jsonObject<string[]>("SETTLEMENT_ASSETS", '["USDC"]'),
  feeBasisPoints: z.coerce.number().int().min(0).max(10_000).default(50),
  /**
   * Floor under the Mayarin fee, in whole units of the settlement asset
   * (`"0.10"`). The rate is a percentage and gas is not, so without a floor a
   * small payment costs more to execute than it earns. `"0"` is no floor.
   */
  feeMinimum: z
    .string()
    .regex(/^\d+(\.\d{1,2})?$/, "must be a decimal amount with at most two decimals")
    .default("0"),
  /** Successful relayed PaymentRouter calls reimburse gas from settlement. */
  relayerGasFeeBasisPoints: z.coerce.number().int().min(0).max(10_000).default(10),
  /**
   * The least a relayed submission reimburses, per chain, in whole units of the
   * settlement asset: `{"ethereum":"1.50","base":"0.02"}`. The percentage above
   * loses money on a small payment and wherever gas runs dear; this is the floor
   * under it, and a chain not listed has none.
   */
  relayerGasFeeMinimums: jsonObject<Record<string, string>>("RELAYER_GAS_FEE_MINIMUMS", "{}"),
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
    .default('{"USD/USDC":"1000000"}')
    .transform((value, ctx) => {
      try {
        const parsed = z.record(z.string(), z.string()).parse(JSON.parse(value));
        return Object.fromEntries(
          Object.entries(parsed).map(([pair, rate]) => [pair, BigInt(rate)]),
        );
      } catch {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'EXCHANGE_RATES must be JSON like {"USD/USDC":"1000000"}',
        });
        return z.NEVER;
      }
    }),
  chainEnabled: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  chainRpcUrls: jsonObject<RpcUrlMap>("CHAIN_RPC_URLS", "{}"),
  /**
   * Mayarin Resolution (#304): the neutral arbiter an escrowed payment names
   * when its merchant names none. It can only choose between the payer and
   * the payee of a disputed escrow — never send funds anywhere else — so it is
   * a decision key, not a custody key. Unset: disputes have no arbiter and
   * refund the payer at `resolveBy`.
   */
  escrowArbiter: z
    .string()
    .regex(/^0x[0-9a-fA-F]{40}$/, "ESCROW_ARBITER must be an EVM address")
    .optional(),
  /**
   * Where a dispute nearing `resolveBy` is announced (#313) — any endpoint
   * taking `{ "text": "…" }`, a Slack or Discord incoming webhook for one.
   * Unset: the warning is only logged by the chain worker.
   */
  escrowAlertWebhookUrl: z.string().url("ESCROW_ALERT_WEBHOOK_URL must be a URL").optional(),
  /**
   * Email for a newly opened dispute (#313), sent to the merchant's admin
   * accounts through Resend — the same key and sender the dashboard uses.
   * Unset key: no email; the webhook `escrow.disputed` still goes out.
   */
  resendApiKey: z.string().min(1).optional(),
  emailFrom: z.string().min(1).default("Mayarin <onboarding@resend.dev>"),
  /** The dashboard's origin, for the link in that email. Unset: the email names the page. */
  dashboardUrl: z.string().url("DASHBOARD_URL must be a URL").optional(),
  /**
   * The most one payment may settle for, per settlement asset, in whole units:
   * `{"USDC":"500"}`. A payment that prices above it fails at the lock. Required
   * as soon as a mainnet chain is configured, so the first live payment cannot
   * be unbounded by omission.
   */
  maxPaymentSettlement: jsonObject<Record<string, string>>("MAX_PAYMENT_SETTLEMENT", "{}"),
  /**
   * The most one merchant may be priced for in a rolling 24 hours, per settlement
   * asset, whole units: `{"USDC":"2000"}`. Counts payments still waiting to be
   * paid. Optional; not atomic across payments locking in the same instant.
   */
  maxMerchantDailySettlement: jsonObject<Record<string, string>>(
    "MAX_MERCHANT_DAILY_SETTLEMENT",
    "{}",
  ),
  /**
   * Encrypts webhook signing secrets at rest (SEC-12). Must be the same value on
   * the payment API and the dashboard API, which both read endpoints. Unset: the
   * secrets are stored as given (development). Required once a mainnet chain is
   * configured.
   */
  webhookSecretEncryptionKey: z.string().min(32).optional(),
  /** Keys that rows may still be sealed under while a rotation rewrites them; comma separated. */
  webhookSecretPreviousKeys: z
    .string()
    .default("")
    .transform((value) => value.split(",").filter((key) => key !== "")),
  /**
   * Signs the payer's token for one payment (SEC-09). Unset: a random key per
   * process, so every restart invalidates the links already handed out. Required
   * once a mainnet chain is configured. Rotating it revokes every token.
   */
  payerTokenKey: z.string().min(32).optional(),
  /** How long a payer's token stays valid; long enough to fetch a receipt later. */
  payerTokenTtlSeconds: z.coerce
    .number()
    .int()
    .positive()
    .default(30 * 24 * 3600),
  /**
   * Shared with the dashboard API, which reads payments on a merchant's behalf
   * without holding the payer's token. Unset: nobody gets that bypass.
   */
  internalApiToken: z.string().min(32).optional(),
  chainAssets: jsonObject<TokenMap>("CHAIN_ASSETS", "{}"),
  /**
   * The chain's own currency, which has no contract address and emits no
   * `Transfer` log. Naming it here is what lets the watcher read native
   * deposits out of block bodies; without it, an ETH rail locks a price, issues
   * a deposit address, and then never notices the payment.
   */
  chainNativeAssets: jsonObject<Partial<Record<ChainId, AssetCode>>>("CHAIN_NATIVE_ASSETS", "{}"),
  chainConfirmations: jsonObject<ConfirmationMap>("CHAIN_CONFIRMATIONS", "{}"),
  chainStartBlocks: jsonObject<StartBlockMap>("CHAIN_START_BLOCKS", "{}"),
  depositXpub: z.string().min(1).optional(),
  /** Base64 32-byte root used only for deterministic Solana deposit owners. */
  solanaDepositSeed: z.string().min(1).optional(),
  watcherIntervalMs: z.coerce.number().int().min(0).default(15_000),
  /** Delay between settlement-indexer passes. */
  indexerIntervalMs: z.coerce.number().int().min(0).default(60_000),
  /** Ceiling for the indexer's backoff after a failing pass. */
  indexerMaxBackoffMs: z.coerce.number().int().min(0).default(300_000),
  /** Delay between passes while a watcher is catching up to the chain head. */
  watcherCatchUpIntervalMs: z.coerce.number().int().min(0).default(1_000),
  watcherBlockRange: z.coerce.number().int().positive().default(2_000),
  /**
   * Blocks per pass for the chain's own currency, which is scanned by reading
   * every block body rather than by one `eth_getLogs`.
   *
   * Smaller than `WATCHER_BLOCK_RANGE` on purpose: one number for both means
   * either the token scan crawls or the native scan spends a call per block
   * until the provider answers 429.
   */
  watcherNativeBlockRange: z.coerce.number().int().positive().default(100),
  watcherTokenBalanceCatchUp: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  /**
   * Blocks per `eth_getLogs` call, which is a provider limit rather than a
   * policy one — Alchemy's free tier refuses a wider range. The watcher's own
   * range is split into calls this size, so how far a tick advances is a
   * decision about RPC budget instead of a number one endpoint dictates.
   */
  chainLogRange: z.coerce.number().int().positive().default(10),
  /** `CHAIN_LOG_RANGE` overridden per chain, for an endpoint that allows more. */
  chainLogRanges: jsonObject<LogRangeMap>("CHAIN_LOG_RANGES", "{}"),
  /** How far behind the head a pair with no cursor may start scanning. */
  watcherMaxStartBacklogBlocks: z.coerce.number().int().positive().default(50_000),
  watcherRetentionSeconds: z.coerce.number().int().positive().default(86_400),
  watcherReorgWatchWindow: z.coerce.number().int().positive().default(2),
  adminToken: z.string().min(16).optional(),
  /** Per-client request budget for the versioned HTTP API. */
  rateLimitRequests: z.coerce.number().int().positive().default(120),
  /** Per-API-key request budget, whatever address the calls come from (SEC-08). */
  apiKeyRateLimitRequests: z.coerce.number().int().positive().default(600),
  /** Seconds required to refill a fully exhausted request budget. */
  rateLimitWindowSeconds: z.coerce.number().int().positive().default(60),
  /** Fixed lockout after a client exhausts a request budget. */
  rateLimitBlockSeconds: z.coerce.number().int().positive().default(300),
  /** Maximum client buckets retained by one process. */
  rateLimitMaxClients: z.coerce.number().int().positive().default(10_000),
  /** Trusted source of the caller IP for rate-limit buckets. */
  /**
   * Hostnames this service answers to, comma-separated (SEC-13). Any other
   * `Host` — the generated Railway domain, for one — gets a 404 before routing.
   * Blank turns the check off.
   */
  allowedHosts: z.string().default("").transform(parseHostList),
  /**
   * A secret only the edge adds as `x-origin-secret`; a request without it is a
   * 404, so the generated Railway domain is no way around Cloudflare (SEC-13).
   * Unset turns the check off. Set it at the edge first.
   */
  originAuthSecret: z.string().min(32).optional(),
  /**
   * Hostnames the admin routes answer on (SEC-14), e.g. the service's private
   * Railway name. On any other `Host`, including the public one, `/v1/admin`
   * is a 404, so an admin token alone does not make the endpoint reachable from
   * the internet. A request must pass this and `ALLOWED_HOSTS`, so list these
   * there too. Blank: admin answers on every allowed host.
   */
  adminAllowedHosts: z.string().default("").transform(parseHostList),
  rateLimitClientIpSource: z
    .enum(["cf-connecting-ip", "socket", "x-forwarded-for", "x-real-ip"])
    .default("socket"),
  /**
   * Live payment status on the hosted checkout, over Server-Sent Events.
   *
   * On by default: it needs no infrastructure beyond the Postgres already
   * configured, and the page degrades to polling if a stream cannot be opened.
   */
  realtimeEnabled: z
    .enum(["true", "false"])
    .default("true")
    .transform((value) => value === "true"),
  /** Ceiling on concurrently watched payments in one process. */
  realtimeMaxWatched: z.coerce.number().int().positive().default(1_000),
  /**
   * Origin the hosted checkout is reachable at, e.g. `https://pay.mayarin.xyz`.
   *
   * A payment link's whole value is that it can be sent to someone, so the
   * absolute URL has to be built somewhere. Deployment identity, not merchant
   * configuration — this stays boot-validated when merchant settings move to a
   * runtime API (#95).
   */
  publicBaseUrl: z
    .string()
    .url()
    .default("http://localhost:3000")
    .transform((value) => value.replace(/\/+$/, "")),
  /**
   * Where buyer-facing checkout/invoice URLs point — the host a payer opens.
   *
   * The payment-link `url` and invoice `url` returned by this API are absolute,
   * and a link's whole value is that it can be sent to a buyer. When the
   * checkout is fronted by a dedicated buyer host (`pay-testnet.mayarin.xyz`,
   * RFC #163) that is not the API origin, set this so links point at the buyer
   * host regardless of which client minted them. Defaults to `PUBLIC_BASE_URL`
   * for a deployment where the two share an origin.
   */
  checkoutBaseUrl: z
    .string()
    .url()
    .default("http://localhost:3000")
    .transform((value) => value.replace(/\/+$/, "")),
  /**
   * Where the built checkout UI (#151) sits on disk. The default is the
   * workspace path `apps/checkout-ui/dist`, which is where `bun run --cwd
   * apps/checkout-ui build` writes and where the Docker image carries it. Tests
   * point this at a fixture so `bun test` never needs a Vite build.
   */
  checkoutUiDist: z
    .string()
    .min(1)
    .default(fileURLToPath(new URL("../../checkout-ui/dist", import.meta.url))),
  mockWebhookSecret: z.string().min(1).optional(),

  // --- Outbound webhooks (RFC #13) ---------------------------------------
  /** Off by default, like the chain layer. */
  webhooksEnabled: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  /** `0` disables the timer and leaves only the admin trigger, like the watcher. */
  webhookIntervalMs: z.coerce.number().int().min(0).default(5_000),

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
  quoteOracle: z.enum(["pyth", "chainlink", "fx", "coinbase"]).default("pyth"),
  /** Ordered secondary references used when the primary is unavailable or stale. */
  quoteOracleFallbacks: jsonObject<string[]>("QUOTE_ORACLE_FALLBACKS", "[]"),
  /** How far the venue price may sit from the oracle before the quote fails. */
  quoteDeviationBps: z.coerce.number().int().min(1).max(10_000).default(100),
  /**
   * A wider deviation limit for one venue, by name: `{"lifi":400}`. An aggregator's price
   * carries its fee and the spread of its route, so the limit that suits a single pool
   * would refuse every quote it gives. Every venue not named keeps `QUOTE_DEVIATION_BPS`.
   */
  quoteDeviationBpsByVenue: jsonObject<Record<string, number>>(
    "QUOTE_DEVIATION_BPS_BY_VENUE",
    "{}",
  ),
  /** Chain-scoped testnet pairs allowed to self-reference when public test data is unusable. */
  quoteUnguardedTestnetPairs: jsonObject<string[]>("QUOTE_UNGUARDED_TESTNET_PAIRS", "[]"),
  /**
   * How far two oracles may disagree before neither is trusted.
   *
   * Deliberately NOT `QUOTE_DEVIATION_BPS`. That one bounds a venue against a
   * reference, and a testnet deployment has to open it wide because a toy
   * Uniswap pool is its own truth — Base Sepolia sits ~9100 bps off the market.
   * Two independent oracles reading the same pair have no such excuse: they are
   * both claiming to report the market, so a real gap between them means one is
   * wrong and the quote should fail. Sharing one knob meant widening it for the
   * pool silently switched the oracle cross-check off.
   */
  quoteOracleAgreementBps: z.coerce.number().int().min(1).max(10_000).default(100),
  /** How stale a reference may be and still vouch for a price. */
  quoteMaxReferenceAgeSeconds: z.coerce.number().int().positive().default(60),
  /**
   * Fiat/stablecoin pairs that are the same currency in two representations,
   * e.g. `["USD/USDC"]`. Declared, never inferred: whether an issuer holds its
   * peg is a judgement about that issuer, not something an asset code implies.
   */
  quotePeggedPairs: jsonObject<string[]>("QUOTE_PEGGED_PAIRS", "[]"),
  /**
   * Staleness bound for the FX leg. Separate from the swap leg's bound because
   * an FX feed and a DEX quote go stale at very different rates.
   */
  quoteFxMaxAgeSeconds: z.coerce.number().int().positive().default(300),
  /**
   * The same bound while the FX market is closed. Defaults to the trading-hours
   * bound, so a deployment that says nothing refuses weekend fiat payments
   * exactly as it does today rather than silently gaining a tolerance.
   */
  quoteFxClosedMaxAgeSeconds: z.coerce.number().int().positive().optional(),
  /** Widening applied to a closed-market FX rate. `0` disables it. */
  quoteFxClosedSpreadBps: z.coerce.number().int().min(0).max(9_999).default(0),
  /** Slippage bound on the payer estimate. Never moves the merchant's `minOut`. */
  quoteSlippageBps: z.coerce.number().int().min(0).max(9_999).default(50),
  /** Lock TTL, which becomes the order `deadline`. */
  quoteTtlSeconds: z.coerce.number().int().positive().default(60),
  /** Pyth pair to Hermes feed id. */
  /**
   * Pair to Hermes feed. A bare string is quoted in the pair's own direction;
   * `{ "id": "0x…", "invert": true }` names a feed quoted the other way round —
   * Pyth publishes `FX.USD/IDR` and no reverse, so `IDR/USDC` can only be
   * served by inverting it.
   */
  pythFeeds: jsonObject<Record<string, PythFeed>>("PYTH_FEEDS", "{}"),
  /** Pyth API key (required since the 2026-08-26 Pyth Core Hermes auth cutover). */
  pythApiKey: z.string().optional(),
  /** Override the Hermes endpoint; defaults to the upgraded `pyth.dourolabs.app/hermes`. */
  pythHermesEndpoint: z.string().url().optional(),
  /**
   * FX pair to API series. A bare string is a series quoted in the pair's own
   * direction; the object form names one quoted the other way round:
   *   FX_FEEDS={"IDR/USDC":{"symbol":"USD/IDR","invert":true}}
   */
  fxFeeds: jsonObject<Record<string, FxFeed>>("FX_FEEDS", "{}"),
  /** Override the FX endpoint; defaults to `api.coinbase.com`. */
  fxEndpoint: z.string().url().optional(),
  /**
   * How long one FX read is reused. Every base currency is one request per
   * refresh. Kept under `QUOTE_FX_MAX_AGE_SECONDS` so a reused rate is still
   * fresh enough to lock against.
   */
  fxCacheSeconds: z.coerce.number().int().positive().default(180),
  /**
   * Crypto pair to Coinbase Exchange product, e.g.
   *   COINBASE_PRODUCTS={"ETH/USDC":"ETH-USD","SOL/USDC":"SOL-USD"}
   */
  coinbaseProducts: jsonObject<Record<string, string>>("COINBASE_PRODUCTS", "{}"),
  /** Override the Coinbase endpoint; defaults to `api.exchange.coinbase.com`. */
  coinbaseEndpoint: z.string().url().optional(),
  /** Chainlink pair to `{ chain, address, heartbeatSeconds? }`. */
  chainlinkFeeds: jsonObject<
    Record<string, { chain: ChainId; address: string; heartbeatSeconds?: number }>
  >("CHAINLINK_FEEDS", "{}"),
  zeroExApiKey: z.string().min(1).optional(),
  zeroExChainId: z.coerce.number().int().positive().optional(),
  zeroExPairs: jsonObject<Record<string, unknown>>("ZERO_EX_PAIRS", "{}"),
  /** TransFi fiat on-ramp: `https://sandbox-api.transfi.com` or `https://api.transfi.com`. */
  transfiBaseUrl: z.string().url().optional(),
  /** Merchant id, sent as the `mid` header on every request. */
  transfiMid: z.string().min(1).optional(),
  /** Basic-auth username; the password is the merchant key from Settings → Integration. */
  transfiUsername: z.string().min(1).optional(),
  transfiPassword: z.string().min(1).optional(),
  /** Verifies `X-Transfi-Hmac-Hash` on webhooks. */
  transfiWebhookSecret: z.string().min(1).optional(),
  /**
   * Demo and test deployments only: complete a local-currency payment without a
   * real transfer, by marking the TransFi sandbox order paid and recording the
   * receipt when TransFi reports it delivered. Boot refuses it against anything
   * but the sandbox, for the reason `ASSET_RECEIPT_MODE=auto` refuses the chain
   * layer: it is a statement that value arrived, made without evidence of it.
   */
  transfiSandboxAutoSettle: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  uniswapQuoters: jsonObject<Partial<Record<ChainId, string>>>("UNISWAP_QUOTERS", "{}"),
  uniswapPools: jsonObject<Record<string, unknown>>("UNISWAP_POOLS", "{}"),
  /** `UniswapV2Router02` address per chain, for the V2 venue and route source. */
  uniswapV2Routers: jsonObject<Partial<Record<ChainId, string>>>("UNISWAP_V2_ROUTERS", "{}"),
  /** Pair (`rateKey(from, to)`) to `{ chain, tokenIn, tokenOut }` — V2 has no fee. */
  uniswapV2Pairs: jsonObject<Record<string, unknown>>("UNISWAP_V2_PAIRS", "{}"),
  lifiPairs: jsonObject<Record<string, unknown>>("LIFI_PAIRS", "{}"),
  lifiFromAddress: z.string().min(1).optional(),
  lifiApiKey: z.string().min(1).optional(),

  // --- Quote signing (RFC #6 — #41) --------------------------------------
  /**
   * `aws-kms` keeps the production key non-exportable. `local` holds it in this
   * process and is accepted only for development/testnet routers.
   */
  quoteSigner: z.enum(["turnkey", "local", "aws-kms"]).default("turnkey"),
  turnkeyOrganizationId: z.string().min(1).optional(),
  turnkeySignWith: z.string().min(1).optional(),
  turnkeySignerAddress: z.string().min(1).optional(),
  turnkeyApiPublicKey: z.string().min(1).optional(),
  turnkeyApiPrivateKey: z.string().min(1).optional(),
  /** Local/testnet only. Refused whenever a mainnet PaymentRouter is configured. */
  quoteSignerPrivateKey: z.string().min(1).optional(),
  awsKmsKeyId: z.string().min(1).optional(),
  awsKmsRegion: z.string().min(1).optional(),
  awsKmsSignerAddress: z.string().min(1).optional(),

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
  /** Base64 32- or 64-byte Ed25519 secret; local/test deployments only. */
  solanaOrderSignerSecretKey: z.string().min(1).optional(),
  /** Per-cluster 32-byte hex domain separating deployments that share a program id. */
  solanaDeploymentDomains: jsonObject<Partial<Record<ChainId, string>>>(
    "SOLANA_DEPLOYMENT_DOMAINS",
    "{}",
  ),
  /** SPL-token owner that receives protocol fees on each Solana cluster. */
  solanaFeeRecipients: jsonObject<Partial<Record<ChainId, string>>>("SOLANA_FEE_RECIPIENTS", "{}"),
  /** Orca Whirlpool routes used for cross-asset Solana settlement, grouped by cluster. */
  solanaOrcaPools: jsonObject<
    Partial<
      Record<
        ChainId,
        readonly {
          readonly address: string;
          readonly tokenMintA: string;
          readonly tokenMintB: string;
        }[]
      >
    >
  >("SOLANA_ORCA_POOLS", "{}"),
  /** Persistent v0 lookup tables containing the configured Orca route accounts. */
  solanaOrcaLookupTables: jsonObject<Partial<Record<ChainId, readonly string[]>>>(
    "SOLANA_ORCA_LOOKUP_TABLES",
    "{}",
  ),
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
  /**
   * Where the operator key lives. `local` is `OPERATOR_PRIVATE_KEY` in this
   * process, refused when a mainnet chain is configured; `turnkey` keeps it in
   * Turnkey, whose policy bounds what it may sign (SEC-06); `aws-kms` keeps it in
   * an AWS KMS key that cannot be exported, bounded by IAM and CloudTrail rather
   * than by a policy on what is signed.
   */
  operatorSigner: z.enum(["local", "turnkey", "aws-kms"]).default("local"),
  /**
   * The KMS key the operator signs with, when `OPERATOR_SIGNER=aws-kms`. Its own key,
   * never the order signer's (`AWS_KMS_KEY_ID`): the two keys hold different powers and
   * must not share a compromise. The region is `AWS_KMS_REGION`, the address is
   * `OPERATOR_ADDRESS`.
   */
  operatorAwsKmsKeyId: z.string().min(1).optional(),
  /** The Turnkey key the operator signs with, and the address it signs as. */
  operatorTurnkeySignWith: z.string().min(1).optional(),
  operatorAddress: z.string().min(1).optional(),
  /**
   * The API key the operator authenticates to Turnkey with. Its own non-root
   * user's: Turnkey's policy engine does not apply to root users, so the
   * `TURNKEY_API_*` pair (the organization's) must not be reused here.
   */
  operatorTurnkeyApiPublicKey: z.string().min(1).optional(),
  operatorTurnkeyApiPrivateKey: z.string().min(1).optional(),
  /**
   * What the operator may hold, per chain and asset: `{"base":{"USDC":{"max":"500"},"ETH":{"min":"0.005"}}}`.
   * A ceiling bounds what a compromise takes; a floor on the native asset warns
   * before the operator cannot pay gas. The chain worker reports a breach every
   * five minutes; it moves nothing (SEC-06).
   */
  operatorFloatLimits: jsonObject<Record<string, Record<string, { min?: string; max?: string }>>>(
    "OPERATOR_FLOAT_LIMITS",
    "{}",
  ),
  /**
   * The x402 rail (#207): endpoints payable per call by an agent that never
   * registered.
   *
   * Off by default and separate from the contract path, because it needs a
   * different thing: a key that broadcasts *the payer's* signed authorization.
   * That key cannot change an amount or a recipient, so it buys gas rather than
   * discretion — but it is still a key, and a deployment gets one only by
   * asking.
   */
  x402Enabled: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  /**
   * How long a price offered in a `402` is honoured.
   *
   * This is the only knob: the `maxTimeoutSeconds` a payer sees is derived from
   * it and from the merchant's own ceiling, never configured beside it. A quote
   * TTL and a deadline that can drift apart is what produced settlement after
   * expiry, and then EXECUTION_EXHAUSTED, on the deposit path.
   */
  x402QuoteTtlSeconds: z.coerce.number().int().min(5).max(300).default(60),
  treasuryMaxAttempts: z.coerce.number().int().positive().default(3),
  /**
   * The Safe that receives settlements. One address for the whole deployment
   * — per-merchant wallets arrive with Phase 4 (#11).
   */
  /** `SwapRouter02` address per chain, for the Uniswap route source. */
  uniswapSwapRouters: jsonObject<Partial<Record<ChainId, string>>>("UNISWAP_SWAP_ROUTERS", "{}"),
  /**
   * Extra routers the cross-asset settler may call, per chain (SEC-17): the 0x
   * and LiFi route sources return their router per quote, so it has to be
   * reviewed and named here. The Uniswap routers above are allowed already.
   */
  swapRouterAllowlist: jsonObject<Partial<Record<ChainId, string[]>>>(
    "SWAP_ROUTER_ALLOWLIST",
    "{}",
  ),
  nodeEnv: z.string().default("development"),
});

export type RawConfig = z.infer<typeof configSchema>;

export interface ChainConfig {
  readonly rpcUrls: Readonly<Partial<Record<ChainId, string>>>;
  readonly confirmations: Readonly<Record<ChainId, number>>;
  readonly startBlocks: Readonly<Partial<Record<ChainId, bigint>>>;
  readonly xpub: string;
  readonly solanaDepositSeed?: Uint8Array;
  readonly intervalMs: number;
  readonly catchUpIntervalMs: number;
  /** Settlement-indexer pass interval. */
  readonly indexerIntervalMs: number;
  readonly indexerMaxBackoffMs: number;
  readonly blockRange: number;
  readonly nativeBlockRange: number;
  readonly tokenBalanceCatchUp: boolean;
  /** Blocks per `eth_getLogs` call. The provider's cap, not the watcher's. */
  readonly logRange: number;
  readonly logRanges: Readonly<LogRangeMap>;
  readonly maxStartBacklogBlocks: number;
  readonly retentionSeconds: number;
  readonly reorgWatchWindow: number;
}

/** Resolved quote-layer configuration. Present only when `QUOTE_ENABLED=true`. */
/** The oracle sources the composition root can build. */
export type OracleName = "pyth" | "chainlink" | "fx" | "coinbase";

export interface QuoteConfig {
  readonly venues: readonly string[];
  readonly oracle: OracleName;
  readonly fallbackOracles: readonly OracleName[];
  readonly deviationBps: number;
  readonly deviationBpsByVenue: Readonly<Record<string, number>>;
  readonly unguardedTestnetPairs: readonly string[];
  /** How far two oracles may disagree before neither is trusted. */
  readonly oracleAgreementBps: number;
  readonly maxReferenceAgeSeconds: number;
  readonly peggedPairs: readonly string[];
  readonly fxMaxAgeSeconds: number;
  readonly fxClosedMaxAgeSeconds: number;
  readonly fxClosedSpreadBps: number;
  readonly slippageBps: number;
  readonly ttlSeconds: number;
  readonly signer: "turnkey" | "local" | "aws-kms";
}

/** Resolved contract-path configuration. Present only when `CONTRACT_PATH_ENABLED=true`. */
export interface ContractConfig {
  readonly paymentRouters: Readonly<Partial<Record<ChainId, string>>>;
  readonly solana?: {
    readonly signerSecretKey: Uint8Array;
    readonly deploymentDomains: Readonly<Partial<Record<ChainId, Uint8Array>>>;
    readonly feeRecipients: Readonly<Partial<Record<ChainId, string>>>;
    readonly orcaPools: Readonly<
      Partial<
        Record<
          ChainId,
          readonly {
            readonly address: string;
            readonly tokenMintA: string;
            readonly tokenMintB: string;
          }[]
        >
      >
    >;
    readonly orcaLookupTables: Readonly<Partial<Record<ChainId, readonly string[]>>>;
  };
}

export type Config = RawConfig & {
  readonly chain?: ChainConfig;
  readonly quote?: QuoteConfig;
  readonly contract?: ContractConfig;
  readonly stablecoins: readonly Stablecoin[];
};

const SUPPORTED_VENUES = ["0x", "uniswap", "uniswap-v2", "lifi", "orca"] as const;

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
    if (venue === "uniswap-v2") {
      if (Object.keys(data.uniswapV2Pairs).length === 0)
        issues.push("UNISWAP_V2_PAIRS must configure at least one pair for the uniswap-v2 venue");
      if (Object.keys(data.uniswapV2Routers).length === 0)
        issues.push("UNISWAP_V2_ROUTERS is required for the uniswap-v2 venue");
    }
    if (venue === "lifi") {
      if (data.lifiFromAddress === undefined)
        issues.push("LIFI_FROM_ADDRESS is required for the lifi venue");
    }
    if (venue === "orca" && Object.values(data.solanaOrcaPools).every((pools) => !pools?.length)) {
      issues.push("SOLANA_ORCA_POOLS must configure at least one pool for the orca venue");
    }
  }

  if (
    data.quoteFxClosedMaxAgeSeconds !== undefined &&
    data.quoteFxClosedMaxAgeSeconds < data.quoteFxMaxAgeSeconds
  ) {
    // A tighter bound on a closed market than on an open one cannot be what a
    // deployment means: it would refuse on a Saturday what it accepts on a
    // Tuesday, which is the wrong way round for the only condition the closed
    // bound exists to describe.
    issues.push(
      "QUOTE_FX_CLOSED_MAX_AGE_SECONDS must be at least QUOTE_FX_MAX_AGE_SECONDS: " +
        "a closed market publishes less often, not more",
    );
  }

  const supportedOracles = ["pyth", "chainlink", "fx", "coinbase"] as const;
  const unsupportedOracles = data.quoteOracleFallbacks.filter(
    (oracle) => !(supportedOracles as readonly string[]).includes(oracle),
  );
  if (unsupportedOracles.length > 0) {
    issues.push(
      `QUOTE_ORACLE_FALLBACKS names unsupported sources: ${unsupportedOracles.join(", ")}`,
    );
  }
  const oracleNames = [data.quoteOracle, ...data.quoteOracleFallbacks];
  if (new Set(oracleNames).size !== oracleNames.length) {
    issues.push("QUOTE_ORACLE and QUOTE_ORACLE_FALLBACKS must not contain duplicates");
  }
  if (oracleNames.includes("pyth") && Object.keys(data.pythFeeds).length === 0) {
    issues.push("PYTH_FEEDS must configure at least one feed when a Pyth oracle is enabled");
  }
  if (oracleNames.includes("pyth") && data.pythApiKey === undefined) {
    issues.push(
      "PYTH_API_KEY is required since the 2026-08-26 Pyth Core upgrade made Hermes authentication mandatory",
    );
  }
  if (oracleNames.includes("fx") && Object.keys(data.fxFeeds).length === 0) {
    issues.push("FX_FEEDS must configure at least one series when the FX oracle is enabled");
  }
  if (oracleNames.includes("coinbase") && Object.keys(data.coinbaseProducts).length === 0) {
    issues.push(
      "COINBASE_PRODUCTS must configure at least one product when the Coinbase oracle is enabled",
    );
  }
  if (oracleNames.includes("chainlink") && Object.keys(data.chainlinkFeeds).length === 0) {
    issues.push(
      "CHAINLINK_FEEDS must configure at least one feed when a Chainlink oracle is enabled",
    );
  }

  if (data.quoteSigner === "turnkey") {
    if (data.turnkeyOrganizationId === undefined)
      issues.push("TURNKEY_ORGANIZATION_ID is required");
    if (data.turnkeySignWith === undefined) issues.push("TURNKEY_SIGN_WITH is required");
    if (data.turnkeySignerAddress === undefined) issues.push("TURNKEY_SIGNER_ADDRESS is required");
    if (data.turnkeyApiPublicKey === undefined) issues.push("TURNKEY_API_PUBLIC_KEY is required");
    if (data.turnkeyApiPrivateKey === undefined) issues.push("TURNKEY_API_PRIVATE_KEY is required");
  } else if (data.quoteSigner === "local") {
    // The promise `docs/quote-signing.md` makes: the composition root refuses an
    // in-process signing key outside development. Anything that can read the
    // process could otherwise authorize settlement amounts.
    const mainnetRouters = Object.keys(data.paymentRouters).filter(
      (chain) => isChainId(chain) && isMainnetChain(chain),
    );
    if (data.nodeEnv !== "development" && mainnetRouters.length > 0) {
      issues.push(
        `QUOTE_SIGNER=local holds the quote-signing key in this process and is refused for ` +
          `mainnet PaymentRouter chains: ${mainnetRouters.join(", ")}`,
      );
    }
    if (data.quoteSignerPrivateKey === undefined) {
      issues.push("QUOTE_SIGNER_PRIVATE_KEY is required when QUOTE_SIGNER is local");
    }
  } else {
    if (data.awsKmsKeyId === undefined) issues.push("AWS_KMS_KEY_ID is required");
    if (data.awsKmsRegion === undefined) issues.push("AWS_KMS_REGION is required");
    if (data.awsKmsSignerAddress === undefined) issues.push("AWS_KMS_SIGNER_ADDRESS is required");
  }

  if (issues.length > 0) {
    throw new ConfigurationError(`Invalid quote configuration: ${issues.join("; ")}`, { issues });
  }

  return {
    venues: data.quoteVenues,
    oracle: data.quoteOracle,
    fallbackOracles: data.quoteOracleFallbacks as readonly OracleName[],
    deviationBps: data.quoteDeviationBps,
    deviationBpsByVenue: data.quoteDeviationBpsByVenue,
    unguardedTestnetPairs: data.quoteUnguardedTestnetPairs,
    oracleAgreementBps: data.quoteOracleAgreementBps,
    maxReferenceAgeSeconds: data.quoteMaxReferenceAgeSeconds,
    peggedPairs: data.quotePeggedPairs,
    fxMaxAgeSeconds: data.quoteFxMaxAgeSeconds,
    fxClosedMaxAgeSeconds: data.quoteFxClosedMaxAgeSeconds ?? data.quoteFxMaxAgeSeconds,
    fxClosedSpreadBps: data.quoteFxClosedSpreadBps,
    slippageBps: data.quoteSlippageBps,
    ttlSeconds: data.quoteTtlSeconds,
    signer: data.quoteSigner,
  };
}

const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;
const SOLANA_ADDRESS_PATTERN = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

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
    const valid =
      address !== undefined &&
      (isSolanaChainId(chain)
        ? SOLANA_ADDRESS_PATTERN.test(address)
        : ADDRESS_PATTERN.test(address));
    if (!valid) {
      issues.push(`PAYMENT_ROUTERS has a malformed address for "${chain}"`);
    }
  }

  const solanaChains = routers
    .map(([chain]) => chain)
    .filter((chain): chain is ChainId => isChainId(chain) && isSolanaChainId(chain));
  let solanaSecret: Uint8Array | undefined;
  if (solanaChains.length > 0) {
    if (!data.chainEnabled) {
      issues.push("CHAIN_ENABLED must be true to index Solana PaymentRouter settlements");
    }
    if (data.solanaOrderSignerSecretKey === undefined) {
      issues.push("SOLANA_ORDER_SIGNER_SECRET_KEY is required for a Solana PaymentRouter");
    } else {
      solanaSecret = Uint8Array.from(Buffer.from(data.solanaOrderSignerSecretKey, "base64"));
      if (solanaSecret.length !== 32 && solanaSecret.length !== 64) {
        issues.push("SOLANA_ORDER_SIGNER_SECRET_KEY must decode to 32 or 64 bytes");
      }
    }
    for (const chain of solanaChains) {
      const domain = data.solanaDeploymentDomains[chain];
      const domainHex = domain?.replace(/^0x/, "");
      if (
        domainHex === undefined ||
        !/^[0-9a-fA-F]{64}$/.test(domainHex) ||
        /^0{64}$/.test(domainHex)
      ) {
        issues.push(`SOLANA_DEPLOYMENT_DOMAINS needs a 32-byte hex value for "${chain}"`);
      }
      const feeRecipient = data.solanaFeeRecipients[chain];
      if (
        feeRecipient === undefined ||
        !SOLANA_ADDRESS_PATTERN.test(feeRecipient) ||
        feeRecipient === "11111111111111111111111111111111"
      ) {
        issues.push(`SOLANA_FEE_RECIPIENTS needs a public key for "${chain}"`);
      }
      if (data.chainRpcUrls[chain] === undefined) {
        issues.push(`CHAIN_RPC_URLS needs an endpoint for "${chain}"`);
      }
      for (const pool of data.solanaOrcaPools[chain] ?? []) {
        if (
          !SOLANA_ADDRESS_PATTERN.test(pool.address) ||
          !SOLANA_ADDRESS_PATTERN.test(pool.tokenMintA) ||
          !SOLANA_ADDRESS_PATTERN.test(pool.tokenMintB) ||
          pool.tokenMintA === pool.tokenMintB
        ) {
          issues.push(`SOLANA_ORCA_POOLS has a malformed pool for "${chain}"`);
        }
      }
      for (const lookupTable of data.solanaOrcaLookupTables[chain] ?? []) {
        if (!SOLANA_ADDRESS_PATTERN.test(lookupTable)) {
          issues.push(`SOLANA_ORCA_LOOKUP_TABLES has a malformed address for "${chain}"`);
        }
      }
    }
  }

  const routeCapable = (quote?.venues ?? []).filter(
    (venue) => venue === "0x" || venue === "uniswap" || venue === "uniswap-v2" || venue === "lifi",
  );
  const hasEvmRouter = routers.some(([chain]) => isChainId(chain) && !isSolanaChainId(chain));
  if (quote !== undefined && hasEvmRouter && routeCapable.length === 0) {
    issues.push("the contract path needs a route-capable venue (0x, uniswap, uniswap-v2 or lifi)");
  }
  if (routeCapable.includes("uniswap") && Object.keys(data.uniswapSwapRouters).length === 0) {
    issues.push("UNISWAP_SWAP_ROUTERS is required when the uniswap venue serves routes");
  }
  if (routeCapable.includes("uniswap-v2") && Object.keys(data.uniswapV2Routers).length === 0) {
    issues.push("UNISWAP_V2_ROUTERS is required when the uniswap-v2 venue serves routes");
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

  const deploymentDomains = Object.fromEntries(
    solanaChains.flatMap((chain) => {
      const value = data.solanaDeploymentDomains[chain];
      return value === undefined
        ? []
        : [[chain, Uint8Array.from(Buffer.from(value.replace(/^0x/, ""), "hex"))]];
    }),
  );
  return {
    paymentRouters: data.paymentRouters,
    ...(solanaChains.length === 0 || solanaSecret === undefined
      ? {}
      : {
          solana: {
            signerSecretKey: solanaSecret,
            deploymentDomains,
            feeRecipients: data.solanaFeeRecipients,
            orcaPools: data.solanaOrcaPools,
            orcaLookupTables: data.solanaOrcaLookupTables,
          },
        }),
  };
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
      // A payer-only ERC-20 (WETH, WBTC, cbBTC) is watched and routed from CHAIN_ASSETS
      // but is not a stablecoin, so it never joins the settlement set below.
      if (isTokenizedCrypto(rawAsset)) continue;
      if (getAsset(rawAsset).kind !== "stablecoin") {
        issues.push(`CHAIN_ASSETS names a non-stablecoin asset "${rawAsset}"`);
        continue;
      }
      admitted.add(rawAsset);
      const rawAddress = tokens?.[rawAsset] ?? "";
      const address = isSolanaChainId(chain) ? rawAddress : rawAddress.toLowerCase();
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
  const hasEvmAssets = Object.keys(data.chainAssets).some(
    (chain) => isChainId(chain) && !isSolanaChainId(chain),
  );
  if (hasEvmAssets && data.depositXpub === undefined) {
    issues.push("DEPOSIT_XPUB is required when CHAIN_ENABLED is true");
  }
  const hasSolanaAssets = Object.keys(data.chainAssets).some(
    (chain) => isChainId(chain) && isSolanaChainId(chain),
  );
  const solanaDepositSeed =
    data.solanaDepositSeed === undefined
      ? undefined
      : Uint8Array.from(Buffer.from(data.solanaDepositSeed, "base64"));
  if (hasSolanaAssets && solanaDepositSeed?.length !== 32) {
    issues.push("SOLANA_DEPOSIT_SEED must decode to exactly 32 bytes");
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
    for (const [asset, address] of Object.entries(tokens ?? {})) {
      if (!isReviewedToken(chainId, asset as AssetCode, address)) {
        issues.push(
          `CHAIN_ASSETS lists ${asset} ${address} on ${chainId}, which is not in the reviewed ` +
            `mainnet token list (packages/core/chain/src/reviewed-tokens.ts)`,
        );
      }
    }
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
    ...(solanaDepositSeed === undefined ? {} : { solanaDepositSeed }),
    intervalMs: data.watcherIntervalMs,
    catchUpIntervalMs: data.watcherCatchUpIntervalMs,
    indexerIntervalMs: data.indexerIntervalMs,
    indexerMaxBackoffMs: data.indexerMaxBackoffMs,
    blockRange: data.watcherBlockRange,
    nativeBlockRange: data.watcherNativeBlockRange,
    tokenBalanceCatchUp: data.watcherTokenBalanceCatchUp,
    logRange: data.chainLogRange,
    logRanges: data.chainLogRanges,
    maxStartBacklogBlocks: data.watcherMaxStartBacklogBlocks,
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
 * The sandbox auto-settle is a statement that value arrived, made without
 * evidence — so it exists only where no value can. Anything that is not
 * TransFi's sandbox host fails boot rather than quietly settling real payments.
 */
export type DeploymentNetwork = "testnet" | "mainnet";

/** What the buyer-facing pages say they are: a mainnet if any chain is, else a testnet. */
export function deploymentNetwork(
  data: Pick<RawConfig, "chainAssets" | "paymentRouters">,
): DeploymentNetwork {
  return isMainnetDeployment(data) ? "mainnet" : "testnet";
}

/** True when any configured chain, token or router, is a mainnet. */
export function isMainnetDeployment(
  data: Pick<RawConfig, "chainAssets" | "paymentRouters">,
): boolean {
  return [...Object.keys(data.chainAssets), ...Object.keys(data.paymentRouters)].some(
    (chain) => isChainId(chain) && isMainnetChain(chain),
  );
}

function assertPaymentLimit(data: RawConfig, role: ConfigRole): void {
  const issues: string[] = [];
  const limits = {
    MAX_PAYMENT_SETTLEMENT: data.maxPaymentSettlement,
    MAX_MERCHANT_DAILY_SETTLEMENT: data.maxMerchantDailySettlement,
  };
  for (const [name, limit] of Object.entries(limits)) {
    for (const [asset, value] of Object.entries(limit)) {
      if (!isAssetCode(asset)) {
        issues.push(`${name} names an unknown asset "${asset}"`);
        continue;
      }
      try {
        if (fromDecimalString(value, asset).amount <= 0n) throw new Error("not positive");
      } catch {
        issues.push(`${name} ${asset} must be a positive decimal, got "${value}"`);
      }
    }
  }
  const onMainnet = isMainnetDeployment(data);
  if (onMainnet && Object.keys(data.maxPaymentSettlement).length === 0) {
    issues.push(
      "MAX_PAYMENT_SETTLEMENT is required when a mainnet chain is configured: set the largest payment, per settlement asset, this deployment will accept",
    );
  }
  for (const [chain, value] of Object.entries(data.relayerGasFeeMinimums)) {
    if (!isChainId(chain)) {
      issues.push(`RELAYER_GAS_FEE_MINIMUMS names an unknown chain "${chain}"`);
    } else if (!/^\d+(\.\d+)?$/.test(value) || Number(value) <= 0) {
      issues.push(`RELAYER_GAS_FEE_MINIMUMS ${chain} must be a positive decimal, got "${value}"`);
    }
  }
  // The operator fronts gas on a relayed payment, and the percentage alone does
  // not cover it on a small payment or a dear chain: no mainnet chain goes live
  // without the floor that makes the payer, not Mayarin, pay for it.
  for (const chain of Object.keys(data.paymentRouters)) {
    if (
      isChainId(chain) &&
      isMainnetChain(chain) &&
      data.relayerGasFeeMinimums[chain] === undefined
    ) {
      issues.push(
        `RELAYER_GAS_FEE_MINIMUMS has no entry for ${chain}: a mainnet chain needs the least a relayed payment reimburses in gas`,
      );
    }
  }
  if (onMainnet && data.defaultProvider === "mock") {
    issues.push(
      "DEFAULT_SETTLEMENT_PROVIDER=mock moves no value and is refused when a mainnet chain is configured",
    );
  }
  if (onMainnet && data.operatorSigner === "local" && data.operatorPrivateKey !== undefined) {
    issues.push(
      "OPERATOR_SIGNER=local holds the operator key in this process and is refused when a mainnet chain is configured: use OPERATOR_SIGNER=turnkey or aws-kms",
    );
  }
  if (data.operatorSigner === "aws-kms") {
    if (data.operatorAwsKmsKeyId === undefined) {
      issues.push("OPERATOR_AWS_KMS_KEY_ID is required when OPERATOR_SIGNER=aws-kms");
    }
    if (data.awsKmsRegion === undefined) {
      issues.push("AWS_KMS_REGION is required when OPERATOR_SIGNER=aws-kms");
    }
    if (data.operatorAddress === undefined) {
      issues.push("OPERATOR_ADDRESS is required when OPERATOR_SIGNER=aws-kms");
    }
    if (data.operatorAwsKmsKeyId !== undefined && data.operatorAwsKmsKeyId === data.awsKmsKeyId) {
      issues.push(
        "OPERATOR_AWS_KMS_KEY_ID must differ from AWS_KMS_KEY_ID: the operator and the order signer hold different powers and must not share a key",
      );
    }
    if (data.operatorPrivateKey !== undefined) {
      issues.push("OPERATOR_PRIVATE_KEY must not be set when OPERATOR_SIGNER=aws-kms");
    }
  }
  if (data.operatorSigner === "turnkey") {
    if (data.turnkeyOrganizationId === undefined) {
      issues.push("TURNKEY_ORGANIZATION_ID is required when OPERATOR_SIGNER=turnkey");
    }
    if (data.operatorTurnkeySignWith === undefined) {
      issues.push("OPERATOR_TURNKEY_SIGN_WITH is required when OPERATOR_SIGNER=turnkey");
    }
    if (data.operatorAddress === undefined) {
      issues.push("OPERATOR_ADDRESS is required when OPERATOR_SIGNER=turnkey");
    }
    if (
      data.operatorTurnkeyApiPublicKey === undefined ||
      data.operatorTurnkeyApiPrivateKey === undefined
    ) {
      issues.push(
        "OPERATOR_TURNKEY_API_PUBLIC_KEY and OPERATOR_TURNKEY_API_PRIVATE_KEY are required when OPERATOR_SIGNER=turnkey",
      );
    } else if (data.operatorTurnkeyApiPublicKey === data.turnkeyApiPublicKey) {
      issues.push(
        "OPERATOR_TURNKEY_API_PUBLIC_KEY must differ from TURNKEY_API_PUBLIC_KEY: a policy does not bind the organization's root key",
      );
    }
    if (data.operatorPrivateKey !== undefined) {
      issues.push("OPERATOR_PRIVATE_KEY must not be set when OPERATOR_SIGNER=turnkey");
    }
  }
  // The chain worker has no HTTP surface and never reads webhook endpoints or mints
  // payer tokens, so its SEC-05 policy withholds these three from it. Only the API
  // processes are refused without them.
  if (onMainnet && role === "api" && data.webhookSecretEncryptionKey === undefined) {
    issues.push("WEBHOOK_SECRET_ENCRYPTION_KEY is required when a mainnet chain is configured");
  }
  if (onMainnet && role === "api" && data.payerTokenKey === undefined) {
    issues.push("PAYER_TOKEN_KEY is required when a mainnet chain is configured");
  }
  if (onMainnet && role === "api" && data.internalApiToken === undefined) {
    issues.push("INTERNAL_API_TOKEN is required when a mainnet chain is configured");
  }
  if (issues.length > 0) {
    throw new ConfigurationError(`Invalid payment limit: ${issues.join("; ")}`, { issues });
  }
}

function assertTransfiSandboxSettle(data: RawConfig): void {
  if (!data.transfiSandboxAutoSettle) return;
  const base = data.transfiBaseUrl;
  if (base === undefined || !new URL(base).hostname.includes("sandbox")) {
    throw new ConfigurationError(
      "TRANSFI_SANDBOX_AUTO_SETTLE is only allowed with TRANSFI_BASE_URL pointing at TransFi's sandbox",
      { transfiBaseUrl: base ?? null },
    );
  }
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
  const routerChains = Object.keys(data.paymentRouters);
  const hasEvmRouter = routerChains.some(isEvmChainId);

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
  if (hasEvmRouter && data.treasuryAddress === undefined) {
    issues.push("TREASURY_ADDRESS is required when TREASURY_EXECUTION_ENABLED is true");
  }
  if (hasEvmRouter && !operatorConfigured(data)) {
    issues.push(
      "An operator signer is required when TREASURY_EXECUTION_ENABLED is true: OPERATOR_PRIVATE_KEY, or OPERATOR_SIGNER=turnkey or aws-kms",
    );
  }
  if (hasEvmRouter && data.depositForwarderInitCodeHash === undefined) {
    issues.push(
      "DEPOSIT_FORWARDER_INIT_CODE_HASH is required when TREASURY_EXECUTION_ENABLED is true",
    );
  }
  for (const chain of routerChains) {
    if (isEvmChainId(chain) && data.depositForwarders[chain] === undefined) {
      issues.push(`DEPOSIT_FORWARDERS has no factory for ${chain}, which has a PaymentRouter`);
    }
  }
  if (hasEvmRouter && Object.keys(data.depositForwarders).length === 0) {
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

/** Which process is loading the config: the HTTP API, or the chain worker (no HTTP surface). */
export type ConfigRole = "api" | "worker";

export function loadConfig(
  rawEnv: Record<string, string | undefined> = process.env,
  role: ConfigRole = "api",
): Config {
  const env = withoutEmpty(rawEnv);
  const result = configSchema.safeParse({
    port: env.PORT,
    databaseUrl: env.DATABASE_URL,
    settlementAsset: env.SETTLEMENT_ASSET,
    settlementAssets: env.SETTLEMENT_ASSETS,
    feeBasisPoints: env.FEE_BASIS_POINTS,
    feeMinimum: env.FEE_MINIMUM,
    relayerGasFeeBasisPoints: env.RELAYER_GAS_FEE_BASIS_POINTS,
    relayerGasFeeMinimums: env.RELAYER_GAS_FEE_MINIMUMS,
    defaultProvider: env.DEFAULT_SETTLEMENT_PROVIDER,
    paymentIntentTtlSeconds: env.PAYMENT_INTENT_TTL_SECONDS,
    assetReceiptMode: env.ASSET_RECEIPT_MODE,
    executionPath: env.EXECUTION_PATH,
    exchangeRates: env.EXCHANGE_RATES,
    maxPaymentSettlement: env.MAX_PAYMENT_SETTLEMENT,
    maxMerchantDailySettlement: env.MAX_MERCHANT_DAILY_SETTLEMENT,
    webhookSecretEncryptionKey: env.WEBHOOK_SECRET_ENCRYPTION_KEY,
    webhookSecretPreviousKeys: env.WEBHOOK_SECRET_PREVIOUS_KEYS,
    payerTokenKey: env.PAYER_TOKEN_KEY,
    payerTokenTtlSeconds: env.PAYER_TOKEN_TTL_SECONDS,
    internalApiToken: env.INTERNAL_API_TOKEN,
    chainEnabled: env.CHAIN_ENABLED,
    chainRpcUrls: env.CHAIN_RPC_URLS,
    escrowArbiter: env.ESCROW_ARBITER,
    escrowAlertWebhookUrl: env.ESCROW_ALERT_WEBHOOK_URL,
    resendApiKey: env.RESEND_API_KEY,
    emailFrom: env.RESEND_FROM_EMAIL,
    dashboardUrl: env.DASHBOARD_URL,
    chainAssets: env.CHAIN_ASSETS,
    chainNativeAssets: env.CHAIN_NATIVE_ASSETS,
    chainConfirmations: env.CHAIN_CONFIRMATIONS,
    chainStartBlocks: env.CHAIN_START_BLOCKS,
    depositXpub: env.DEPOSIT_XPUB,
    solanaDepositSeed: env.SOLANA_DEPOSIT_SEED,
    watcherIntervalMs: env.WATCHER_INTERVAL_MS,
    indexerIntervalMs: env.INDEXER_INTERVAL_MS,
    indexerMaxBackoffMs: env.INDEXER_MAX_BACKOFF_MS,
    watcherCatchUpIntervalMs: env.WATCHER_CATCH_UP_INTERVAL_MS,
    watcherBlockRange: env.WATCHER_BLOCK_RANGE,
    watcherNativeBlockRange: env.WATCHER_NATIVE_BLOCK_RANGE,
    watcherTokenBalanceCatchUp: env.WATCHER_TOKEN_BALANCE_CATCH_UP,
    chainLogRange: env.CHAIN_LOG_RANGE,
    chainLogRanges: env.CHAIN_LOG_RANGES,
    watcherMaxStartBacklogBlocks: env.WATCHER_MAX_START_BACKLOG_BLOCKS,
    watcherRetentionSeconds: env.WATCHER_RETENTION_SECONDS,
    watcherReorgWatchWindow: env.WATCHER_REORG_WATCH_WINDOW,
    adminToken: env.ADMIN_TOKEN,
    rateLimitRequests: env.API_RATE_LIMIT_REQUESTS,
    apiKeyRateLimitRequests: env.API_KEY_RATE_LIMIT_REQUESTS,
    rateLimitWindowSeconds: env.RATE_LIMIT_WINDOW_SECONDS,
    rateLimitBlockSeconds: env.RATE_LIMIT_BLOCK_SECONDS,
    rateLimitMaxClients: env.RATE_LIMIT_MAX_CLIENTS,
    allowedHosts: env.ALLOWED_HOSTS,
    originAuthSecret: env.ORIGIN_AUTH_SECRET,
    adminAllowedHosts: env.ADMIN_ALLOWED_HOSTS,
    rateLimitClientIpSource: env.RATE_LIMIT_CLIENT_IP_SOURCE,
    realtimeEnabled: env.REALTIME_ENABLED,
    realtimeMaxWatched: env.REALTIME_MAX_WATCHED,
    publicBaseUrl: env.PUBLIC_BASE_URL,
    checkoutBaseUrl: env.CHECKOUT_BASE_URL ?? env.PUBLIC_BASE_URL,
    checkoutUiDist: env.CHECKOUT_UI_DIST,
    mockWebhookSecret: env.MOCK_WEBHOOK_SECRET,
    webhooksEnabled: env.WEBHOOKS_ENABLED,
    webhookIntervalMs: env.WEBHOOK_INTERVAL_MS,
    quoteEnabled: env.QUOTE_ENABLED,
    quoteVenues: env.QUOTE_VENUES,
    quoteOracle: env.QUOTE_ORACLE,
    quoteOracleFallbacks: env.QUOTE_ORACLE_FALLBACKS,
    quoteDeviationBps: env.QUOTE_DEVIATION_BPS,
    quoteDeviationBpsByVenue: env.QUOTE_DEVIATION_BPS_BY_VENUE,
    quoteUnguardedTestnetPairs: env.QUOTE_UNGUARDED_TESTNET_PAIRS,
    quoteOracleAgreementBps: env.QUOTE_ORACLE_AGREEMENT_BPS,
    quoteMaxReferenceAgeSeconds: env.QUOTE_MAX_REFERENCE_AGE_SECONDS,
    quotePeggedPairs: env.QUOTE_PEGGED_PAIRS,
    quoteFxMaxAgeSeconds: env.QUOTE_FX_MAX_AGE_SECONDS,
    quoteFxClosedMaxAgeSeconds: env.QUOTE_FX_CLOSED_MAX_AGE_SECONDS,
    quoteFxClosedSpreadBps: env.QUOTE_FX_CLOSED_SPREAD_BPS,
    quoteSlippageBps: env.QUOTE_SLIPPAGE_BPS,
    quoteTtlSeconds: env.QUOTE_TTL_SECONDS,
    pythFeeds: env.PYTH_FEEDS,
    pythApiKey: env.PYTH_API_KEY,
    pythHermesEndpoint: env.PYTH_HERMES_ENDPOINT,
    fxFeeds: env.FX_FEEDS,
    fxEndpoint: env.FX_ENDPOINT,
    fxCacheSeconds: env.FX_CACHE_SECONDS,
    coinbaseProducts: env.COINBASE_PRODUCTS,
    coinbaseEndpoint: env.COINBASE_ENDPOINT,
    chainlinkFeeds: env.CHAINLINK_FEEDS,
    zeroExApiKey: env.ZERO_EX_API_KEY,
    zeroExChainId: env.ZERO_EX_CHAIN_ID,
    zeroExPairs: env.ZERO_EX_PAIRS,
    transfiBaseUrl: env.TRANSFI_BASE_URL,
    transfiMid: env.TRANSFI_MID,
    transfiUsername: env.TRANSFI_USERNAME,
    transfiPassword: env.TRANSFI_PASSWORD,
    transfiWebhookSecret: env.TRANSFI_WEBHOOK_SECRET,
    transfiSandboxAutoSettle: env.TRANSFI_SANDBOX_AUTO_SETTLE,
    uniswapQuoters: env.UNISWAP_QUOTERS,
    uniswapPools: env.UNISWAP_POOLS,
    uniswapV2Routers: env.UNISWAP_V2_ROUTERS,
    uniswapV2Pairs: env.UNISWAP_V2_PAIRS,
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
    awsKmsKeyId: env.AWS_KMS_KEY_ID,
    awsKmsRegion: env.AWS_KMS_REGION,
    awsKmsSignerAddress: env.AWS_KMS_SIGNER_ADDRESS,
    contractPathEnabled: env.CONTRACT_PATH_ENABLED,
    paymentRouters: env.PAYMENT_ROUTERS,
    solanaOrderSignerSecretKey: env.SOLANA_ORDER_SIGNER_SECRET_KEY,
    solanaDeploymentDomains: env.SOLANA_DEPLOYMENT_DOMAINS,
    solanaFeeRecipients: env.SOLANA_FEE_RECIPIENTS,
    solanaOrcaPools: env.SOLANA_ORCA_POOLS,
    solanaOrcaLookupTables: env.SOLANA_ORCA_LOOKUP_TABLES,
    treasuryExecutionEnabled: env.TREASURY_EXECUTION_ENABLED,
    x402Enabled: env.X402_ENABLED,
    x402QuoteTtlSeconds: env.X402_QUOTE_TTL_SECONDS,
    depositForwarders: env.DEPOSIT_FORWARDERS,
    depositForwarderInitCodeHash: env.DEPOSIT_FORWARDER_INIT_CODE_HASH,
    treasuryAddress: env.TREASURY_ADDRESS,
    operatorPrivateKey: env.OPERATOR_PRIVATE_KEY,
    operatorSigner: env.OPERATOR_SIGNER,
    operatorAwsKmsKeyId: env.OPERATOR_AWS_KMS_KEY_ID,
    operatorTurnkeySignWith: env.OPERATOR_TURNKEY_SIGN_WITH,
    operatorAddress: env.OPERATOR_ADDRESS,
    operatorFloatLimits: env.OPERATOR_FLOAT_LIMITS,
    operatorTurnkeyApiPublicKey: env.OPERATOR_TURNKEY_API_PUBLIC_KEY,
    operatorTurnkeyApiPrivateKey: env.OPERATOR_TURNKEY_API_PRIVATE_KEY,
    treasuryMaxAttempts: env.TREASURY_MAX_ATTEMPTS,
    uniswapSwapRouters: env.UNISWAP_SWAP_ROUTERS,
    swapRouterAllowlist: env.SWAP_ROUTER_ALLOWLIST,
    nodeEnv: env.NODE_ENV,
  });

  if (!result.success) {
    throw new ConfigurationError("Invalid environment configuration", {
      issues: result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`),
    });
  }

  if (
    result.data.treasuryExecutionEnabled &&
    result.data.feeBasisPoints + result.data.relayerGasFeeBasisPoints >= 10_000
  ) {
    throw new ConfigurationError(
      "FEE_BASIS_POINTS + RELAYER_GAS_FEE_BASIS_POINTS must leave a positive merchant payout",
      {
        feeBasisPoints: result.data.feeBasisPoints,
        relayerGasFeeBasisPoints: result.data.relayerGasFeeBasisPoints,
      },
    );
  }

  const stablecoins = resolveStablecoins(result.data);
  const chain = resolveChain(result.data);
  const quote = resolveQuote(result.data);
  const contract = resolveContract(result.data, quote, stablecoins);
  assertTreasuryExecution(result.data, quote);
  assertTransfiSandboxSettle(result.data);
  assertPaymentLimit(result.data, role);

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

/** Whether some operator signer is set up, whichever kind. */
function operatorConfigured(data: {
  readonly operatorSigner: "local" | "turnkey" | "aws-kms";
  readonly operatorPrivateKey?: string | undefined;
  readonly operatorTurnkeySignWith?: string | undefined;
  readonly operatorAwsKmsKeyId?: string | undefined;
}): boolean {
  if (data.operatorSigner === "aws-kms") return data.operatorAwsKmsKeyId !== undefined;
  return data.operatorSigner === "turnkey"
    ? data.operatorTurnkeySignWith !== undefined
    : data.operatorPrivateKey !== undefined;
}
