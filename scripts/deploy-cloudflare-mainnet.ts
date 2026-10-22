/**
 * The mainnet Cloudflare surfaces, as one explicit command.
 *
 * Mainnet's backend runs on AWS (docs/deployment.md → "AWS Mainnet Host"); the two
 * browser-facing surfaces stay on Cloudflare:
 *
 *   dashboard  the Astro Worker at dashboard.mayarin.xyz, proxying api-merchant.mayarin.xyz
 *   pay        the buyer-path proxy at pay.mayarin.xyz, forwarding to api.mayarin.xyz
 *
 * It does not run on push and has no default target. It asks for the Mainnet Gate
 * phrase, waits for the API each surface fronts to answer, and refuses to publish a
 * config that still names a testnet host.
 *
 *   bun run deploy:cloudflare:mainnet                  both surfaces
 *   bun run deploy:cloudflare:mainnet --only pay       one of them
 *   bun run deploy:cloudflare:mainnet --dry-run        build and validate, publish nothing
 *
 * Needs `bunx wrangler login`. A custom domain needs the hostname to carry no
 * hand-managed DNS record (Cloudflare error 100117), and Wrangler's OAuth token has no
 * "Zone / DNS / Edit": see docs/deployment.md if the binding is refused.
 */

import { readFile, writeFile } from "node:fs/promises";

const CORE_API_URL = "https://api.mayarin.xyz";
const DASHBOARD_API_URL = "https://api-merchant.mayarin.xyz";
const DASHBOARD_URL = "https://dashboard.mayarin.xyz";
const PAY_URL = "https://pay.mayarin.xyz";

const DASHBOARD_WORKER = "mayarin-dashboard";
/** Its own namespace: a testnet session must never open a mainnet dashboard. */
const SESSION_KV_TITLE = "mayarin-dashboard-session";
const GATE_PHRASE = "deploy mayarin mainnet";

const SURFACES = ["dashboard", "pay"] as const;
type Surface = (typeof SURFACES)[number];

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const onlyIndex = args.indexOf("--only");
const only: readonly Surface[] =
  onlyIndex === -1
    ? SURFACES
    : (args[onlyIndex + 1] ?? "").split(",").map((entry) => {
        if (!(SURFACES as readonly string[]).includes(entry)) {
          throw new Error(`--only accepts ${SURFACES.join(", ")}; received "${entry}"`);
        }
        return entry as Surface;
      });

const run = async (label: string, command: readonly string[], cwd?: string): Promise<void> => {
  console.log(`\n▶ ${label}`);
  const child = Bun.spawn([...command], {
    stdout: "inherit",
    stderr: "inherit",
    ...(cwd === undefined ? {} : { cwd }),
  });
  const exitCode = await child.exited;
  if (exitCode !== 0) throw new Error(`${label} failed (exit ${exitCode}). Stopping here.`);
};

const capture = async (command: readonly string[], cwd: string): Promise<string> => {
  const child = Bun.spawn([...command], { stdout: "pipe", stderr: "inherit", cwd });
  const output = await new Response(child.stdout).text();
  if ((await child.exited) !== 0) throw new Error(`${command.join(" ")} failed`);
  return output;
};

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

/** A config that still names a testnet host must never be published as mainnet. */
const assertNoTestnet = (label: string, config: unknown): void => {
  const text = JSON.stringify(config);
  if (/testnet/i.test(text)) {
    throw new Error(`${label} still mentions "testnet"; refusing to publish it as mainnet.`);
  }
};

