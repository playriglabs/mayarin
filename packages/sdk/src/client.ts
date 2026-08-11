/**
 * Client construction shared by the two entry points.
 *
 * The entry points differ only in config: the server entry requires a secret
 * key, the browser entry has no field for one — so the type system, not a
 * runtime check, refuses a secret in the browser (#14).
 */

import { PRESETS, type Preset, type PresetName } from "./presets.ts";
import { createTransport, type Transport, type TransportConfig } from "./transport.ts";

export interface ClientConfig {
  readonly baseUrl: string;
  readonly preset?: PresetName;
  readonly fetch?: typeof globalThis.fetch;
  readonly generateIdempotencyKey?: () => string;
}

export interface MayarinClient {
  /** Raw typed transport. The escape hatch until a module covers a route. */
  readonly transport: Transport;
  readonly preset: Preset;
}

export function buildClient(config: ClientConfig, secretKey?: string): MayarinClient {
  const transportConfig: TransportConfig = {
    baseUrl: config.baseUrl,
    ...(secretKey === undefined ? {} : { secretKey }),
    ...(config.fetch === undefined ? {} : { fetch: config.fetch }),
    ...(config.generateIdempotencyKey === undefined
      ? {}
      : { generateIdempotencyKey: config.generateIdempotencyKey }),
  };
  return {
    transport: createTransport(transportConfig),
    preset: PRESETS[config.preset ?? "merchant"],
  };
}
