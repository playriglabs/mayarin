/**
 * Synchronize local deployment configuration to Railway without printing values.
 *
 *   bun run scripts/sync-railway-env.ts                  every service
 *   bun run scripts/sync-railway-env.ts core-api         one service
 *   bun run scripts/sync-railway-env.ts --dry-run        show, change nothing
 *
 * This overwrites the deployed environment with whatever is in the local `.env`,
 * one key at a time, and there is no undo. `--dry-run` exists because the
 * dangerous keys are the ones that look harmless: a development `false` for a
 * feature the deployment has switched on is a silent regression, not an error.
 */

const DERIVED_KEYS = new Set(["DATABASE_URL", "PUBLIC_BASE_URL"]);

interface ServicePolicy {
  readonly name: "core-api" | "dashboard-api" | "chain-worker";
  readonly configPath: string;
  readonly excludedKeys?: ReadonlySet<string>;
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
    overrides: {
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
    overrides: {
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

const args = process.argv.slice(2);
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
  const local = Object.fromEntries(
    configuredKeys(source)
      .filter(
        (key) =>
          !DERIVED_KEYS.has(key) && !policy.excludedKeys?.has(key) && !(key in policy.overrides),
      )
      .map((key) => [key, process.env[key]])
      .filter((entry): entry is [string, string] => entry[1] !== undefined && entry[1] !== ""),
  );
  const variables = { ...policy.overrides, ...local };

  if (dryRun) {
    console.log(`\n${policy.name}: ${Object.keys(variables).length} key(s) would be set`);
    for (const [key, value] of Object.entries(variables).sort(([a], [b]) => a.localeCompare(b))) {
      const source = key in policy.overrides ? "override" : "local";
      console.log(`  ${key.padEnd(34)} ${source.padEnd(8)} ${preview(key, value)}`);
    }
    continue;
  }

  await inBatches(Object.entries(variables), 8, ([key, value]) =>
    setVariable(policy.name, key, value),
  );

  console.log(`[railway:env] ${policy.name}: synchronized ${Object.keys(variables).length} keys`);
}
