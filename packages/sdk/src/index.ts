/**
 * Server entry point (`@mayarin/sdk`).
 *
 * Takes the merchant's secret key and calls the merchant surface of the
 * payment API. Never import this from browser code — use
 * `@mayarin/sdk/browser`, whose config has no field for a secret.
 */

import { buildClient, type ClientConfig, type MayarinClient } from "./client.ts";

export interface MayarinConfig extends ClientConfig {
  /** Secret key minted on the dashboard (`/api-keys`). Server-side only. */
  readonly secretKey: string;
}

export function createMayarin(config: MayarinConfig): MayarinClient {
  return buildClient(config, config.secretKey);
}

export type { ClientConfig, MayarinClient } from "./client.ts";
export { isMayarinApiError, MayarinApiError } from "./errors.ts";
export { PRESETS, type Preset, type PresetName } from "./presets.ts";
export type { QueryParams, RequestOptions, Transport } from "./transport.ts";
export { MAYARIN_VERSION } from "./version.ts";
