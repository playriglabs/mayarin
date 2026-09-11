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
  MerchantRailsResponse,
  ProvisionEverywhereResponse,
  SettingsHistoryResponse,
  SettingsResponse,
  UpdateSettingsRequest,
  UpdateSettingsResponse,
  WalletBalanceResponse,
  WalletListResponse,
  WalletResponse,
  WalletWithdrawalHistoryResponse,
  WebhookDeliveryListFilter,
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
const WALLET_RAILS_KEY = ["wallets", "rails"];
const WALLET_WITHDRAWALS_KEY = ["wallets", "withdrawals"];
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
    toast: { loading: "Saving settings…", success: "Settings saved" },
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
    toast: { loading: "Linking wallet…", success: "Wallet linked" },
    invalidate: [WALLETS_KEY],
  });
}

/**
 * Sets the managed wallet up on one network. Idempotent: the same address comes
 * back, deployed there.
 */
export function useProvisionWallet() {
  return useEffectMutation<WalletResponse, string, ApiError>({
    mutation: (chain) => walletsApi.provision(chain),
    toast: { loading: "Setting up your wallet…", success: "Wallet ready on this network" },
    invalidate: [WALLETS_KEY, WALLET_BALANCE_KEY, WALLET_RAILS_KEY, SETTINGS_KEY],
  });
}

/** Creates the managed wallet on every network at once — one address, deployed on each. */
export function useProvisionWalletEverywhere() {
  return useEffectMutation<ProvisionEverywhereResponse, void, ApiError>({
    mutation: () => walletsApi.provisionEverywhere(),
    toast: { loading: "Creating your managed wallet…", success: "Managed wallet created" },
    invalidate: [WALLETS_KEY, WALLET_BALANCE_KEY, WALLET_RAILS_KEY, SETTINGS_KEY],
  });
}

/** Issues the text to sign. Signing it moves no funds. */
export function useWalletChallenge() {
  return useEffectMutation<ChallengeResponse, string, ApiError>({
    mutation: (walletId) => walletsApi.challenge(walletId),
    toast: { loading: "Preparing signature…", success: "Signature request ready" },
  });
}

export function useVerifyWallet() {
  return useEffectMutation<WalletResponse, VerifyWalletRequest, ApiError>({
    mutation: (vars) => walletsApi.verify(vars),
    toast: { loading: "Verifying wallet…", success: "Wallet verified" },
    invalidate: [WALLETS_KEY, SETTINGS_KEY],
  });
}

/**
 * The on-chain balance of the settlement address.
 *
 * A successful withdrawal invalidates this query immediately. No poll of its
 * own: the `payments` refresh stream in `live-updates.tsx` refetches it on
 * every tick, which also covers an RPC node briefly returning its previous
 * `latest` block and a balance that changes outside this dashboard.
 */
export function useWalletBalance() {
  return useEffectQuery<WalletBalanceResponse, ApiError>({
    queryKey: WALLET_BALANCE_KEY,
    query: () => walletsApi.balance(),
  });
}

/**
 * Which networks this merchant can be paid on, and why not the rest (#244).
 *
 * Read alongside the balances rather than derived from them: a chain with a
 * settlement address can still be unpayable — an asset nothing can price, or an
 * address that is a contract somewhere else — and only the API knows which.
 */
export function useMerchantRails() {
  return useEffectQuery<MerchantRailsResponse, ApiError>({
    queryKey: WALLET_RAILS_KEY,
    query: () => walletsApi.rails(),
  });
}

export function useWalletWithdrawalHistory() {
  return useEffectQuery<WalletWithdrawalHistoryResponse, ApiError>({
    queryKey: WALLET_WITHDRAWALS_KEY,
    query: () => walletsApi.withdrawalHistory(),
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
    toast: { loading: "Submitting withdrawal…", success: "Withdrawal submitted" },
    invalidate: [WALLET_BALANCE_KEY, WALLET_WITHDRAWALS_KEY],
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
    toast: { loading: "Creating webhook…", success: "Webhook created" },
    invalidate: [ENDPOINTS_KEY],
  });
}

export function useRotateWebhookSecret() {
  return useEffectMutation<WebhookEndpointResponse, string, ApiError>({
    mutation: (id) => webhooksApi.rotateSecret(id),
    toast: { loading: "Rotating secret…", success: "Webhook secret rotated" },
    invalidate: [ENDPOINTS_KEY],
  });
}

export function useDeactivateWebhookEndpoint() {
  return useEffectMutation<WebhookEndpointResponse, string, ApiError>({
    mutation: (id) => webhooksApi.deactivateEndpoint(id),
    toast: { loading: "Deactivating webhook…", success: "Webhook deactivated" },
    invalidate: [ENDPOINTS_KEY],
  });
}

/**
 * Deliveries poll while any is still pending: a retry lands on its own
 * schedule, and a merchant watching one land should not have to reload.
 */
export function useWebhookDeliveries(filter: WebhookDeliveryListFilter = {}, cursor?: string) {
  return useEffectQuery<WebhookDeliveryListResponse, ApiError>({
    queryKey: [...DELIVERIES_KEY, filter, cursor ?? null],
    query: () => webhooksApi.listDeliveries(filter, cursor),
    refetchInterval: (data) =>
      (data?.deliveries ?? []).some((d) => d.deliveredAt === null) ? 10_000 : false,
  });
}

export function useReplayDelivery() {
  return useEffectMutation<WebhookDeliveryResponse, string, ApiError>({
    mutation: (id) => webhooksApi.replayDelivery(id),
    toast: { loading: "Replaying delivery…", success: "Webhook replay queued" },
    invalidate: [DELIVERIES_KEY],
  });
}
