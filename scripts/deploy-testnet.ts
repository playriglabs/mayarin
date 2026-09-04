/**
 * The testnet deployment, as one explicit command (#151).
 *
 * This is the wrapper `docs/deployment.md` allows: it packages the documented
 * manual sequence and preserves every gate in it. It does not run on push, it
 * does not infer a target, and it refuses to continue when the Railway project
 * ID resolves to anything but the registered testnet project.
 *
 * Order, from the doc:
 *
 *   1. Local gate — `bun run check`, then build the checkout UI the API image
 *      must carry (`apps/checkout-ui`).
 *   2. Target validation — the project ID must name `mayarin-testnet`.
 *   3. Database migration — only with `--migrate`, through the checked-in
 *      Railway proxy helper.
 *   4. Railway services, in dependency order: core-api, dashboard-api,
 *      chain-worker.
 *   5. Cloudflare surfaces: the dashboard (after its API answers healthy),
 *      then the demo. The landing page is not deployed from here — it will use
 *      Cloudflare's git integration when it ships.
 *   6. Smoke checks, including the checkout UI bundle the new image serves.
 *
 * Usage:
 *
 *   bun run deploy:testnet                       # everything except migration
 *   bun run deploy:testnet --migrate             # also migrate the database
 *   bun run deploy:testnet --only dashboard,demo # a subset of surfaces
 *   bun run deploy:testnet --skip-gate           # after a just-green local run
 */

const TESTNET_PROJECT_ID = "70236ce0-42f9-458e-bed1-b02ec10e5b7c";
const TESTNET_PROJECT_NAME = "mayarin-testnet";
const ENVIRONMENT = "production";

const CORE_API_URL = "https://api-testnet.mayarin.xyz";
const DASHBOARD_API_URL = "https://api-merchant-testnet.mayarin.xyz";
const DASHBOARD_URL = "https://dashboard-testnet.mayarin.xyz";
const PAY_URL = "https://pay-testnet.mayarin.xyz";

const SURFACES = ["services", "dashboard", "pay", "demo"] as const;
type Surface = (typeof SURFACES)[number];

interface Flags {
  readonly only: readonly Surface[];
  readonly migrate: boolean;
  readonly skipGate: boolean;
}

const parseFlags = (argv: readonly string[]): Flags => {
  let only: readonly Surface[] = SURFACES;
  let migrate = false;
  let skipGate = false;

  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--migrate") {
      migrate = true;
    } else if (flag === "--skip-gate") {
      skipGate = true;
    } else if (flag === "--only") {
      const value = argv[index + 1] ?? "";
      index += 1;
      const requested = value.split(",").filter((entry) => entry.length > 0);
      for (const entry of requested) {
        if (!(SURFACES as readonly string[]).includes(entry)) {
          throw new Error(`--only accepts ${SURFACES.join(", ")}; received "${entry}"`);
        }
      }
      only = requested as Surface[];
    } else {
      throw new Error(`Unknown flag "${flag}". See the header of scripts/deploy-testnet.ts`);
    }
  }

  return { only, migrate, skipGate };
};

/**
 * The Node the gate needs, before the gate fails for a reason nobody reads.
 *
 * Astro 7 refuses to run below 22.12, and only the three Astro apps notice — so
 * `bun run check` fails with three `astro check` errors about an engine while
 * every package that matters has already passed. Naming it here turns ten
 * minutes of reading turbo output into one line.
 */
const requireNodeVersion = async (): Promise<void> => {
  const required = Number.parseInt((await Bun.file(".nvmrc").text()).trim(), 10);

  // The *system* node, not `process.versions.node` — Bun reports the Node API
  // version it emulates, which is not what runs `astro check`. Astro's binary
  // carries a `#!/usr/bin/env node` shebang, so the version that matters is
  // whatever `node` resolves to on the PATH.
  const probe = Bun.spawn(["node", "--version"], { stdout: "pipe", stderr: "pipe" });
  const found = (await new Response(probe.stdout).text()).trim().replace(/^v/, "");
  if ((await probe.exited) !== 0 || found === "") return;

  const [major = 0, minor = 0] = found.split(".").map(Number);
  if (major > required || (major === required && minor >= 12)) return;

  throw new Error(
    `Node ${found} is on the PATH, and Astro needs ${required}.12 or newer.\n` +
      "The gate would fail in apps/blog, apps/dashboard and apps/docs with an engine\n" +
      "message rather than anything about the code. Run `nvm use` and try again.",
  );
};

/** Runs a command with inherited stdio, and stops the deployment on failure. */
const run = async (label: string, command: readonly string[]): Promise<void> => {
  console.log(`\n▶ ${label}`);
  const child = Bun.spawn([...command], { stdout: "inherit", stderr: "inherit" });
  const exitCode = await child.exited;
  if (exitCode !== 0) {
    throw new Error(`${label} failed (exit ${exitCode}). The deployment stops here.`);
  }
};

/**
 * The target gate. Every Railway command below passes the project ID
 * explicitly, and this check makes sure the ID still names the registered
 * testnet project — never the locally linked one, never mainnet.
 */
