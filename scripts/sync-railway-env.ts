/**
 * Synchronize local deployment configuration to Railway without printing values.
 *
 *   bun run scripts/sync-railway-env.ts                  every service
 *   bun run scripts/sync-railway-env.ts core-api         one service
 *   bun run scripts/sync-railway-env.ts --dry-run        show, change nothing
 *   bun run scripts/sync-railway-env.ts --prune          also delete variables the service no longer takes
 *   bun run scripts/sync-railway-env.ts --keep-database-url  leave DATABASE_URL alone (per-service roles, SEC-05)
 *
 * This overwrites the deployed environment with whatever is in the local `.env`,
 * one key at a time, and there is no undo. `--dry-run` exists because the
 * dangerous keys are the ones that look harmless: a development `false` for a
 * feature the deployment has switched on is a silent regression, not an error.
 */

import {
  type SecretPolicy,
  unexpectedRemoteSecrets,
  unreviewedKeys,
} from "./railway-env-policy.ts";

const DERIVED_KEYS = new Set(["DATABASE_URL", "PUBLIC_BASE_URL"]);

interface ServicePolicy {
  readonly name: "core-api" | "dashboard-api" | "chain-worker";
  readonly configPath: string;
  /** Reviewed credentials (SEC-05): see railway-env-policy.ts. */
  readonly secrets: SecretPolicy;
  readonly overrides: Readonly<Record<string, string>>;
}

const policies: readonly ServicePolicy[] = [
  {
    /**
     * core-api holds the operator key now, because x402 needs one.
     *
     * It used to be excluded here so exactly one process could sign: the
     * chain-worker sweeps deposits and calls the router, and a second holder
     * of the same key is a second source of nonces. That reasoning still
     * stands — what changed is that the x402 rail broadcasts the *payer's*
     * authorization from the API process, so excluding the key does not make
     * core-api keyless, it makes `/x402/*` answer 404 while looking deployed.
     *
     * The cost is real and worth writing down: submission serialisation is
     * per process, so a sweep on chain-worker and an x402 broadcast on
     * core-api can read the same pending nonce. `TREASURY_EXECUTION_ENABLED`
     * stays false here, which keeps the two apart in practice — core-api only
     * ever broadcasts authorizations. The fix that removes the race entirely
     * is a separate key for the facilitator, which is its own nonce space.
     */
    name: "core-api",
    configPath: "apps/api/src/config.ts",
    secrets: {
      allowed: new Set([
        "ADMIN_TOKEN",
        "DEPOSIT_XPUB",
        "LIFI_API_KEY",
        "MOCK_WEBHOOK_SECRET",
        "OPERATOR_PRIVATE_KEY",
        "PYTH_API_KEY",
        "QUOTE_SIGNER_PRIVATE_KEY",
        "RESEND_API_KEY",
        "SOLANA_DEPOSIT_SEED",
        "SOLANA_ORDER_SIGNER_SECRET_KEY",
        "TRANSFI_PASSWORD",
        "TRANSFI_WEBHOOK_SECRET",
        "TURNKEY_API_PRIVATE_KEY",
        "WEBHOOK_SECRET_ENCRYPTION_KEY",
        "ZERO_EX_API_KEY",
      ]),
      // Inbound-webhook and admin credentials only authenticate HTTP requests.
      withheld: new Set<string>(),
    },
    overrides: {
      DASHBOARD_URL: "https://dashboard-testnet.mayarin.xyz",
      DATABASE_URL: "$" + "{{Postgres.DATABASE_URL}}",
      LEFTHOOK: "0",
      NODE_ENV: "production",
      PORT: "3000",
      RATE_LIMIT_CLIENT_IP_SOURCE: "cf-connecting-ip",
      TREASURY_EXECUTION_ENABLED: "false",
    },
  },
  {
    name: "dashboard-api",
    configPath: "apps/dashboard-api/src/config.ts",
    secrets: {
      allowed: new Set([
        "MFA_ENCRYPTION_KEY",
        "R2_ACCESS_KEY_ID",
        "R2_SECRET_ACCESS_KEY",
        "RESEND_API_KEY",
        "TURNKEY_API_PRIVATE_KEY",
        "WALLET_DEPLOYER_PRIVATE_KEY",
        "WEBHOOK_SECRET_ENCRYPTION_KEY",
      ]),
      // Inbound-webhook and admin credentials only authenticate HTTP requests.
      withheld: new Set<string>(),
    },
    overrides: {
      COOKIE_SECURE: "true",
      DASHBOARD_API_PORT: "3001",
      DATABASE_URL: "$" + "{{Postgres.DATABASE_URL}}",
      LEFTHOOK: "0",
      NODE_ENV: "production",
      PAYMENT_API_URL: "http://core-api.railway.internal:3000",
      RATE_LIMIT_CLIENT_IP_SOURCE: "cf-connecting-ip",
    },
  },
  {
    name: "chain-worker",
    configPath: "apps/api/src/config.ts",
    secrets: {
      allowed: new Set([
        "DEPOSIT_XPUB",
        "LIFI_API_KEY",
        "OPERATOR_PRIVATE_KEY",
        "PYTH_API_KEY",
        "QUOTE_SIGNER_PRIVATE_KEY",
        "RESEND_API_KEY",
        "SOLANA_DEPOSIT_SEED",
        "SOLANA_ORDER_SIGNER_SECRET_KEY",
        "TRANSFI_PASSWORD",
        "TURNKEY_API_PRIVATE_KEY",
        "ZERO_EX_API_KEY",
      ]),
      // Inbound-webhook and admin credentials only authenticate HTTP requests.
      // The worker never reads webhook endpoints, so it never holds the key that opens them.
      withheld: new Set([
        "ADMIN_TOKEN",
        "MOCK_WEBHOOK_SECRET",
        "TRANSFI_WEBHOOK_SECRET",
        "WEBHOOK_SECRET_ENCRYPTION_KEY",
      ]),
    },
    overrides: {
      DASHBOARD_URL: "https://dashboard-testnet.mayarin.xyz",
      DATABASE_URL: "$" + "{{Postgres.DATABASE_URL}}",
      LEFTHOOK: "0",
      NODE_ENV: "production",
    },
  },
];

