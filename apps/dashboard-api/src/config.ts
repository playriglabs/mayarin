/**
 * Runtime configuration.
 *
 * Validated once at startup. The dashboard API shares the same Postgres as the
 * payment API, so it only needs the session/auth knobs plus the database URL.
 */

import type { ChainId } from "@mayarin/chain";
import { CHAIN_IDS } from "@mayarin/chain";
import { parseHostList } from "@mayarin/http";
import { type AssetCode, assetCodeSchema, ConfigurationError } from "@mayarin/shared";
import { z } from "zod";

/** Same shape the payment API parses these from, so one `.env` serves both. */
function jsonObject<T>(name: string, fallback: string) {
  return z
    .string()
    .default(fallback)
    .transform((value, ctx): T => {
      try {
        return JSON.parse(value) as T;
      } catch {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${name} must be valid JSON` });
        return z.NEVER;
      }
    });
}

const configSchema = z.object({
  port: z.coerce.number().int().positive().default(3001),
  databaseUrl: z.string().min(1),
  /** A session unused for this many seconds is signed out. Defaults to 1 hour. */
  sessionIdleSeconds: z.coerce.number().int().positive().default(3_600),
  /** Daily exchange-rate table for showing money in the merchant's currency. Display only. */
  displayRatesUrl: z.string().url().default("https://open.er-api.com/v6/latest/USD"),
  /** How long one fetch of that table is reused. The source updates once a day. */
  displayRatesTtlSeconds: z.coerce.number().int().positive().default(21_600),
  /** Session lifetime in seconds. Defaults to 7 days. */
  sessionTtlSeconds: z.coerce
    .number()
    .int()
    .positive()
    .default(60 * 60 * 24 * 7),
  /**
   * Key that encrypts authenticator secrets at rest and signs the short-lived
   * sign-in challenge (SEC-16). At least 32 characters; losing it locks every
   * enrolled account out of its second factor, so it is backed up like a
   * signing key and rotated deliberately.
   */
  mfaEncryptionKey: z.string().min(32),
  /** Same value as the payment API's: both read webhook endpoints (SEC-12). */
  webhookSecretEncryptionKey: z.string().min(32).optional(),
  /** Keys that rows may still be sealed under while a rotation rewrites them; comma separated. */
  webhookSecretPreviousKeys: z
    .string()
    .default("")
    .transform((value) => value.split(",").filter((key) => key !== "")),
  /**
   * Proves to the payment API that this service, not a payer, is asking about a
   * payment (SEC-09). Must equal its `INTERNAL_API_TOKEN`.
   */
  internalApiToken: z.string().min(32),
  /** Signs the payer tokens in the document links; must equal the payment API's `PAYER_TOKEN_KEY`. */
  payerTokenKey: z.string().min(32),
  payerTokenTtlSeconds: z.coerce
    .number()
    .int()
    .positive()
    .default(30 * 24 * 3600),
  /**
   * Sets the `Secure` flag on the session/CSRF cookies. True in production; set
   * `COOKIE_SECURE=false` for local dev over plain HTTP.
   */
  cookieSecure: z
    .enum(["true", "false"])
    .default("true")
    .transform((value) => value === "true"),
  /** Hours a newly verified wallet must wait before it can receive a withdrawal (SEC-16). */
  withdrawCoolingOffHours: z.coerce.number().int().nonnegative().default(24),
  /** Most one merchant may withdraw per rolling 24 hours, in whole units of the asset (SEC-16). */
  withdrawDailyLimit: z.coerce.bigint().positive().default(10_000n),
  /** Per-client request budget for the versioned dashboard API. */
  rateLimitRequests: z.coerce.number().int().positive().default(120),
  /** Seconds required to refill a fully exhausted request budget. */
  rateLimitWindowSeconds: z.coerce.number().int().positive().default(60),
  /** Fixed lockout after a client exhausts a request budget. */
  rateLimitBlockSeconds: z.coerce.number().int().positive().default(300),
  /** Per-client request budget for the dashboard login endpoint. */
  loginRateLimitRequests: z.coerce.number().int().positive().default(5),
  /** Seconds required to refill a fully exhausted login request budget. */
  loginRateLimitWindowSeconds: z.coerce.number().int().positive().default(60),
  /** Maximum client buckets retained by one process. */
  rateLimitMaxClients: z.coerce.number().int().positive().default(10_000),
  /** Trusted source of the caller IP for rate-limit buckets. */
  /**
   * Hostnames this service answers to, comma-separated (SEC-13). Any other
   * `Host` — the generated Railway domain, for one — gets a 404 before routing.
   * Blank turns the check off.
   */
  allowedHosts: z.string().default("").transform(parseHostList),
  rateLimitClientIpSource: z
    .enum(["cf-connecting-ip", "socket", "x-forwarded-for", "x-real-ip"])
    .default("socket"),
  /** Page size cap for payment listings. */
  paymentsPageSize: z.coerce.number().int().positive().max(200).default(10),
  /**
   * Public origin of the payment API, where hosted checkout is served (#15).
   *
   * A payment link's whole value is its URL, and that URL points at the payment
   * API rather than at this one — the buyer opening it must reach the app that
   * mints intents. Served with the link rather than assembled in the browser,
   * which would get it wrong in exactly the deployment where the two apps are
   * not on the same host.
   */
  /**
   * Where the payment API is reachable from this process (#15).
   *
   * Taking a payment at the counter mints one, and minting needs the clearing
   * engine, the rate sources and the token registry that `apps/api` composes.
   * The dashboard asks that service rather than building a second copy of it.
   * Server-to-server, so this is an internal address where the two differ.
   */
  paymentApiUrl: z.string().url().default("http://localhost:3000"),
  checkoutBaseUrl: z
    .string()
    .url()
    .default("http://localhost:3000")
    // A trailing slash would produce `…//checkout/lnk_…`, which some proxies
    // normalise and others 404.
    .transform((value) => value.replace(/\/+$/, "")),
  /** Resend stays optional so read-only/local deployments still boot. */
  resendApiKey: z.string().min(1).optional(),
  /**
   * The sender every Mayarin email goes out as — invoices and verification
   * codes alike. One address, because they are one brand to the person reading
   * them, and a code that arrives from "Mayarin Invoices" reads as misdirected.
   *
   * `onboarding@resend.dev` is intentionally the demo default. Resend limits it
   * to the account owner's address; production sets a sender on a verified
   * domain without requiring a code change.
   */
  emailFrom: z.string().min(1).default("Mayarin <onboarding@resend.dev>"),
  /**
   * Where fees are paid (#11, RFC #6).
   *
   * The dashboard needs it to refuse it: a merchant wallet that is also the fee
   * destination pays that merchant twice and is invisible in the ledger, and
   * the dashboard is where merchant wallets are created.
   */
  treasuryAddress: z.string().min(1).optional(),
  /**
   * Mayarin Resolution's address (#313), the same `ESCROW_ARBITER` the payment
   * API names in escrow terms. The disputes console lists only disputes it
   * arbitrates; unset, the console is empty.
   */
  escrowArbiter: z
    .string()
    .regex(/^0x[0-9a-fA-F]{40}$/, "ESCROW_ARBITER must be an EVM address")
    .optional(),

  // --- Managed wallet provisioning (#11) ---------------------------------
  /**
   * Off by default, like every other layer that needs credentials. A deployment
   * without a wallet provider should boot without one rather than boot with a
   * provisioning path that fails at the first merchant who asks.
   *
   * Gates both wallet paths that need the provider: creating a passkey-held
   * merchant key, and provisioning the managed Safe. One flag rather than two
   * because a deployment with the first and not the second onboards merchants
   * into a key with no smart account to own, which is not a state worth
   * configuring on purpose.
   */
  walletProvisioningEnabled: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  /**
   * Every chain this deployment can provision a wallet on, in order.
   *
   * A merchant's managed wallet has one address on all of them — the same Safe,
   * deployed on each. Adding a chain is adding its name here and its
   * `CHAIN_RPC_URLS` entry; the canonical Safe contracts are checked on that
   * chain before anything is derived.
   *
   * The first entry is the default for a surface that names one chain — where a
   * connected wallet is recorded, say. A tuple rather than an array, so that
   * entry is known to exist without a check at every reader.
   */
  walletProvisionChains: z
    .string()
    .transform((value) =>
      value
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean),
    )
    .pipe(z.tuple([z.enum(CHAIN_IDS)]).rest(z.enum(CHAIN_IDS)))
    .default("base-sepolia"),
  walletProvisionRpcUrl: z.string().min(1).optional(),
  /** Pays the gas to deploy a merchant's Safe. The merchant has none — that is #9. */
  walletDeployerPrivateKey: z.string().min(1).optional(),
  turnkeyOrganizationId: z.string().min(1).optional(),
  turnkeyApiPublicKey: z.string().min(1).optional(),
  turnkeyApiPrivateKey: z.string().min(1).optional(),
  /**
   * The public half of the key the settlement path signs with, installed as a
   * **non-root** sub-organization user so Turnkey's policy engine applies to
   * it. A root key is exempt from policy, so reusing the root key here would
   * make the policy decoration.
   */
  turnkeySignerApiPublicKey: z.string().min(1).optional(),

  // --- Reading and moving what a settlement address holds (#11) -----------
  /**
   * ERC-20 addresses per chain and asset, shared with the payment API.
   *
   * Needed twice here: to read a merchant's settlement balance, and to build
   * the `transfer` a withdrawal makes. An asset missing from this map is one
   * this deployment will not report a balance for and will not move — both
   * refusals are better than a guessed token address.
   */
  /**
   * What a merchant who has chosen nothing is paid in.
   *
   * The same value the payment API boots with, and it has to match: the rail
   * catalog prices every rail into it, so a dashboard naming a different
   * default would report rails a payer is never offered.
   */
  settlementAsset: assetCodeSchema.default("USDC"),
  chainAssets: jsonObject<Partial<Record<ChainId, Partial<Record<AssetCode, string>>>>>(
    "CHAIN_ASSETS",
    "{}",
  ),
  /** The chain's own currency, which has no contract to read a balance from. */
  chainNativeAssets: jsonObject<Partial<Record<ChainId, AssetCode>>>("CHAIN_NATIVE_ASSETS", "{}"),
  /** One RPC per chain, the same map the payment API reads. */
  chainRpcUrls: jsonObject<Partial<Record<ChainId, string>>>("CHAIN_RPC_URLS", "{}"),
  /**
   * The most gas Mayarin funds one withdrawal's signer with, per chain, as a
   * decimal string of that chain's own smallest native unit.
   *
   * Per chain because the unit is the chain's currency and not a shared one.
   * The provider's default is shaped like ETH, where it is worth several Safe
   * transfers; on Arc, whose currency is USDC, the same number is two tenths of
   * a cent and below what any withdrawal costs, so every Arc withdrawal is
   * refused until this names a bound in Arc's own terms.
   *
   * A string rather than a number: a JSON number cannot hold 18 decimals.
   */
  walletGasTopUpBounds: jsonObject<Partial<Record<ChainId, string>>>(
    "WALLET_GAS_TOP_UP_BOUNDS",
    "{}",
  ),

  // --- Merchant logos (Cloudflare R2) --------------------------------------
  /**
   * Where uploaded company logos are stored. Optional: unset, the dashboard
   * shows the generated avatar and refuses an upload rather than failing boot.
   * All five or none — checked in `assertLogoStorage`.
   */
  r2AccountId: z.string().min(1).optional(),
  r2AccessKeyId: z.string().min(1).optional(),
  r2SecretAccessKey: z.string().min(1).optional(),
  r2Bucket: z.string().min(1).optional(),
  /** The bucket's public origin (r2.dev or a custom domain) a logo is served from. */
  r2PublicUrl: z
    .string()
    .url()
    .transform((value) => value.replace(/\/+$/, ""))
    .optional(),
});

export type Config = z.infer<typeof configSchema>;

/**
 * A blank environment variable means "not set", not "set to nothing".
 *
 * A dotenv file documents its keys by listing them — `WALLET_PROVISION_RPC_URL=`
 * says "this is the name, fill it in". Zod sees `""`, which is present, so
 * `.optional()` never applies and `.min(1)` fails. The result is a boot that dies
 * on a variable this deployment does not use and never intended to set: with
 * provisioning switched off, `.env.example` itself could not boot the dashboard
 * API, and neither could any file copied from it until every unused key was
 * deleted rather than left blank.
 *
 * Same treatment as `apps/api`, and for the same reason. A genuinely required key
 * still fails, as "required" rather than as a length complaint.
 */
function withoutEmpty(env: Record<string, string | undefined>): Record<string, string | undefined> {
  return Object.fromEntries(
    Object.entries(env).map(([key, value]) => [key, value === "" ? undefined : value]),
  );
}

export function loadConfig(rawEnv: Record<string, string | undefined> = process.env): Config {
  const env = withoutEmpty(rawEnv);
  const result = configSchema.safeParse({
    port: env.DASHBOARD_API_PORT ?? env.PORT,
    databaseUrl: env.DATABASE_URL,
    sessionTtlSeconds: env.SESSION_TTL_SECONDS,
    sessionIdleSeconds: env.SESSION_IDLE_SECONDS,
    displayRatesUrl: env.DISPLAY_RATES_URL,
    displayRatesTtlSeconds: env.DISPLAY_RATES_TTL_SECONDS,
    mfaEncryptionKey: env.MFA_ENCRYPTION_KEY,
    webhookSecretEncryptionKey: env.WEBHOOK_SECRET_ENCRYPTION_KEY,
    webhookSecretPreviousKeys: env.WEBHOOK_SECRET_PREVIOUS_KEYS,
    internalApiToken: env.INTERNAL_API_TOKEN,
    payerTokenKey: env.PAYER_TOKEN_KEY,
    payerTokenTtlSeconds: env.PAYER_TOKEN_TTL_SECONDS,
    withdrawCoolingOffHours: env.WITHDRAW_COOLING_OFF_HOURS,
    withdrawDailyLimit: env.WITHDRAW_DAILY_LIMIT,
    cookieSecure: env.COOKIE_SECURE,
    rateLimitRequests: env.DASHBOARD_RATE_LIMIT_REQUESTS,
    rateLimitWindowSeconds: env.RATE_LIMIT_WINDOW_SECONDS,
    rateLimitBlockSeconds: env.RATE_LIMIT_BLOCK_SECONDS,
    loginRateLimitRequests: env.DASHBOARD_LOGIN_RATE_LIMIT_REQUESTS,
    loginRateLimitWindowSeconds: env.DASHBOARD_LOGIN_RATE_LIMIT_WINDOW_SECONDS,
    rateLimitMaxClients: env.RATE_LIMIT_MAX_CLIENTS,
    allowedHosts: env.ALLOWED_HOSTS,
    rateLimitClientIpSource: env.RATE_LIMIT_CLIENT_IP_SOURCE,
    paymentsPageSize: env.PAYMENTS_PAGE_SIZE,
    checkoutBaseUrl: env.CHECKOUT_BASE_URL ?? env.PUBLIC_BASE_URL,
    paymentApiUrl: env.PAYMENT_API_URL ?? env.PUBLIC_BASE_URL,
    resendApiKey: env.RESEND_API_KEY,
    emailFrom: env.RESEND_FROM_EMAIL,
    treasuryAddress: env.TREASURY_ADDRESS,
    escrowArbiter: env.ESCROW_ARBITER,
    walletProvisioningEnabled: env.WALLET_PROVISIONING_ENABLED,
    walletProvisionChains: env.WALLET_PROVISION_CHAINS,
    walletProvisionRpcUrl: env.WALLET_PROVISION_RPC_URL,
    walletDeployerPrivateKey: env.WALLET_DEPLOYER_PRIVATE_KEY,
    turnkeyOrganizationId: env.TURNKEY_ORGANIZATION_ID,
    turnkeyApiPublicKey: env.TURNKEY_API_PUBLIC_KEY,
    turnkeyApiPrivateKey: env.TURNKEY_API_PRIVATE_KEY,
    turnkeySignerApiPublicKey: env.TURNKEY_SIGNER_API_PUBLIC_KEY,
    settlementAsset: env.SETTLEMENT_ASSET,
    chainAssets: env.CHAIN_ASSETS,
    chainNativeAssets: env.CHAIN_NATIVE_ASSETS,
    chainRpcUrls: env.CHAIN_RPC_URLS,
    walletGasTopUpBounds: env.WALLET_GAS_TOP_UP_BOUNDS,
    r2AccountId: env.R2_ACCOUNT_ID,
    r2AccessKeyId: env.R2_ACCESS_KEY_ID,
    r2SecretAccessKey: env.R2_SECRET_ACCESS_KEY,
    r2Bucket: env.R2_BUCKET,
    r2PublicUrl: env.R2_PUBLIC_URL,
  });

  if (!result.success) {
    throw new ConfigurationError("Invalid environment configuration", {
      issues: result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`),
    });
  }

  assertWalletProvisioning(result.data);
  assertLogoStorage(result.data);
  return result.data;
}

/** Logo storage is all five R2 variables or none of them. */
function assertLogoStorage(data: Config): void {
  const vars = [
    ["R2_ACCOUNT_ID", data.r2AccountId],
    ["R2_ACCESS_KEY_ID", data.r2AccessKeyId],
    ["R2_SECRET_ACCESS_KEY", data.r2SecretAccessKey],
    ["R2_BUCKET", data.r2Bucket],
    ["R2_PUBLIC_URL", data.r2PublicUrl],
  ] as const;
  const missing = vars.filter(([, value]) => value === undefined).map(([name]) => name);
  if (missing.length > 0 && missing.length < vars.length) {
    throw new ConfigurationError(`Logo storage needs ${missing.join(", ")}`, { missing });
  }
}

/**
 * Provisioning's own requirements, checked at boot rather than at the first
 * merchant who asks for a wallet.
 *
 * Half-configured provisioning is worse than none: it deploys nothing, or
 * deploys with a key nobody meant, and the merchant finds out when their money
 * is meant to arrive.
 */
function assertWalletProvisioning(data: Config): void {
  if (!data.walletProvisioningEnabled) return;

  const missing = (
    [
      ["WALLET_PROVISION_RPC_URL", data.walletProvisionRpcUrl],
      ["WALLET_DEPLOYER_PRIVATE_KEY", data.walletDeployerPrivateKey],
      ["TURNKEY_ORGANIZATION_ID", data.turnkeyOrganizationId],
      ["TURNKEY_API_PUBLIC_KEY", data.turnkeyApiPublicKey],
      ["TURNKEY_API_PRIVATE_KEY", data.turnkeyApiPrivateKey],
      ["TURNKEY_SIGNER_API_PUBLIC_KEY", data.turnkeySignerApiPublicKey],
    ] as const
  )
    .filter(([, value]) => value === undefined)
    .map(([name]) => name);

  if (missing.length > 0) {
    throw new ConfigurationError(`WALLET_PROVISIONING_ENABLED needs ${missing.join(", ")}`, {
      missing,
    });
  }

  // The signer key must not be the root key. Turnkey exempts root users from
  // the policy engine, so reusing it would leave the settlement key unbounded
  // while the code claims otherwise.
  if (data.turnkeySignerApiPublicKey === data.turnkeyApiPublicKey) {
    throw new ConfigurationError(
      "TURNKEY_SIGNER_API_PUBLIC_KEY must differ from TURNKEY_API_PUBLIC_KEY: Turnkey policies do not apply to root users, so a root signer is an unbounded one",
      {},
    );
  }
}
