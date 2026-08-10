/**
 * Settings, wallet and webhook APIs. Mirrors `/settings`, `/wallets` and
 * `/webhooks` on the dashboard API. Returns `Effect`s; never calls `fetch`
 * directly.
 *
 * None of these takes a merchant id: the merchant is the session's, server-side.
 */

import type { Effect } from "effect";
import { type ApiError, request } from "@/lib/api/client";
import { listPath } from "@/lib/api/list-path";
import type {
  ChallengeResponse,
  SettingsHistoryResponse,
  SettingsResponse,
  UpdateSettingsRequest,
  UpdateSettingsResponse,
  WalletBalanceResponse,
  WalletListResponse,
  WalletResponse,
  WebhookDeliveryListFilter,
  WebhookDeliveryListResponse,
  WebhookDeliveryResponse,
  WebhookEndpointListResponse,
  WebhookEndpointResponse,
  WithdrawRequest,
  WithdrawResponse,
} from "@/types/settings";

export const settingsApi = {
  get: (): Effect.Effect<SettingsResponse, ApiError> => request<SettingsResponse>("/settings"),

  update: (body: UpdateSettingsRequest): Effect.Effect<UpdateSettingsResponse, ApiError> =>
    request<UpdateSettingsResponse>("/settings", { method: "PATCH", body }),

  history: (): Effect.Effect<SettingsHistoryResponse, ApiError> =>
    request<SettingsHistoryResponse>("/settings/history"),
};

export interface LinkWalletRequest {
  readonly chain: string;
  readonly address: string;
}

export interface VerifyWalletRequest {
  readonly walletId: string;
  readonly challengeId: string;
  readonly signature: string;
}

export const walletsApi = {
  list: (): Effect.Effect<WalletListResponse, ApiError> => request<WalletListResponse>("/wallets"),

  /** Registers an address the merchant already controls. Unverified until signed for. */
  link: (body: LinkWalletRequest): Effect.Effect<WalletResponse, ApiError> =>
    request<WalletResponse>("/wallets", { method: "POST", body }),

  /** Provisions a managed smart account. Idempotent — asking twice returns the same one. */
  provision: (chain: string): Effect.Effect<WalletResponse, ApiError> =>
    request<WalletResponse>("/wallets/managed", { method: "POST", body: { chain } }),

  /** Issues the text to sign. Signing it moves no funds. */
  challenge: (walletId: string): Effect.Effect<ChallengeResponse, ApiError> =>
    request<ChallengeResponse>(`/wallets/${encodeURIComponent(walletId)}/challenge`, {
      method: "POST",
    }),

  verify: ({ walletId, ...body }: VerifyWalletRequest): Effect.Effect<WalletResponse, ApiError> =>
    request<WalletResponse>(`/wallets/${encodeURIComponent(walletId)}/verify`, {
      method: "POST",
      body,
    }),

  /** What the settlement address holds, read from the chain rather than the ledger. */
  balance: (): Effect.Effect<WalletBalanceResponse, ApiError> =>
    request<WalletBalanceResponse>("/wallets/balance"),

  /** Moves settlement out of the managed wallet, to an address the merchant verified. */
  withdraw: (body: WithdrawRequest): Effect.Effect<WithdrawResponse, ApiError> =>
    request<WithdrawResponse>("/wallets/withdraw", { method: "POST", body }),
};

export const webhooksApi = {
  listEndpoints: (): Effect.Effect<WebhookEndpointListResponse, ApiError> =>
    request<WebhookEndpointListResponse>("/webhooks/endpoints"),

  /** The secret comes back exactly once, here. */
  createEndpoint: (url: string): Effect.Effect<WebhookEndpointResponse, ApiError> =>
    request<WebhookEndpointResponse>("/webhooks/endpoints", { method: "POST", body: { url } }),

  rotateSecret: (id: string): Effect.Effect<WebhookEndpointResponse, ApiError> =>
    request<WebhookEndpointResponse>(`/webhooks/endpoints/${encodeURIComponent(id)}/rotate`, {
      method: "POST",
    }),

  deactivateEndpoint: (id: string): Effect.Effect<WebhookEndpointResponse, ApiError> =>
    request<WebhookEndpointResponse>(`/webhooks/endpoints/${encodeURIComponent(id)}/deactivate`, {
      method: "POST",
    }),

  listDeliveries: (
    filter: WebhookDeliveryListFilter = {},
    cursor?: string,
  ): Effect.Effect<WebhookDeliveryListResponse, ApiError> =>
    request<WebhookDeliveryListResponse>(listPath("/webhooks/deliveries", filter, cursor)),

  replayDelivery: (id: string): Effect.Effect<WebhookDeliveryResponse, ApiError> =>
    request<WebhookDeliveryResponse>(`/webhooks/deliveries/${encodeURIComponent(id)}/replay`, {
      method: "POST",
    }),
};
