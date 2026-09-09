/**
 * Environment for the example merchant, split by which entry point needs it.
 *
 * The server needs nothing secret: the gate talks to Mayarin's keyless
 * request-time surface, so no credential rides on a payment. The secret key
 * exists only to register the resource, and only the register script reads it.
 */

import type { X402ResourceBody } from "@mayarin/sdk";

/** The one resource this example sells. Both entry points must agree on it. */
export const RESOURCE_ID = "premium";

export interface ServerConfig {
  /** Origin of the payment API the gate quotes and settles against. */
  readonly mayarinApiUrl: string;
  readonly port: number;
}

export function serverConfig(): ServerConfig {
  const port = Number(process.env.PORT ?? 8787);
  if (!Number.isInteger(port) || port < 1) throw new Error("PORT must be a positive integer");
  return {
    mayarinApiUrl: process.env.MAYARIN_API_URL ?? "http://localhost:3000",
    port,
  };
}

export interface RegistrationConfig {
  readonly mayarinApiUrl: string;
  readonly secretKey: string;
  /**
   * Where this server is reachable from the payer's side — scheme, host and
   * port all count. The registered URL must byte-match the URL an agent
   * actually calls, because a resource is identified by it.
   */
  readonly publicUrl: string;
  readonly priceAmount: string;
  readonly priceAsset: X402ResourceBody["price"]["asset"];
  readonly accepts: X402ResourceBody["accepts"];
}

export function registrationConfig(): RegistrationConfig {
  const accepts = process.env.X402_ACCEPTS;
  if (accepts === undefined) {
    throw new Error("Missing X402_ACCEPTS — a JSON array of {chain, asset, contract, payTo} rails");
  }
  const parsed: unknown = JSON.parse(accepts);
  if (!Array.isArray(parsed) || parsed.length === 0 || !parsed.every(isRail)) {
    throw new Error(
      "X402_ACCEPTS must be a non-empty JSON array of {chain, asset, contract, payTo}",
    );
  }
  const secretKey = process.env.MAYARIN_SECRET_KEY;
  if (!secretKey) throw new Error("Missing MAYARIN_SECRET_KEY");
  const publicUrl = process.env.PUBLIC_URL;
  if (!publicUrl) {
    throw new Error(
      "Missing PUBLIC_URL — the origin the payer will call, e.g. http://localhost:8787",
    );
  }
  return {
    mayarinApiUrl: process.env.MAYARIN_API_URL ?? "http://localhost:3000",
    secretKey,
    publicUrl: publicUrl.replace(/\/+$/, ""),
    priceAmount: process.env.X402_PRICE_AMOUNT ?? "2000",
    priceAsset: (process.env.X402_PRICE_ASSET ?? "USDC") as X402ResourceBody["price"]["asset"],
    // Only the shape is checked here; the chain and asset unions are Mayarin's
    // to refuse — its register route validates against its own registry and
    // answers with the reason.
    accepts: parsed as X402ResourceBody["accepts"],
  };
}

function isRail(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const rail = value as Record<string, unknown>;
  return (
    typeof rail.chain === "string" &&
    typeof rail.asset === "string" &&
    typeof rail.contract === "string" &&
    typeof rail.payTo === "string"
  );
}