const validateTarget = async (): Promise<void> => {
  console.log("\n▶ Validate the Railway target");
  const child = Bun.spawn(
    ["railway", "status", "--project", TESTNET_PROJECT_ID, "--environment", ENVIRONMENT, "--json"],
    { stdout: "pipe", stderr: "inherit" },
  );
  const output = await new Response(child.stdout).text();
  if ((await child.exited) !== 0) {
    throw new Error("railway status failed. Run `railway login` and retry.");
  }
  const parsed: unknown = JSON.parse(output);
  const name =
    typeof parsed === "object" && parsed !== null && "name" in parsed
      ? (parsed as { name: unknown }).name
      : undefined;
  if (name !== TESTNET_PROJECT_NAME) {
    throw new Error(
      `Project ${TESTNET_PROJECT_ID} resolved to "${String(name)}", ` +
        `expected "${TESTNET_PROJECT_NAME}". The registry in docs/deployment.md is the authority.`,
    );
  }
  console.log(`  ${TESTNET_PROJECT_NAME} confirmed.`);
};

const railwayUp = async (service: string): Promise<void> => {
  await run(`Deploy ${service} to Railway`, [
    "railway",
    "up",
    "--project",
    TESTNET_PROJECT_ID,
    "--environment",
    ENVIRONMENT,
    "--service",
    service,
    "--ci",
  ]);
};

/** Polls a URL until it answers 2xx, for at most `timeoutMs`. */
const waitForOk = async (label: string, url: string, timeoutMs: number): Promise<void> => {
  console.log(`\n▶ Wait for ${label} (${url})`);
  const deadline = Date.now() + timeoutMs;
  let lastError = "no response yet";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(5_000) });
      if (response.ok) {
        console.log(`  ${label} answers ${response.status}.`);
        return;
      }
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await Bun.sleep(5_000);
  }
  throw new Error(`${label} did not answer healthy within ${timeoutMs / 1000}s: ${lastError}`);
};

const smoke = async (): Promise<void> => {
  await waitForOk("core API health", `${CORE_API_URL}/health`, 120_000);
  await waitForOk("dashboard API health", `${DASHBOARD_API_URL}/health`, 120_000);
  await waitForOk("dashboard login page", `${DASHBOARD_URL}/login`, 60_000);
  // The checkout routes are mounted and answering. The SPA bundle itself is
  // proven by the Dockerfile build + the local gate, not by a runtime file:
  // `apps/checkout-ui` ships no favicon in its dist (the page loads favicons
  // from `mayarin.xyz`), so `/checkout/qr` — stable, no DB, 200 SVG — is the
  // liveness probe instead of a dist asset.
  await waitForOk("core API checkout route", `${CORE_API_URL}/checkout/qr?value=smoke`, 60_000);
  // The pay host (RFC #163): same probe through the proxy proves the Worker
  // route is bound, the allowlist forwards `/checkout/*`, and core-api is
  // reached.
  await waitForOk("pay proxy liveness", `${PAY_URL}/checkout/qr?value=smoke`, 60_000);
};

const flags = parseFlags(process.argv.slice(2));
const wants = (surface: Surface): boolean => flags.only.includes(surface);

console.log(`Deploying to ${TESTNET_PROJECT_NAME}: ${flags.only.join(", ")}`);

if (flags.skipGate) {
  console.log("\n▶ Local gate skipped (--skip-gate)");
} else {
  await requireNodeVersion();
  await run("Local gate: format, typecheck, tests", ["bun", "run", "check"]);
  await run("Local gate: build the checkout UI", [
    "bun",
    "run",
    "--cwd",
    "apps/checkout-ui",
    "build",
  ]);
}

await validateTarget();

if (flags.migrate) {
  await run("Migrate the testnet database", ["bun", "run", "db:migrate:railway"]);
} else {
  console.log("\n▶ Migration skipped. Pass --migrate when the schema changed.");
}

if (wants("services")) {
  await railwayUp("core-api");
  await railwayUp("dashboard-api");
  await railwayUp("chain-worker");
}

if (wants("dashboard")) {
  // The doc's ordering rule: the Pages dashboard deploys only after the API it
  // proxies answers healthy on its custom domain.
  await waitForOk("dashboard API health", `${DASHBOARD_API_URL}/health`, 180_000);
  await run("Deploy the dashboard to Cloudflare Pages", ["bun", "run", "deploy:dashboard:testnet"]);
}

if (wants("demo")) {
  await run("Deploy the demo to Cloudflare Pages", ["bun", "run", "--cwd", "apps/demo", "deploy"]);
}

if (wants("pay")) {
  // The pay proxy forwards to core-api, so it deploys only after the API it
  // fronts answers healthy on its custom domain (RFC #163).
  await waitForOk("core API health", `${CORE_API_URL}/health`, 180_000);
  await run("Deploy the pay proxy to Cloudflare", [
    "bun",
    "run",
    "--cwd",
    "apps/pay-proxy",
    "deploy:testnet",
  ]);
}

await smoke();
console.log("\nDeployment finished. Review the worker logs per docs/deployment.md step 7.");