function configuredKeys(source: string): readonly string[] {
  return [...source.matchAll(/env\.([A-Z][A-Z0-9_]+)/g)].map((match) => match[1]).filter(Boolean);
}

async function inBatches<T>(
  items: readonly T[],
  size: number,
  run: (item: T) => Promise<void>,
): Promise<void> {
  for (let index = 0; index < items.length; index += size) {
    await Promise.all(items.slice(index, index + size).map(run));
  }
}

/**
 * Enough of a value to recognise, never enough to leak.
 *
 * A dry run has to be readable or nobody reads it, and it has to be safe to
 * paste into a chat or an issue — so anything that looks like a credential is
 * reported by length alone.
 */
function preview(key: string, value: string): string {
  if (/KEY|SECRET|TOKEN|PASSWORD|XPUB/.test(key)) return `<${value.length} chars>`;
  const oneLine = value.replaceAll(/\s+/g, " ");
  return oneLine.length > 68 ? `${oneLine.slice(0, 65)}…` : oneLine;
}

async function setVariable(service: string, key: string, value: string): Promise<void> {
  const child = Bun.spawn(
    [
      "railway",
      "variable",
      "set",
      key,
      "--stdin",
      "--service",
      service,
      "--skip-deploys",
      "--json",
    ],
    {
      stdin: new Response(value),
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  const exitCode = await child.exited;
  if (exitCode !== 0) {
    throw new Error(`Could not set ${key} for ${service}`);
  }
}

/** Names only: Railway's JSON listing carries values, which never leave this function. */
async function remoteKeys(service: string): Promise<readonly string[]> {
  const child = Bun.spawn(["railway", "variable", "list", "--service", service, "--json"], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [output, error, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (exitCode !== 0) throw new Error(`Could not list variables for ${service}: ${error.trim()}`);
  return Object.keys(JSON.parse(output) as Record<string, string>).filter(
    (key) => !key.startsWith("RAILWAY_"),
  );
}

async function deleteVariable(service: string, key: string): Promise<void> {
  const child = Bun.spawn(["railway", "variable", "delete", key, "--service", service], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [error, exitCode] = await Promise.all([new Response(child.stderr).text(), child.exited]);
  if (exitCode !== 0) throw new Error(`Could not delete ${key} for ${service}: ${error.trim()}`);
}

function reportStale(service: string, stale: readonly string[]): void {
  if (stale.length === 0) return;
  console.log(`${service}: ${stale.length} variable(s) the service no longer takes`);
  for (const key of stale) {
    const flag = /KEY|SECRET|TOKEN|PASSWORD|XPUB|SEED/.test(key) ? "  SENSITIVE" : "";
    console.log(`  ${key}${flag}`);
  }
  if (!prune) console.log("  rerun with --prune to delete them");
}

const failed: string[] = [];
const args = process.argv.slice(2);
const prune = args.includes("--prune");
const keepDatabaseUrl = args.includes("--keep-database-url");
const dryRun = args.includes("--dry-run");
const requestedService = args.find((arg) => !arg.startsWith("--"));
const selectedPolicies =
  requestedService === undefined
    ? policies
    : policies.filter((policy) => policy.name === requestedService);

if (selectedPolicies.length === 0) {
  throw new Error(`Unknown Railway service: ${requestedService}`);
}

for (const policy of selectedPolicies) {
  const source = await Bun.file(policy.configPath).text();
  const unreviewed = unreviewedKeys(configuredKeys(source), policy.secrets);
  if (unreviewed.length > 0) {
    throw new Error(
      `${policy.name}: config reads credential(s) with no reviewed decision: ${unreviewed.join(", ")}. ` +
        "Add each to `secrets.allowed` or `secrets.withheld` in scripts/sync-railway-env.ts.",
    );
  }
  const local = Object.fromEntries(
    configuredKeys(source)
      .filter(
        (key) =>
          !DERIVED_KEYS.has(key) && !policy.secrets.withheld.has(key) && !(key in policy.overrides),
      )
      .map((key) => [key, process.env[key]])
      .filter((entry): entry is [string, string] => entry[1] !== undefined && entry[1] !== ""),
  );
  const variables: Record<string, string> = { ...policy.overrides, ...local };
  // Once a service connects as its own database role, the shared reference
  // would overwrite that role's connection string with the owner's.
  if (keepDatabaseUrl) delete variables.DATABASE_URL;
  // Stale means the config no longer reads it. A key the config reads but the local
  // `.env` leaves unset is live on Railway and must not be reported, let alone pruned.
  const known = new Set([...configuredKeys(source), ...Object.keys(policy.overrides)]);
  const remote = await remoteKeys(policy.name);
  const forbidden = unexpectedRemoteSecrets(remote, policy.secrets);
  // A credential the policy does not allow is removed with the stale ones, and
  // fails the run when it is left in place.
  const stale = [...new Set([...remote.filter((key) => !known.has(key)), ...forbidden])].sort();
  if (!prune) for (const key of forbidden) failed.push(`  ${policy.name}: ${key}`);

  if (dryRun) {
    console.log(`\n${policy.name}: ${Object.keys(variables).length} key(s) would be set`);
    for (const [key, value] of Object.entries(variables).sort(([a], [b]) => a.localeCompare(b))) {
      const source = key in policy.overrides ? "override" : "local";
      console.log(`  ${key.padEnd(34)} ${source.padEnd(8)} ${preview(key, value)}`);
    }
    reportStale(policy.name, stale);
    continue;
  }

  await inBatches(Object.entries(variables), 8, ([key, value]) =>
    setVariable(policy.name, key, value),
  );

  console.log(`[railway:env] ${policy.name}: synchronized ${Object.keys(variables).length} keys`);
  reportStale(policy.name, stale);
  if (prune) {
    await inBatches(stale, 8, (key) => deleteVariable(policy.name, key));
    console.log(`[railway:env] ${policy.name}: deleted ${stale.length} stale key(s)`);
  }
}

if (failed.length > 0) {
  console.error(
    `[railway:env] credentials on a service that its policy does not allow:\n${failed.join("\n")}`,
  );
  process.exit(1);
}
