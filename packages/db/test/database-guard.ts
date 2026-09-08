/** Safety gate for destructive Postgres integration suites. */

export interface DatabaseTestEnvironment {
  readonly [key: string]: string | undefined;
}

interface DatabaseTarget {
  readonly identity: string;
  readonly name: string;
}

const POSTGRES_PROTOCOLS = new Set(["postgres:", "postgresql:"]);

function databaseTarget(value: string, variable: string): DatabaseTarget {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${variable} must be a valid Postgres URL`);
  }

  if (!POSTGRES_PROTOCOLS.has(parsed.protocol)) {
    throw new Error(`${variable} must use postgres:// or postgresql://`);
  }

  const name = decodeURIComponent(parsed.pathname.replace(/^\//, "").replace(/\/$/, ""));
  if (name.length === 0) throw new Error(`${variable} must name a database`);

  const host = new Set(["localhost", "127.0.0.1", "[::1]"]).has(parsed.hostname)
    ? "localhost"
    : parsed.hostname.toLowerCase();
  return {
    // Credentials and query parameters do not change which database gets
    // truncated, so neither belongs in the comparison.
    identity: `${host}:${parsed.port || "5432"}/${name}`,
    name,
  };
}

/** Returns the opt-in URL, or refuses before any connection is made. */
export function guardedTestDatabaseUrl(environment: DatabaseTestEnvironment): string | undefined {
  const testUrl = environment.TEST_DATABASE_URL;
  if (testUrl === undefined || testUrl.length === 0) return undefined;

  const testTarget = databaseTarget(testUrl, "TEST_DATABASE_URL");
  if (!testTarget.name.endsWith("_test")) {
    throw new Error(
      `Refusing destructive database tests: TEST_DATABASE_URL names "${testTarget.name}", not a database ending in "_test"`,
    );
  }

  const developmentUrl = environment.DATABASE_URL;
  if (developmentUrl !== undefined && developmentUrl.length > 0) {
    const developmentTarget = databaseTarget(developmentUrl, "DATABASE_URL");
    if (testTarget.identity === developmentTarget.identity) {
      throw new Error(
        "Refusing destructive database tests: TEST_DATABASE_URL targets the same database as DATABASE_URL",
      );
    }
  }

  return testUrl;
}
