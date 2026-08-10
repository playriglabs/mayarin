/**
 * API keys client — bearer-token management over `/api-keys`. Mirrors the
 * dashboard API route. Returns `Effect`s; the centralized client attaches the
 * CSRF token for mutating calls.
 */

import type { Effect } from "effect";
import { type ApiError, request } from "@/lib/api/client";
import { listPath } from "@/lib/api/list-path";
import type {
  ApiKeyCreateResponse,
  ApiKeyDto,
  ApiKeyListFilter,
  ApiKeyListResponse,
  CreateApiKeyRequest,
} from "@/types/api-keys";

export const apiKeysApi = {
  list: (filter: ApiKeyListFilter = {}): Effect.Effect<ApiKeyListResponse, ApiError> =>
    request<ApiKeyListResponse>(listPath("/api-keys", filter)),

  create: (body: CreateApiKeyRequest): Effect.Effect<ApiKeyCreateResponse, ApiError> =>
    request<ApiKeyCreateResponse>("/api-keys", { method: "POST", body }),

  /** Deactivates a key. A minted secret cannot be reactivated. */
  deactivate: (id: string): Effect.Effect<ApiKeyDto, ApiError> =>
    request<ApiKeyDto>(`/api-keys/${encodeURIComponent(id)}`, { method: "DELETE" }),
};
