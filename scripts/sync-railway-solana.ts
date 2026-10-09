/**
 * Bring the Railway testnet up to the Solana devnet chain, without printing a
 * single value.
 *
 *   bun run scripts/sync-railway-solana.ts env              report env changes
 *   bun run scripts/sync-railway-solana.ts env --apply      set them (no deploy)
 *   bun run scripts/sync-railway-solana.ts market           report market_config changes
 *   bun run scripts/sync-railway-solana.ts market --apply   write them
 *
 * Run `env` before the deploy and `market` after it: the core-api running now
 * predates Solana and would reject a stablecoins row with base58 mints.
 *
 * Unlike `sync-railway-env.ts`, this does not copy the whole local `.env`. It
 * touches only what the Solana chain needs:
 *
 *   - JSON maps keyed by chain: the deployed map keeps every chain it has, and
 *     only the local `solana-devnet` entry is added or replaced.
 *   - JSON lists: local `solana-devnet` / `orca` items are appended.
 *   - SOLANA_* keys: copied from the local `.env` as they are.
 *   - FX_ENDPOINT: removed when it points at fxratesapi, whose anonymous tier
 *     429s, so the adapter falls back to its Coinbase default.
 *   - market_config `stablecoins`: the local row (which lists the Solana mints)
 *     is written through `PUT /v1/admin/market-config/stablecoins`, using the
 *     deployed ADMIN_TOKEN read from Railway.
 *
 * Variables are set with --skip-deploys; `bun run deploy:testnet` deploys them.
 */

const PROJECT_ID = "70236ce0-42f9-458e-bed1-b02ec10e5b7c";
const ENVIRONMENT = "production";
const CORE_API_URL = "https://api-testnet.mayarin.xyz";
const CHAIN = "solana-devnet";

/** Chain-keyed JSON maps, per service that reads them. */
const MAP_KEYS: Readonly<Record<string, readonly string[]>> = {
  "core-api": [
    "CHAIN_RPC_URLS",
    "CHAIN_ASSETS",
    "CHAIN_NATIVE_ASSETS",
    "CHAIN_CONFIRMATIONS",
    "CHAIN_START_BLOCKS",
    "PAYMENT_ROUTERS",
    "SOLANA_DEPLOYMENT_DOMAINS",
    "SOLANA_FEE_RECIPIENTS",
    "SOLANA_ORCA_POOLS",
    "SOLANA_ORCA_LOOKUP_TABLES",
  ],
  "chain-worker": [
    "CHAIN_RPC_URLS",
    "CHAIN_ASSETS",
    "CHAIN_NATIVE_ASSETS",
    "CHAIN_CONFIRMATIONS",
    "CHAIN_START_BLOCKS",
    "PAYMENT_ROUTERS",
    "SOLANA_DEPLOYMENT_DOMAINS",
    "SOLANA_FEE_RECIPIENTS",
    "SOLANA_ORCA_POOLS",
    "SOLANA_ORCA_LOOKUP_TABLES",
  ],
  "dashboard-api": ["CHAIN_RPC_URLS", "CHAIN_ASSETS", "CHAIN_NATIVE_ASSETS"],
};

/** JSON string lists: local items that mention Solana or Orca are appended. */
const LIST_KEYS: Readonly<Record<string, readonly string[]>> = {
  "core-api": ["QUOTE_VENUES", "QUOTE_UNGUARDED_TESTNET_PAIRS"],
  "chain-worker": ["QUOTE_VENUES", "QUOTE_UNGUARDED_TESTNET_PAIRS"],
  "dashboard-api": [],
};

/** Plain values copied as they are. */
const PLAIN_KEYS: Readonly<Record<string, readonly string[]>> = {
  "core-api": ["SOLANA_ORDER_SIGNER_SECRET_KEY", "SOLANA_DEPOSIT_SEED"],
  "chain-worker": ["SOLANA_ORDER_SIGNER_SECRET_KEY", "SOLANA_DEPOSIT_SEED"],
  "dashboard-api": [],
};

const apply = process.argv.includes("--apply");
const phase = process.argv[2];
if (phase !== "env" && phase !== "market") {
  throw new Error('Pass a phase: "env" (before the deploy) or "market" (after it)');
}

