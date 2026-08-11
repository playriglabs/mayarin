/**
 * Browser entry point (`@mayarin/sdk/browser`).
 *
 * For the open buyer surface: the hosted checkout and invoice pages, and the
 * endpoints those pages call. The config has no field for a key, so the type
 * system refuses a leaked secret. Publishable keys do not exist yet; the
 * embed (#113) waits on that design.
 */

import { buildClient, type ClientConfig, type MayarinClient } from "./client.ts";

export type MayarinBrowserConfig = ClientConfig;

export function createMayarinBrowser(config: MayarinBrowserConfig): MayarinClient {
  return buildClient(config);
}

export type { ClientConfig, MayarinClient } from "./client.ts";
export { isMayarinApiError, MayarinApiError } from "./errors.ts";
export { PRESETS, type Preset, type PresetName } from "./presets.ts";
export type { QueryParams, RequestOptions, Transport } from "./transport.ts";
export { MAYARIN_VERSION } from "./version.ts";
