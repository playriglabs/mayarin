/**
 * API key wire types, mirrored from the dashboard API DTOs.
 *
 * The secret crosses the wire exactly once, on the create response. A listing
 * shows only `prefix` — enough to tell two keys apart, never enough to use one.
 */

import type { Permission } from "@/types/user";

export interface ApiKeyDto {
  readonly id: string;
  readonly name: string;
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

export interface ApiKeyListFilter {
  readonly q?: string;
  readonly status?: "active" | "inactive";
  readonly sort?: "created" | "-created";
  readonly from?: string;
  readonly to?: string;
}

export interface ApiKeyCreateResponse {
  readonly apiKey: ApiKeyDto;
  readonly secret: string;
}

export interface CreateApiKeyRequest {
  readonly name: string;
  readonly permissions: readonly Permission[];
}
