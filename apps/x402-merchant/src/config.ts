/**
 * Runtime environment for the example merchant.
 *
 * Resource pricing and rails are configured in the Mayarin dashboard. The
 * server only needs to know which payment API hosts that registered resource;
 * no merchant credential or payout configuration rides on a payment.
 */

/** Dashboard id of the one resource this example sells. */
export const RESOURCE_ID = "premium-content";

/** Public route registered for that resource. Its path need not equal the id. */
export const RESOURCE_PATH = "/premium";

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
