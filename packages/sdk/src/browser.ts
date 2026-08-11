/**
 * Browser entry point (`@mayarin/sdk/browser`).
 *
 * For the open buyer surface: the hosted checkout and invoice pages, and the
 * endpoints those pages call. The config has no field for a key, so the type
 * system refuses a leaked secret. Publishable keys do not exist yet; the
 * embed (#113) waits on that design.
 */

import { type BaseMayarinClient, buildClient, type ClientConfig } from "./client.ts";

export type MayarinBrowserConfig = ClientConfig;

export function createMayarinBrowser(config: MayarinBrowserConfig): BaseMayarinClient {
  return buildClient(config);
}

export type { BaseMayarinClient as MayarinBrowserClient, ClientConfig } from "./client.ts";
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