async function railway(args: readonly string[], stdin?: string): Promise<string> {
  const child = Bun.spawn(
    ["railway", ...args, "--project", PROJECT_ID, "--environment", ENVIRONMENT],
    {
      stdin: stdin === undefined ? "ignore" : new Response(stdin),
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  const [out, err] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  if ((await child.exited) !== 0) {
    throw new Error(`railway ${args.slice(0, 3).join(" ")} failed: ${err.trim()}`);
  }
  return out;
}

async function remoteVariables(service: string): Promise<Record<string, string>> {
  return JSON.parse(await railway(["variable", "list", "--service", service, "--json"]));
}

function localValue(key: string): string {
  const value = process.env[key];
  if (value === undefined || value === "") throw new Error(`${key} is missing from the local .env`);
  return value;
}

function mergedMap(key: string, remote: string | undefined): string {
  const local = JSON.parse(localValue(key)) as Record<string, unknown>;
  if (!(CHAIN in local)) throw new Error(`Local ${key} has no "${CHAIN}" entry`);
  const deployed = remote === undefined || remote === "" ? {} : JSON.parse(remote);
  return JSON.stringify({ ...deployed, [CHAIN]: local[CHAIN] });
}

function mergedList(key: string, remote: string | undefined): string {
  const local = JSON.parse(localValue(key)) as string[];
  const deployed: string[] = remote === undefined || remote === "" ? [] : JSON.parse(remote);
  const added = local.filter((item) => /solana|orca/.test(item) && !deployed.includes(item));
  return JSON.stringify([...deployed, ...added]);
}

/** Order-insensitive for objects, so a reordered map does not count as a change. */
function sameJson(a: string | undefined, b: string): boolean {
  if (a === undefined) return false;
  const canonical = (value: unknown): unknown =>
    Array.isArray(value)
      ? value.map(canonical)
      : value !== null && typeof value === "object"
        ? Object.fromEntries(
            Object.entries(value)
              .sort(([x], [y]) => x.localeCompare(y))
              .map(([k, v]) => [k, canonical(v)]),
          )
        : value;
  try {
    return JSON.stringify(canonical(JSON.parse(a))) === JSON.stringify(canonical(JSON.parse(b)));
  } catch {
    return a === b;
  }
}

console.log(
  apply
    ? "Applying changes to mayarin-testnet."
    : "Dry run: nothing is changed. Pass --apply to change it.",
);

for (const service of phase === "env" ? Object.keys(MAP_KEYS) : []) {
  const remote = await remoteVariables(service);

  const wanted: [string, string][] = [
    ...(MAP_KEYS[service] ?? []).map((key): [string, string] => [key, mergedMap(key, remote[key])]),
    ...(LIST_KEYS[service] ?? []).map((key): [string, string] => [
      key,
      mergedList(key, remote[key]),
    ]),
    ...(PLAIN_KEYS[service] ?? []).map((key): [string, string] => [key, localValue(key)]),
  ];

  console.log(`\n${service}`);
  for (const [key, value] of wanted) {
    const state =
      remote[key] === undefined ? "add" : sameJson(remote[key], value) ? "same" : "update";
    console.log(`  ${state.padEnd(7)} ${key}`);
    if (apply && state !== "same") {
      await railway(
        ["variable", "set", key, "--stdin", "--service", service, "--skip-deploys", "--json"],
        value,
      );
    }
  }

  if (remote.FX_ENDPOINT?.includes("fxratesapi")) {
    console.log("  delete  FX_ENDPOINT (fxratesapi; falls back to Coinbase)");
    if (apply) await railway(["variable", "delete", "FX_ENDPOINT", "--service", service, "--json"]);
  }
}

async function syncMarketConfig(): Promise<void> {
  console.log("\nmarket_config");
  const adminToken = (await remoteVariables("core-api")).ADMIN_TOKEN;
  if (adminToken === undefined)
    throw new Error("core-api has no ADMIN_TOKEN, so market_config cannot be written");

  const localRow = Bun.spawnSync([
    "docker",
    "exec",
    "mayarin-postgres",
    "psql",
    "-U",
    "mayarin",
    "-d",
    "mayarin",
    "-At",
    "-c",
    "select value from market_config where key = 'stablecoins'",
  ]);
  const localStablecoins = localRow.stdout.toString().trim();
  if (localRow.exitCode !== 0 || localStablecoins === "" || !localStablecoins.includes(CHAIN)) {
    throw new Error("The local market_config stablecoins row is missing or has no Solana entry");
  }

  const headers = { authorization: `Bearer ${adminToken}`, "content-type": "application/json" };
  const deployedConfig = (await (
    await fetch(`${CORE_API_URL}/v1/admin/market-config`, { headers })
  ).json()) as {
    entries: { key: string; value: unknown }[];
  };
  const deployedStablecoins = deployedConfig.entries.find(
    (entry) => entry.key === "stablecoins",
  )?.value;

  if (
    deployedStablecoins !== undefined &&
    sameJson(JSON.stringify(deployedStablecoins), localStablecoins)
  ) {
    console.log("  same    stablecoins");
  } else {
    console.log(`  ${deployedStablecoins === undefined ? "add" : "update"}  stablecoins`);
    if (apply) {
      const response = await fetch(`${CORE_API_URL}/v1/admin/market-config/stablecoins`, {
        method: "PUT",
        headers,
        body: JSON.stringify({ value: JSON.parse(localStablecoins) }),
      });
      if (!response.ok)
        throw new Error(`PUT stablecoins answered ${response.status}: ${await response.text()}`);
    }
  }
}

if (phase === "market") await syncMarketConfig();

if (apply && phase === "env")
  console.log("\nDone. Next: bun run deploy:testnet --migrate --only services");

// A module, so top-level `await` is allowed.
export {};