/** The session store's id, creating the namespace the first time. */
const sessionNamespaceId = async (): Promise<string> => {
  if (dryRun) return "0".repeat(32);
  const cwd = "apps/dashboard";
  const find = async (): Promise<string | undefined> => {
    const listed = JSON.parse(await capture(["bunx", "wrangler", "kv", "namespace", "list"], cwd));
    return (listed as { id: string; title: string }[]).find(
      (namespace) => namespace.title === SESSION_KV_TITLE,
    )?.id;
  };
  const existing = await find();
  if (existing !== undefined) return existing;
  await run(
    `Create the ${SESSION_KV_TITLE} KV namespace`,
    ["bunx", "wrangler", "kv", "namespace", "create", SESSION_KV_TITLE],
    cwd,
  );
  const created = await find();
  if (created === undefined) throw new Error(`${SESSION_KV_TITLE} was not created`);
  return created;
};

if (!dryRun) {
  const typed =
    args.find((arg) => arg.startsWith("--confirm="))?.slice("--confirm=".length) ??
    prompt(`Type "${GATE_PHRASE}" to deploy the mainnet Cloudflare surfaces:`);
  if (typed !== GATE_PHRASE)
    throw new Error("The Mainnet Gate phrase was not typed; nothing deployed.");
}

const wranglerDeploy = dryRun ? ["--dry-run"] : [];

if (only.includes("dashboard")) {
  await waitForOk("dashboard API health", `${DASHBOARD_API_URL}/health`, dryRun ? 15_000 : 180_000);
  await run("Build the dashboard", ["bun", "run", "--cwd", "apps/dashboard", "build"]);

  // The adapter writes dist/server/wrangler.json from the testnet wrangler.jsonc.
  // Everything that names a network is replaced here, in a copy, never in the file.
  const generated = "apps/dashboard/dist/server/wrangler.json";
  const base = JSON.parse(await readFile(generated, "utf8")) as Record<string, unknown> & {
    vars?: Record<string, string>;
    kv_namespaces?: { binding: string; id: string }[];
  };
  const kvId = await sessionNamespaceId();
  const config = {
    ...base,
    name: DASHBOARD_WORKER,
    topLevelName: DASHBOARD_WORKER,
    vars: { ...base.vars, API_URL: DASHBOARD_API_URL, NETWORK: "mainnet" },
    routes: [{ pattern: new URL(DASHBOARD_URL).hostname, custom_domain: true }],
    kv_namespaces: (base.kv_namespaces ?? []).map((namespace) =>
      namespace.binding === "SESSION" ? { ...namespace, id: kvId } : namespace,
    ),
  };
  assertNoTestnet("The dashboard config", {
    name: config.name,
    vars: config.vars,
    routes: config.routes,
  });
  const path = "apps/dashboard/dist/server/wrangler.mainnet.json";
  await writeFile(path, `${JSON.stringify(config, null, 2)}\n`);
  await run(
    "Deploy the dashboard Worker",
    ["bunx", "wrangler", "deploy", "-c", "dist/server/wrangler.mainnet.json", ...wranglerDeploy],
    "apps/dashboard",
  );
}

if (only.includes("pay")) {
  await waitForOk("core API health", `${CORE_API_URL}/health`, dryRun ? 15_000 : 180_000);
  const config = JSON.parse(
    (await readFile("apps/pay-proxy/wrangler.mainnet.jsonc", "utf8")).replace(/^\s*\/\/.*$/gm, ""),
  ) as unknown;
  assertNoTestnet("The pay proxy config", config);
  await run("Typecheck the pay proxy", ["bun", "run", "--cwd", "apps/pay-proxy", "typecheck"]);
  await run(
    "Deploy the pay proxy Worker",
    ["bunx", "wrangler", "deploy", "-c", "wrangler.mainnet.jsonc", ...wranglerDeploy],
    "apps/pay-proxy",
  );
}

if (dryRun) {
  console.log("\nDry run: configs built and validated, nothing published.");
} else {
  if (only.includes("dashboard"))
    await waitForOk("dashboard login page", `${DASHBOARD_URL}/login`, 120_000);
  if (only.includes("pay")) {
    await waitForOk("pay proxy liveness", `${PAY_URL}/checkout/qr?value=smoke`, 120_000);
  }
  console.log("\nDone. Check the Worker logs in the Cloudflare dashboard.");
}
