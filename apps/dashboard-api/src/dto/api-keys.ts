/**
 * API key request schemas and response DTOs.
 *
 * The secret crosses the wire exactly once, on the create response — never on a
 * listing. `prefix` is what a listing shows instead, so a merchant can tell two
 * keys apart without the secret.
 */

import type { ApiKey, ApiKeyKind, Permission } from "@mayarin/auth";
import { z } from "zod";
import { permissionsSchema } from "./auth.ts";

// The kind/permission pairing (a secret key needs ≥1 permission, a publishable
// key carries none) is enforced by the domain's `createApiKey`, in one place.
export const createApiKeyBodySchema = z
  .object({
    name: z.string().min(1).max(255),
    kind: z.enum(["secret", "publishable"]).optional(),
    permissions: permissionsSchema.optional(),
  })
  .strict();

export interface ApiKeyDto {
  readonly id: string;
  readonly kind: ApiKeyKind;
  readonly name: string;
  /** First characters of the plaintext, for telling keys apart in a listing. */
  readonly prefix: string;
  readonly permissions: readonly Permission[];
  readonly lastUsedAt: string | null;
  readonly active: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly version: number;
}

export interface ApiKeyListResponse {
  readonly apiKeys: readonly ApiKeyDto[];
}

/** The create response: the key (no secret) plus the one-time plaintext secret. */
export interface ApiKeyCreateResponse {
  readonly apiKey: ApiKeyDto;
  readonly secret: string;
}

export function toApiKeyDto(key: ApiKey): ApiKeyDto {
  return {
    id: key.id,
    kind: key.kind,
    name: key.name,
    prefix: key.prefix,
    permissions: [...key.permissions],
    lastUsedAt: key.lastUsedAt?.toISOString() ?? null,
    active: key.active,
    createdAt: key.createdAt.toISOString(),
    updatedAt: key.updatedAt.toISOString(),
    version: key.version,
  };
}
