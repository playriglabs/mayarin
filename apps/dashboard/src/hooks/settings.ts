/**
 * Settings, wallet and webhook hooks. Mirror `lib/api/settings` one-to-one.
 *
 * Each mutation invalidates the listing it changes; the wallet ceremony
 * invalidates the wallet list on verify, because a wallet's `verified` flag is
 * the only thing that decides whether it can be paid.
 */

import type { ApiError } from "@/lib/api/client";
import {
  type LinkWalletRequest,
  settingsApi,
  type VerifyWalletRequest,
  walletsApi,
  webhooksApi,
} from "@/lib/api/settings";
import { useEffectMutation, useEffectQuery } from "@/lib/query";
import type {
  ChallengeResponse,
  SettingsHistoryResponse,
  SettingsResponse,
  UpdateSettingsRequest,
  UpdateSettingsResponse,
  WalletBalanceResponse,
  WalletListResponse,
  WalletResponse,
  WebhookDeliveryListResponse,
  WebhookDeliveryResponse,
  WebhookEndpointListResponse,
  WebhookEndpointResponse,
  WithdrawRequest,
  WithdrawResponse,
} from "@/types/settings";

const SETTINGS_KEY = ["settings"];
const SETTINGS_HISTORY_KEY = ["settings", "history"];
const WALLETS_KEY = ["wallets"];
const WALLET_BALANCE_KEY = ["wallets", "balance"];
const ENDPOINTS_KEY = ["webhooks", "endpoints"];
const DELIVERIES_KEY = ["webhooks", "deliveries"];

export function useSettings() {
  return useEffectQuery<SettingsResponse, ApiError>({
    queryKey: SETTINGS_KEY,
    query: () => settingsApi.get(),
  });
}

export function useSettingsHistory() {
  return useEffectQuery<SettingsHistoryResponse, ApiError>({
    queryKey: SETTINGS_HISTORY_KEY,
    query: () => settingsApi.history(),
  });
}

export function useUpdateSettings() {
  return useEffectMutation<UpdateSettingsResponse, UpdateSettingsRequest, ApiError>({
    mutation: (body) => settingsApi.update(body),
    invalidate: [SETTINGS_KEY, SETTINGS_HISTORY_KEY],
  });
}

export function useWallets() {
  return useEffectQuery<WalletListResponse, ApiError>({
    queryKey: WALLETS_KEY,
    query: () => walletsApi.list(),
  });
}

export function useLinkWallet() {
  return useEffectMutation<WalletResponse, LinkWalletRequest, ApiError>({
    mutation: (body) => walletsApi.link(body),
    invalidate: [WALLETS_KEY],
  });
}

/** Idempotent: a merchant who already has a managed wallet gets that one back. */
export function useProvisionWallet() {
  return useEffectMutation<WalletResponse, string, ApiError>({
    mutation: (chain) => walletsApi.provision(chain),
    invalidate: [WALLETS_KEY, SETTINGS_KEY],
  });
}

/** Issues the text to sign. Signing it moves no funds. */
export function useWalletChallenge() {
  return useEffectMutation<ChallengeResponse, string, ApiError>({
    mutation: (walletId) => walletsApi.challenge(walletId),
  });
}

export function useVerifyWallet() {
  return useEffectMutation<WalletResponse, VerifyWalletRequest, ApiError>({
    mutation: (vars) => walletsApi.verify(vars),
    invalidate: [WALLETS_KEY, SETTINGS_KEY],
  });
}

/** The on-chain balance of the settlement address. */
export function useWalletBalance() {
  return useEffectQuery<WalletBalanceResponse, ApiError>({
    queryKey: WALLET_BALANCE_KEY,
    query: () => walletsApi.balance(),
  });
}

/**
 * Moves settlement out of the managed wallet.
 *
 * Invalidates the balance rather than writing an optimistic one: the amount
 * that left is known, the gas that paid for it is not, and a merchant reading a
 * balance that is off by the fee will not trust the next one either.
 */
export function useWithdraw() {
  return useEffectMutation<WithdrawResponse, WithdrawRequest, ApiError>({
    mutation: (body) => walletsApi.withdraw(body),
    invalidate: [WALLET_BALANCE_KEY],
  });
}

export function useWebhookEndpoints() {
  return useEffectQuery<WebhookEndpointListResponse, ApiError>({
    queryKey: ENDPOINTS_KEY,
    query: () => webhooksApi.listEndpoints(),
  });
}

export function useCreateWebhookEndpoint() {
  return useEffectMutation<WebhookEndpointResponse, string, ApiError>({
    mutation: (url) => webhooksApi.createEndpoint(url),
    invalidate: [ENDPOINTS_KEY],
  });
}

export function useRotateWebhookSecret() {
  return useEffectMutation<WebhookEndpointResponse, string, ApiError>({
    mutation: (id) => webhooksApi.rotateSecret(id),
    invalidate: [ENDPOINTS_KEY],
  });
}

export function useDeactivateWebhookEndpoint() {
  return useEffectMutation<WebhookEndpointResponse, string, ApiError>({
    mutation: (id) => webhooksApi.deactivateEndpoint(id),
    invalidate: [ENDPOINTS_KEY],
  });
}

/**
 * Deliveries poll while any is still pending: a retry lands on its own
 * schedule, and a merchant watching one land should not have to reload.
 */
export function useWebhookDeliveries(limit?: number) {
  return useEffectQuery<WebhookDeliveryListResponse, ApiError>({
    queryKey: [...DELIVERIES_KEY, limit ?? null],
    query: () => webhooksApi.listDeliveries(limit),
    refetchInterval: (data) =>
      (data?.deliveries ?? []).some((d) => d.deliveredAt === null) ? 10_000 : false,
  });
}

export function useReplayDelivery() {
  return useEffectMutation<WebhookDeliveryResponse, string, ApiError>({
    mutation: (id) => webhooksApi.replayDelivery(id),
    invalidate: [DELIVERIES_KEY],
  });
}
