/**
 * Runtime configuration.
 *
 * Validated once at startup. The dashboard API shares the same Postgres as the
 * payment API, so it only needs the session/auth knobs plus the database URL.
 */

import type { ChainId } from "@mayarin/chain";
import { CHAIN_IDS } from "@mayarin/chain";
import { type AssetCode, ConfigurationError } from "@mayarin/shared";
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
  /** Session lifetime in seconds. Defaults to 7 days. */
  sessionTtlSeconds: z.coerce
    .number()
    .int()
    .positive()
    .default(60 * 60 * 24 * 7),
  /**
   * Sets the `Secure` flag on the session/CSRF cookies. True in production; set
   * `COOKIE_SECURE=false` for local dev over plain HTTP.
   */
  cookieSecure: z
    .enum(["true", "false"])
    .default("true")
    .transform((value) => value === "true"),
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
  rateLimitClientIpSource: z
    .enum(["cf-connecting-ip", "socket", "x-forwarded-for", "x-real-ip"])
    .default("socket"),
  /** Page size cap for payment listings. */
  paymentsPageSize: z.coerce.number().int().positive().max(200).default(7),
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
  /**
   * The chain a counter payment is taken on.
   *
   * One chain, deployed and proven, like every other address-deriving surface
   * here. Separate from `walletProvisionChain` on purpose: where a merchant's
   * Safe lives and where a payer is asked to send funds are two decisions, and
   * one key that answers both is one key that cannot express a difference.
   */
  depositChain: z.enum(CHAIN_IDS).default("base-sepolia"),
  checkoutBaseUrl: z
    .string()
    .url()
    .default("http://localhost:3000")
    // A trailing slash would produce `…//checkout/lnk_…`, which some proxies
    // normalise and others 404.
    .transform((value) => value.replace(/\/+$/, "")),
  /**
   * Where fees are paid (#11, RFC #6).
   *
   * The dashboard needs it to refuse it: a merchant wallet that is also the fee
   * destination pays that merchant twice and is invisible in the ledger, and
   * the dashboard is where merchant wallets are created.
   */
  treasuryAddress: z.string().min(1).optional(),

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
  /** One chain, deployed and proven, before address derivation multiplies. */
  walletProvisionChain: z.enum(CHAIN_IDS).default("base-sepolia"),
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
  chainAssets: jsonObject<Partial<Record<ChainId, Partial<Record<AssetCode, string>>>>>(
    "CHAIN_ASSETS",
    "{}",
  ),
  /** The chain's own currency, which has no contract to read a balance from. */
  chainNativeAssets: jsonObject<Partial<Record<ChainId, AssetCode>>>("CHAIN_NATIVE_ASSETS", "{}"),
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
    cookieSecure: env.COOKIE_SECURE,
    rateLimitRequests: env.DASHBOARD_RATE_LIMIT_REQUESTS,
    rateLimitWindowSeconds: env.RATE_LIMIT_WINDOW_SECONDS,
    rateLimitBlockSeconds: env.RATE_LIMIT_BLOCK_SECONDS,
    loginRateLimitRequests: env.DASHBOARD_LOGIN_RATE_LIMIT_REQUESTS,
    loginRateLimitWindowSeconds: env.DASHBOARD_LOGIN_RATE_LIMIT_WINDOW_SECONDS,
    rateLimitMaxClients: env.RATE_LIMIT_MAX_CLIENTS,
    rateLimitClientIpSource: env.RATE_LIMIT_CLIENT_IP_SOURCE,
    paymentsPageSize: env.PAYMENTS_PAGE_SIZE,
    checkoutBaseUrl: env.CHECKOUT_BASE_URL ?? env.PUBLIC_BASE_URL,
    paymentApiUrl: env.PAYMENT_API_URL ?? env.PUBLIC_BASE_URL,
    depositChain: env.DEPOSIT_CHAIN,
    treasuryAddress: env.TREASURY_ADDRESS,
    walletProvisioningEnabled: env.WALLET_PROVISIONING_ENABLED,
    walletProvisionChain: env.WALLET_PROVISION_CHAIN,
    walletProvisionRpcUrl: env.WALLET_PROVISION_RPC_URL,
    walletDeployerPrivateKey: env.WALLET_DEPLOYER_PRIVATE_KEY,
    turnkeyOrganizationId: env.TURNKEY_ORGANIZATION_ID,
    turnkeyApiPublicKey: env.TURNKEY_API_PUBLIC_KEY,
    turnkeyApiPrivateKey: env.TURNKEY_API_PRIVATE_KEY,
    turnkeySignerApiPublicKey: env.TURNKEY_SIGNER_API_PUBLIC_KEY,
    chainAssets: env.CHAIN_ASSETS,
    chainNativeAssets: env.CHAIN_NATIVE_ASSETS,
  });

  if (!result.success) {
    throw new ConfigurationError("Invalid environment configuration", {
      issues: result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`),
    });
  }

  assertWalletProvisioning(result.data);
  return result.data;
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
