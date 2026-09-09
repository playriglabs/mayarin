/**
 * Register (or re-register) the example's resource with Mayarin (#269).
 *
 * The only step that needs the merchant's secret key. After this, the
 * request-time surface is keyless: the payer pays, Mayarin settles, and this
 * key never touches a payment.
 *
 * The registered URL is built from PUBLIC_URL and must byte-match the URL an
 * agent actually calls — scheme, host, port and path all count, because the
 * resource is identified by it and a cross-asset payment resolves the
 * merchant by it.
 *
 * bun run register   (MAYARIN_SECRET_KEY, PUBLIC_URL, X402_ACCEPTS — see README)
 */

import { createMayarin, type X402ResourceBody } from "@mayarin/sdk";
import { RESOURCE_ID, registrationConfig } from "../src/config.ts";

const config = registrationConfig();
const mayarin = createMayarin({ baseUrl: config.mayarinApiUrl, secretKey: config.secretKey });

const body: X402ResourceBody = {
  id: RESOURCE_ID,
  url: `${config.publicUrl}/${RESOURCE_ID}`,
  description: "Mayarin's x402 merchant example: one paid JSON report.",
  mimeType: "application/json",
  price: { amount: config.priceAmount, asset: config.priceAsset },
  maxTimeoutSeconds: 3600,
  listed: true,
  accepts: config.accepts,
};

const resource = await mayarin.x402.resources.register(body);
console.log(JSON.stringify({ registered: resource }, null, 2));
