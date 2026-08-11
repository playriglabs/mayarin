/** Synchronize local deployment configuration to Railway without printing values. */

const DERIVED_KEYS = new Set(["DATABASE_URL", "PUBLIC_BASE_URL"]);

interface ServicePolicy {
  readonly name: "core-api" | "dashboard-api" | "chain-worker";
  readonly configPath: string;
  readonly excludedKeys?: ReadonlySet<string>;
  readonly overrides: Readonly<Record<string, string>>;
}

const policies: readonly ServicePolicy[] = [
  {
    name: "core-api",
    configPath: "apps/api/src/config.ts",
    excludedKeys: new Set(["OPERATOR_PRIVATE_KEY"]),
    overrides: {
      DATABASE_URL: "$" + "{{Postgres.DATABASE_URL}}",
      LEFTHOOK: "0",
      NODE_ENV: "production",
      PORT: "3000",
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

const requestedService = process.argv[2];
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

  await inBatches(Object.entries(variables), 8, ([key, value]) =>
    setVariable(policy.name, key, value),
  );

  console.log(`[railway:env] ${policy.name}: synchronized ${Object.keys(variables).length} keys`);
}
