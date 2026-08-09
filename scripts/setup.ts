/**
 * `bun run setup` — take a clone to a running `bun run dev:all`.
 *
 * Written because the failure it prevents is not a missing step but a *drifted*
 * one: two developers whose repositories agree and whose environments do not.
 * `.env` is gitignored, so every key added on one machine is a key silently
 * absent on the other, and the symptom arrives much later as a boot error in an
 * app nobody changed.
 *
 * So this does two different jobs. On a fresh clone it is a bootstrap: install,
 * write a `.env`, start Postgres, migrate, verify each app's config parses. On a
 * repository that already works it is a **drift check** — it compares the keys
 * in `.env` against `.env.example` and names the ones that are missing, which is
 * the state that actually breaks a teammate.
 *
 * ```
 * bun run setup                  # bootstrap or re-check
 * bun run setup -- --seed        # also create the first merchant account
 * bun run setup -- --reset-db    # drop the volume and migrate from empty
 * bun run setup -- --check       # report only, change nothing
 * ```
 *
 * `.env.example` is the contract between developers and this script enforces it:
 * a key that exists in one working `.env` and not in `.env.example` is invisible
 * to everyone else, and is reported as loudly as a missing one. Adding a config
 * key means adding it there, with a placeholder value, in the same commit.
 *
 * Secrets are never copied or generated. `.env.example` is committed, so it
 * carries no RPC key and no private key; a developer who needs the chain or
 * quote layer supplies those and turns the layer on themselves. The default it
 * writes runs the API, the dashboard API and the dashboard against Postgres with
 * no external credential at all, which is what a backend change usually needs.
 */

import { existsSync } from "node:fs";
import { $ } from "bun";
import postgres from "postgres";

const ROOT = new URL("..", import.meta.url).pathname;
const ENV_PATH = `${ROOT}.env`;
const EXAMPLE_PATH = `${ROOT}.env.example`;

const seed = process.argv.includes("--seed");
const resetDb = process.argv.includes("--reset-db");
const checkOnly = process.argv.includes("--check");

/** Collected and printed together at the end — one list beats eight scrollbacks. */
const warnings: string[] = [];

function step(n: number, title: string): void {
  console.log(`\n${n}. ${title}`);
}

function ok(message: string): void {
  console.log(`   ✓ ${message}`);
}

function warn(message: string): void {
  console.log(`   ! ${message}`);
  warnings.push(message);
}

function fail(message: string): never {
  console.error(`\n✗ ${message}\n`);
  process.exit(1);
}

/**
 * Keys a dotenv file declares, split by whether the declaration is live.
 *
 * A key with an empty value is still live: `.env.example` documents a name by
 * listing it, and `loadConfig` collapses `""` to unset anyway. A *commented*
 * declaration — `# MULTISIG=0x...` — is a third thing, and the distinction
 * carries the whole check. `.env.example` uses it for the forge-only deploy
 * variables, which no API boot reads and most developers never set. Counting
 * those as missing would report eleven of them on a healthy repository, and a
 * check that cries wolf every run is one nobody reads.
 */
function envKeys(text: string): { live: string[]; commented: string[] } {
  const live: string[] = [];
  const commented: string[] = [];
  for (const line of text.split("\n")) {
    const liveMatch = line.match(/^([A-Z][A-Z0-9_]*)=/);
    if (liveMatch?.[1] !== undefined) {
      live.push(liveMatch[1]);
      continue;
    }
    const commentedMatch = line.match(/^#\s*([A-Z][A-Z0-9_]*)=/);
    if (commentedMatch?.[1] !== undefined) commented.push(commentedMatch[1]);
  }
  return { live, commented };
}

/** `KEY=value` pairs, with a trailing `# comment` stripped. */
function parseEnv(text: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const match = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);
    if (match?.[1] === undefined || match[2] === undefined) continue;
    env[match[1]] = match[2].split(" #")[0]?.trim() ?? "";
  }
  return env;
}

// ---------------------------------------------------------------------------
// 1. Prerequisites
// ---------------------------------------------------------------------------

step(1, "Prerequisites");

const dockerVersion = await $`docker --version`.quiet().nothrow();
if (dockerVersion.exitCode !== 0) {
  fail("Docker is not on PATH. Postgres runs in Docker — install Docker Desktop and retry.");
}
ok(dockerVersion.stdout.toString().trim());

