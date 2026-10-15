/**
 * Deploy the Railway services of a target, in dependency order.
 *
 *   bun run railway:deploy                 show the plan, change nothing
 *   bun run railway:deploy --yes           migrate, then deploy every service
 *   bun run railway:deploy --yes core-api  one service (still migrates first)
 *   bun run railway:deploy --yes --skip-migrate
 *
 * `railway up` uploads the working tree, not a git ref, so what ships is
 * whatever is on this machine. The guards below exist for that: a dirty tree or
 * a branch that is not `main` at `origin/main` is refused, because the deploy
 * would otherwise contain code nobody reviewed.
 *
 * Configuration (`bun run railway:env`) is a separate, deliberate step and is
 * not run here: it overwrites variables from the local `.env`.
 */

const TESTNET = {
  name: "mayarin-testnet",
  project: "70236ce0-42f9-458e-bed1-b02ec10e5b7c",
  environment: "production",
} as const;

/** Dependency order: the APIs before the worker that calls into the same schema. */
const SERVICES = ["core-api", "dashboard-api", "chain-worker"] as const;
type Service = (typeof SERVICES)[number];

const HEALTH: Readonly<Partial<Record<Service, string>>> = {
  "core-api": "https://api-testnet.mayarin.xyz/health",
  "dashboard-api": "https://api-merchant-testnet.mayarin.xyz/health",
};

async function run(command: string[], options: { capture?: boolean } = {}): Promise<string> {
  const child = Bun.spawn(command, {
    stdout: options.capture === true ? "pipe" : "inherit",
    stderr: options.capture === true ? "pipe" : "inherit",
    stdin: "inherit",
  });
  const [output, exitCode] = await Promise.all([
    options.capture === true ? new Response(child.stdout).text() : Promise.resolve(""),
    child.exited,
  ]);
  if (exitCode !== 0) throw new Error(`${command.slice(0, 3).join(" ")} exited ${exitCode}`);
  return output.trim();
}

async function assertShippable(): Promise<string> {
  const branch = await run(["git", "rev-parse", "--abbrev-ref", "HEAD"], { capture: true });
  if (branch !== "main") throw new Error(`Deploy from main, not ${branch}`);

  await run(["git", "fetch", "--quiet", "origin", "main"]);
  const [head, remote, dirty] = await Promise.all([
    run(["git", "rev-parse", "HEAD"], { capture: true }),
    run(["git", "rev-parse", "origin/main"], { capture: true }),
    run(["git", "status", "--porcelain"], { capture: true }),
  ]);
  if (head !== remote) throw new Error("Local main is not at origin/main; pull or push first");
  if (dirty !== "") throw new Error("The working tree has uncommitted changes");
  return head.slice(0, 7);
}

async function assertTarget(): Promise<void> {
  const raw = await run(
    [
      "railway",
      "status",
      "--project",
      TESTNET.project,
      "--environment",
      TESTNET.environment,
      "--json",
    ],
    { capture: true },
  );
  const name = (JSON.parse(raw) as { name?: string }).name;
  if (name !== TESTNET.name) throw new Error(`Expected ${TESTNET.name}, Railway says ${name}`);
}

async function healthy(url: string): Promise<boolean> {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(5_000) });
      if (response.ok) return true;
    } catch {
      // Not up yet; the next attempt decides.
    }
    await new Promise((resolve) => setTimeout(resolve, 5_000));
  }
  return false;
}

const args = process.argv.slice(2);
const apply = args.includes("--yes");
const skipMigrate = args.includes("--skip-migrate");
const requested = args.find((arg) => !arg.startsWith("--"));
const services = SERVICES.filter((service) => requested === undefined || service === requested);
if (services.length === 0) throw new Error(`Unknown service: ${requested}`);

const commit = await assertShippable();
await assertTarget();

console.log(`target:   ${TESTNET.name} (${TESTNET.environment})`);
console.log(`commit:   ${commit}`);
console.log(`migrate:  ${skipMigrate ? "skipped" : "bun run db:migrate:railway"}`);
console.log(`deploy:   ${services.join(" -> ")}`);
if (!apply) {
  console.log("\ndry run: nothing changed. Rerun with --yes.");
  process.exit(0);
}

if (!skipMigrate) {
  console.log("\n[migrate]");
  await run(["bun", "run", "db:migrate:railway"]);
}

for (const service of services) {
  console.log(`\n[deploy] ${service}`);
  await run([
    "railway",
    "up",
    "--project",
    TESTNET.project,
    "--environment",
    TESTNET.environment,
    "--service",
    service,
    "--ci",
  ]);

  const url = HEALTH[service];
  if (url !== undefined && !(await healthy(url))) {
    throw new Error(`${service} did not report healthy at ${url}; later services not deployed`);
  }
}

console.log(`\ndeployed ${commit}: ${services.join(", ")}`);
console.log("Next: bun run deploy:dashboard:testnet, then check chain-worker logs.");
