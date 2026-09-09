/**
 * Server entry point (`@mayarin/sdk`).
 *
 * Takes the merchant's secret key and calls the merchant surface of the
 * payment API. Never import this from browser code — use
 * `@mayarin/sdk/browser`, whose config has no field for a secret.
 */

import { type BaseMayarinClient, buildClient, type ClientConfig } from "./client.ts";
import { type CommerceModule, createCommerceModule } from "./commerce.ts";
import { createPaymentModule, type PaymentModule } from "./payment.ts";
import { createX402ResourcesModule, type X402ResourcesModule } from "./x402-resources.ts";

export interface MayarinConfig extends ClientConfig {
  /** Secret key minted on the dashboard (`/api-keys`). Server-side only. */
  readonly secretKey: string;
}

export interface MayarinClient extends BaseMayarinClient {
  readonly commerce: CommerceModule;
  readonly payment: PaymentModule;
  /** Agent-endpoint management (#269). Registration only — the request-time surface is keyless. */
  readonly x402: { readonly resources: X402ResourcesModule };
}

export function createMayarin(config: MayarinConfig): MayarinClient {
  const client = buildClient(config, { secretKey: config.secretKey });
  return {
    ...client,
    commerce: createCommerceModule(client.transport),
    payment: createPaymentModule(client.transport),
    x402: { resources: createX402ResourcesModule(client.transport) },
  };
}

export type { ClientConfig } from "./client.ts";
export type { CommerceModule } from "./commerce.ts";
export { isMayarinApiError, MayarinApiError } from "./errors.ts";
export type { PaymentModule } from "./payment.ts";
export { PRESETS, type Preset, type PresetName } from "./presets.ts";
export * as qr from "./qr.ts";
export type { QueryParams, RequestOptions, Transport } from "./transport.ts";
export { MAYARIN_VERSION } from "./version.ts";
export {
  constructWebhook,
  MayarinWebhookError,
  type VerifyWebhookOptions,
  verifyWebhook,
  type WebhookVerificationCode,
} from "./webhooks.ts";
export {
  createReplayStore,
  createX402Gate,
  MayarinX402Error,
  type X402Gate,
  type X402GateConfig,
  type X402GateDecision,
  type X402GateErrorCode,
  type X402ReplayStore,
  type X402ServedResponse,
} from "./x402.ts";
export type { X402ResourcesModule } from "./x402-resources.ts";
