/**
 * API key hooks — one React Query hook per `/api-keys` route. Mirrors
 * `lib/api/api-keys` one-to-one.
 *
 * `useCreateApiKey` returns the one-time secret on success; the component that
 * calls it is responsible for showing it once and never re-fetching it — there
 * is no read path for the plaintext.
 */

import { apiKeysApi } from "@/lib/api/api-keys";
import type { ApiError } from "@/lib/api/client";
import { useEffectMutation, useEffectQuery } from "@/lib/query";
import type {
  ApiKeyCreateResponse,
  ApiKeyDto,
  ApiKeyListResponse,
  CreateApiKeyRequest,
} from "@/types/api-keys";

const API_KEYS_KEY = ["api-keys", "list"];

/** GET `/api-keys` — the merchant's keys, without secrets. */
export function useApiKeys() {
  return useEffectQuery<ApiKeyListResponse, ApiError>({
    queryKey: API_KEYS_KEY,
    query: () => apiKeysApi.list(),
  });
}

export function useCreateApiKey() {
  return useEffectMutation<ApiKeyCreateResponse, CreateApiKeyRequest, ApiError>({
    mutation: (body) => apiKeysApi.create(body),
    invalidate: [API_KEYS_KEY],
  });
}

export function useDeactivateApiKey() {
  return useEffectMutation<ApiKeyDto, string, ApiError>({
    mutation: (id) => apiKeysApi.deactivate(id),
    invalidate: [API_KEYS_KEY],
  });
}
