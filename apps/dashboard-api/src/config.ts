/**
 * Runtime configuration.
 *
 * Validated once at startup. The dashboard API shares the same Postgres as the
 * payment API, so it only needs the session/auth knobs plus the database URL.
 */

import { CHAIN_IDS } from "@mayarin/chain";
import { ConfigurationError } from "@mayarin/shared";
import { z } from "zod";

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
  /** Page size cap for payment listings. */
  paymentsPageSize: z.coerce.number().int().positive().max(200).default(50),
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
});

export type Config = z.infer<typeof configSchema>;

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const result = configSchema.safeParse({
    port: env.DASHBOARD_API_PORT,
    databaseUrl: env.DATABASE_URL,
    sessionTtlSeconds: env.SESSION_TTL_SECONDS,
    cookieSecure: env.COOKIE_SECURE,
    paymentsPageSize: env.PAYMENTS_PAGE_SIZE,
    treasuryAddress: env.TREASURY_ADDRESS,
    walletProvisioningEnabled: env.WALLET_PROVISIONING_ENABLED,
    walletProvisionChain: env.WALLET_PROVISION_CHAIN,
    walletProvisionRpcUrl: env.WALLET_PROVISION_RPC_URL,
    walletDeployerPrivateKey: env.WALLET_DEPLOYER_PRIVATE_KEY,
    turnkeyOrganizationId: env.TURNKEY_ORGANIZATION_ID,
    turnkeyApiPublicKey: env.TURNKEY_API_PUBLIC_KEY,
    turnkeyApiPrivateKey: env.TURNKEY_API_PRIVATE_KEY,
    turnkeySignerApiPublicKey: env.TURNKEY_SIGNER_API_PUBLIC_KEY,
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
