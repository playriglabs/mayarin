/** Run a local command against Railway through its public Postgres TCP proxy. */

import postgres from "postgres";

const TESTNET_PROJECT_ID = "70236ce0-42f9-458e-bed1-b02ec10e5b7c";
const TESTNET_PROJECT_NAME = "mayarin-testnet";
const ENVIRONMENT = "production";
const SERVICE = "Postgres";

const requireVariable = (variables: Readonly<Record<string, unknown>>, name: string): string => {
  const value = variables[name];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Railway Postgres variable ${name} is missing`);
  }
  return value;
};

const readRailwayVariables = async (): Promise<Readonly<Record<string, unknown>>> => {
  const railwayProcess = Bun.spawn(
    [
      "railway",
      "variables",
      "--project",
      TESTNET_PROJECT_ID,
      "--environment",
      ENVIRONMENT,
      "--service",
      SERVICE,
      "--json",
    ],
    { stdout: "pipe", stderr: "inherit" },
  );
  const output = await new Response(railwayProcess.stdout).text();
  const exitCode = await railwayProcess.exited;
  if (exitCode !== 0) throw new Error("Could not read Railway Postgres variables");

  const parsed: unknown = JSON.parse(output);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("Railway returned an invalid variables response");
  }
  return parsed as Readonly<Record<string, unknown>>;
};

const createPublicDatabaseUrl = (variables: Readonly<Record<string, unknown>>): string => {
  const projectName = requireVariable(variables, "RAILWAY_PROJECT_NAME");
  if (projectName !== TESTNET_PROJECT_NAME) {
    throw new Error(`Expected Railway project ${TESTNET_PROJECT_NAME}, received ${projectName}`);
  }

  const url = new URL("postgresql://localhost");
  url.username = requireVariable(variables, "PGUSER");
  url.password = requireVariable(variables, "PGPASSWORD");
  url.hostname = requireVariable(variables, "RAILWAY_TCP_PROXY_DOMAIN");
  url.port = requireVariable(variables, "RAILWAY_TCP_PROXY_PORT");
  url.pathname = `/${requireVariable(variables, "PGDATABASE")}`;
  return url.toString();
};

const checkConnection = async (databaseUrl: string): Promise<void> => {
  const sql = postgres(databaseUrl, { connect_timeout: 10, max: 1 });
  try {
    await sql`select 1`;
  } finally {
    await sql.end();
  }
};

const separatorIndex = process.argv.indexOf("--");
const command =
  separatorIndex === -1 ? process.argv.slice(2) : process.argv.slice(separatorIndex + 1);
const variables = await readRailwayVariables();
const databaseUrl = createPublicDatabaseUrl(variables);
await checkConnection(databaseUrl);

if (command.length === 0) {
  console.log(`Railway Postgres connection succeeded for ${TESTNET_PROJECT_NAME}.`);
  process.exit(0);
}

console.log(`Running against ${TESTNET_PROJECT_NAME} through Railway's public TCP proxy.`);
const child = Bun.spawn(command, {
  cwd: new URL("..", import.meta.url).pathname,
  env: { ...process.env, DATABASE_URL: databaseUrl },
  stdin: "inherit",
  stdout: "inherit",
  stderr: "inherit",
});
process.exit(await child.exited);
