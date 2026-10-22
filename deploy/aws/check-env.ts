/**
 * Validates the generated AWS env files with each service's own loadConfig, without
 * starting anything and without the network. A mainnet config that a service refuses
 * to boot on shows up here, not after a three-minute image build and a deploy.
 *
 *   bun run deploy/aws/check-env.ts [dir]      dir defaults to deploy/aws/out
 *
 * Prints only the service and the refusal (key names, never values). DATABASE_URL is
 * a placeholder: the real one is written on the host by bootstrap.sh.
 */

import { readFileSync } from "node:fs";
import { loadConfig as loadApiConfig } from "../../apps/api/src/config.ts";
import { loadConfig as loadDashboardConfig } from "../../apps/dashboard-api/src/config.ts";

const dir = process.argv[2] ?? "deploy/aws/out";
const DATABASE_URL = "postgres://check:check@localhost:5432/check?sslmode=require";

/** The part of docker compose's env_file syntax these files use: KEY=value or KEY='value'. */
function readEnvFile(path: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const match = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line);
    if (match?.[1] === undefined || match[2] === undefined) continue;
    const quoted = /^'(.*)'$/.exec(match[2]);
    env[match[1]] = quoted?.[1] ?? match[2];
  }
  return env;
}

const checks: readonly (readonly [string, () => unknown])[] = [
  [
    "core-api",
    () => loadApiConfig({ ...readEnvFile(`${dir}/.env.core-api`), DATABASE_URL }, "api"),
  ],
  [
    "chain-worker",
    () => loadApiConfig({ ...readEnvFile(`${dir}/.env.chain-worker`), DATABASE_URL }, "worker"),
  ],
  [
    "dashboard-api",
    () => loadDashboardConfig({ ...readEnvFile(`${dir}/.env.dashboard-api`), DATABASE_URL }),
  ],
];

let failed = false;
for (const [service, check] of checks) {
  try {
    check();
    console.log(`ok    ${service}`);
  } catch (error) {
    failed = true;
    const issues = (error as { context?: { issues?: unknown } }).context?.issues;
    console.log(`FAIL  ${service}: ${error instanceof Error ? error.message : String(error)}`);
    if (Array.isArray(issues))
      for (const issue of issues) console.log(`        - ${String(issue)}`);
  }
}
process.exit(failed ? 1 : 0);
