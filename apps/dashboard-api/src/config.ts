/**
 * Runtime configuration.
 *
 * Validated once at startup. The dashboard API shares the same Postgres as the
 * payment API, so it only needs the session/auth knobs plus the database URL.
 */

import { ConfigurationError } from "@mayarin/shared";
import { z } from "zod";

const configSchema = z.object({
  port: z.coerce.number().int().positive().default(3001),
  databaseUrl: z.string().min(1),
  /** Session lifetime in seconds. Defaults to 7 days. */
  sessionTtlSeconds: z.coerce
    .number()
    .int()
    .positive()
    .default(60 * 60 * 24 * 7),
  /**
   * Sets the `Secure` flag on the session/CSRF cookies. True in production; set
   * `COOKIE_SECURE=false` for local dev over plain HTTP.
   */
  cookieSecure: z
    .enum(["true", "false"])
    .default("true")
    .transform((value) => value === "true"),
  /** Page size cap for payment listings. */
  paymentsPageSize: z.coerce.number().int().positive().max(200).default(50),
});

export type Config = z.infer<typeof configSchema>;

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const result = configSchema.safeParse({
    port: env.DASHBOARD_API_PORT,
    databaseUrl: env.DATABASE_URL,
    sessionTtlSeconds: env.SESSION_TTL_SECONDS,
    cookieSecure: env.COOKIE_SECURE,
    paymentsPageSize: env.PAYMENTS_PAGE_SIZE,
  });

  if (!result.success) {
    throw new ConfigurationError("Invalid environment configuration", {
      issues: result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`),
    });
  }

  return result.data;
}