const dockerRunning = await $`docker info`.quiet().nothrow();
if (dockerRunning.exitCode !== 0) {
  fail("Docker is installed but not running. Start Docker Desktop and retry.");
}
ok(`bun ${Bun.version}`);

// Foundry is only needed to deploy or test the contracts, so its absence is a
// note rather than a stop: nothing in `dev:all` compiles Solidity.
const forge = await $`forge --version`.quiet().nothrow();
if (forge.exitCode === 0) {
  ok(forge.stdout.toString().trim().split("\n")[0] ?? "forge");
} else {
  console.log("   – forge not found; only `bun run test:contracts` needs it");
}

// ---------------------------------------------------------------------------
// 2. Workspace dependencies
// ---------------------------------------------------------------------------

step(2, "Dependencies");

if (checkOnly) {
  console.log("   – skipped (--check)");
} else {
  // Always, not only on a missing node_modules: a workspace package added since
  // the last install resolves to nothing until `bun install` links it, and the
  // error that surfaces is a "cannot find module @mayarin/…" in an unrelated
  // package.
  const install = await $`bun install`.cwd(ROOT).quiet().nothrow();
  if (install.exitCode !== 0) {
    fail(`bun install failed:\n${install.stderr.toString()}`);
  }
  ok("bun install (workspace links + git hooks)");
}

// ---------------------------------------------------------------------------
// 3. Environment
// ---------------------------------------------------------------------------

step(3, "Environment");

if (!existsSync(EXAMPLE_PATH)) {
  fail(".env.example is missing — it is the contract this script checks against.");
}
const exampleText = await Bun.file(EXAMPLE_PATH).text();

if (!existsSync(ENV_PATH)) {
  if (checkOnly) {
    fail(".env does not exist. Run without --check to create it from .env.example.");
  }
  await Bun.write(ENV_PATH, exampleText);
  ok(".env created from .env.example");
  console.log(
    "     Defaults run the API, dashboard API and dashboard against Postgres.\n" +
      "     The chain, quote and contract layers are off and need credentials\n" +
      "     that are deliberately not in a committed file — see .env.example.",
  );
} else {
  const mine = envKeys(await Bun.file(ENV_PATH).text());
  const theirs = envKeys(exampleText);

  // Missing: live in the contract and absent here — the app will read a default
  // it was never told about, or fail. Extra: set here and unknown to the
  // contract in either form, which is the drift that breaks a teammate.
  const missing = theirs.live.filter((key) => !mine.live.includes(key));
  const extra = mine.live.filter(
    (key) => !theirs.live.includes(key) && !theirs.commented.includes(key),
  );

  if (missing.length === 0 && extra.length === 0) {
    ok(`.env declares all ${theirs.live.length} keys .env.example does`);
  }
  if (missing.length > 0) {
    warn(`.env is missing ${missing.length} key(s) that .env.example declares:`);
    for (const key of missing) console.log(`       ${key}`);
    console.log("     Copy them across from .env.example; most have a working default.");
  }
  if (extra.length > 0) {
    // The drift that breaks a *teammate* rather than you: a key that works here
    // and does not exist in the file everyone else copies from.
    warn(`.env declares ${extra.length} key(s) .env.example does not:`);
    for (const key of extra) console.log(`       ${key}`);
    console.log("     Add them to .env.example with a placeholder so others get them.");
  }
}

const env = parseEnv(await Bun.file(ENV_PATH).text());
const databaseUrl = env.DATABASE_URL;
if (databaseUrl === undefined || databaseUrl === "") {
  fail("DATABASE_URL is not set in .env — nothing below can run without it.");
}

// ---------------------------------------------------------------------------
// 4. Postgres
// ---------------------------------------------------------------------------

step(4, "Postgres");

