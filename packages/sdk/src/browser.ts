/**
 * Browser entry point (`@mayarin/sdk/browser`).
 *
 * For the open buyer surface — the hosted checkout and invoice pages and the
 * endpoints those pages call — and, with a publishable key (`pk_...`), the
 * public commerce surface: catalog read and cart checkout (#113). The config
 * has no field for a secret key, so the type system refuses a leaked secret;
 * `PublishableCommerceModule` refuses a catalog write the same way.
 */

import { type BaseMayarinClient, buildClient, type ClientConfig } from "./client.ts";
import { createPublishableCommerceModule, type PublishableCommerceModule } from "./commerce.ts";

export interface MayarinBrowserConfig extends ClientConfig {
  /**
   * Publishable key minted on the dashboard. Safe in a browser bundle: it
   * identifies the merchant and reaches only catalog read and cart checkout.
   * Without one, only the keyless buyer routes answer.
   */
  readonly publishableKey?: string;
}

export interface MayarinBrowserClient extends BaseMayarinClient {
  readonly commerce: PublishableCommerceModule;
}

export function createMayarinBrowser(config: MayarinBrowserConfig): MayarinBrowserClient {
  const client = buildClient(
    config,
    config.publishableKey === undefined ? {} : { publishableKey: config.publishableKey },
  );
  return {
    ...client,
    commerce: createPublishableCommerceModule(client.transport),
  };
}

export type { ClientConfig } from "./client.ts";
export type { PublishableCommerceModule } from "./commerce.ts";
export { isMayarinApiError, MayarinApiError } from "./errors.ts";
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