if (checkOnly) {
  console.log("   – skipped (--check)");
} else {
  if (resetDb) {
    // Named explicitly rather than offered on drift: `down -v` destroys the
    // volume, and a developer who wanted a schema fix should get a migration.
    console.log("   Dropping the Postgres volume (--reset-db)…");
    await $`docker compose down -v`.cwd(ROOT).quiet().nothrow();
  }

  const up = await $`docker compose up -d postgres`.cwd(ROOT).quiet().nothrow();
  if (up.exitCode !== 0) {
    fail(`docker compose up failed:\n${up.stderr.toString()}`);
  }

  // The container reports "started" well before Postgres accepts connections,
  // and migrating into that gap fails in a way that reads like a bad password.
  //
  // Probed from the host over TCP, running a real query, rather than with
  // `docker compose exec pg_isready`. On `--reset-db` the entrypoint runs initdb
  // against a *temporary* server first, and that server listens on the unix
  // socket only — so a probe inside the container passes, the temporary server
  // then shuts down, and the migration lands in the gap with
  // `57P03 the database system is starting up`. A host TCP query cannot see the
  // temporary server at all, which is exactly the property wanted here.
  let ready = false;
  let lastError = "";
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      const probe = postgres(databaseUrl, { max: 1, connect_timeout: 2, onnotice: () => {} });
      try {
        await probe`select 1`;
        ready = true;
      } finally {
        await probe.end();
      }
      if (ready) break;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await Bun.sleep(1_000);
  }
  if (!ready) {
    fail(
      `Postgres did not become ready within 60s (${lastError}). Check \`docker compose logs postgres\`.`,
    );
  }
  ok("postgres accepting connections on 5433");
}

// ---------------------------------------------------------------------------
// 5. Migrations
// ---------------------------------------------------------------------------

step(5, "Migrations");

if (checkOnly) {
  console.log("   – skipped (--check)");
} else {
  // `bun run --cwd packages/db migrate` does not inherit the root `.env`, which
  // is the single most common way this step is run and fails. Passing
  // DATABASE_URL explicitly is why this script exists rather than a README list.
  const migrated = await $`bun run --cwd packages/db migrate`
    .cwd(ROOT)
    .env({ ...process.env, DATABASE_URL: databaseUrl })
    .quiet()
    .nothrow();
  if (migrated.exitCode !== 0) {
    fail(`Migrations failed:\n${migrated.stderr.toString()}`);
  }
  ok("schema up to date");
}

// ---------------------------------------------------------------------------
// 6. Config
// ---------------------------------------------------------------------------

step(6, "Config");

/**
 * Boots each app's config exactly as the app does.
 *
 * A key can be present and still wrong — a toggle on with its dependencies
 * blank fails `loadConfig` and nothing else. Catching it here turns a confusing
 * crash inside `turbo dev` into a named list before anything starts.
 */
async function checkConfig(name: string, modulePath: string): Promise<void> {
  const { loadConfig } = (await import(modulePath)) as {
    loadConfig: (env: Record<string, string | undefined>) => unknown;
  };
  try {
    loadConfig(env);
    ok(`${name} config parses`);
  } catch (error) {
    warn(`${name} config is invalid: ${error instanceof Error ? error.message : String(error)}`);
  }
}

await checkConfig("@mayarin/api", `${ROOT}apps/api/src/config.ts`);
await checkConfig("@mayarin/dashboard-api", `${ROOT}apps/dashboard-api/src/config.ts`);

// ---------------------------------------------------------------------------
// 7. First merchant
// ---------------------------------------------------------------------------

if (seed && !checkOnly) {
  step(7, "Merchant account");
  console.log("   Handing over to `seed:merchant` — answer its prompts.\n");
  // Inherits stdio: this one is interactive by design, and swallowing its
  // prompts would hang with no output.
  const seeded = Bun.spawnSync(["bun", "run", "seed:merchant"], {
    cwd: ROOT,
    stdio: ["inherit", "inherit", "inherit"],
  });
  if (seeded.exitCode !== 0) {
    warn("seed:merchant did not complete — rerun `bun run seed:merchant` on its own.");
  }
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log(`\n${"=".repeat(70)}`);
if (warnings.length === 0) {
  console.log("Ready. Start everything with:\n\n   bun run dev:all\n");
  console.log("   api           http://localhost:3000");
  console.log("   dashboard-api http://localhost:3001");
  console.log("   dashboard     http://localhost:4321");
  if (!seed) {
    console.log("\nNo merchant account yet — `bun run setup -- --seed` creates the first one.");
  }
} else {
  console.log(`${warnings.length} thing(s) need attention before \`bun run dev:all\`:\n`);
  for (const message of warnings) console.log(`   ! ${message}`);
  console.log("\nDetail is above, under the step that reported it.");
}
console.log("=".repeat(70));

process.exit(warnings.length === 0 ? 0 : 1);
