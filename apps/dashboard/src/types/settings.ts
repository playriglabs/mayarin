/**
 * Settings, wallet and webhook wire types, mirrored from the dashboard API.
 *
 * Every one of these surfaces is merchant-scoped server-side: the merchant is
 * the session's, so nothing here carries a merchant id to send.
 */

import type { MoneyDto } from "@/types/payment";

export interface SettingsDto {
  readonly merchantId: string;
  readonly name: string;
  readonly settlementAsset: string;
  readonly acceptedAssets: readonly string[];
  /** What the merchant chose. `null` is "not chosen", not "nowhere to pay". */
  readonly settlementAddress: string | null;
  /** Where the money actually goes: the choice, or the managed wallet. */
  readonly effectiveSettlementAddress: string | null;
  readonly city: string | null;
  readonly countryCode: string | null;
  /** False when neither a chosen nor a provisioned address exists. */
  readonly canSettleOnChain: boolean;
  /** False until the profile carries both city and country. */
  readonly canCreateLinks: boolean;
  readonly updatedAt: string;
}

export interface SettingsResponse {
  readonly settings: SettingsDto;
}

export interface SettingChangeDto {
  readonly id: string;
  readonly field: string;
  readonly previousValue: string | null;
  readonly nextValue: string | null;
  readonly changedBy: string;
  readonly changedAt: string;
}

export interface SettingsHistoryResponse {
  readonly changes: readonly SettingChangeDto[];
}

export interface UpdateSettingsRequest {
  readonly settlementAsset?: string;
  readonly acceptedAssets?: readonly string[];
  /** `null` clears it; an absent field leaves it alone. */
  readonly settlementAddress?: string | null;
  readonly city?: string | null;
  readonly countryCode?: string | null;
}

export interface UpdateSettingsResponse {
  readonly settings: SettingsDto;
  readonly changes: readonly SettingChangeDto[];
}

/** How a wallet came to be known: connected by the merchant, or created for them. */
export type WalletProvenance = "linked" | "provisioned" | "passkey";

export interface WalletDto {
  readonly id: string;
  readonly chain: string;
  readonly address: string;
  readonly provenance: WalletProvenance;
  /** The only field that decides whether this address can be paid. */
  readonly verified: boolean;
  readonly verifiedAt: string | null;
  /** Who can sign for a managed wallet — `null` for one that is not managed. */
  readonly signers: { readonly merchant: string; readonly mayarin: string } | null;
  readonly keyRef: string | null;
  readonly createdAt: string;
}

export interface WalletListResponse {
  readonly wallets: readonly WalletDto[];
  /** The chain this deployment links, provisions and settles on. */
  readonly chain: string;
}

export interface WalletResponse {
  readonly wallet: WalletDto;
}

/** What the merchant's settlement address holds on-chain, per asset. */
export interface WalletBalanceResponse {
  readonly chain: string;
  /** `null` when the merchant has neither configured an address nor been provisioned one. */
  readonly address: string | null;
  /** Whether Mayarin can move this balance — true only for a wallet it provisioned. */
  readonly withdrawable: boolean;
  readonly balances: readonly MoneyDto[];
}

export interface WithdrawRequest {
  readonly asset: string;
  /** Minor units as a decimal string. Never a float: an ETH amount loses wei. */
  readonly amount: string;
  readonly to: string;
}

export interface WithdrawResponse {
  readonly txHash: string;
}

export interface WalletWithdrawalDto {
  readonly id: string;
  readonly chain: string;
  readonly walletAddress: string;
  readonly destinationAddress: string;
  readonly amount: MoneyDto;
  readonly transactionHash: string;
  readonly completedAt: string;
}

export interface WalletWithdrawalHistoryResponse {
  readonly withdrawals: readonly WalletWithdrawalDto[];
}

export interface ChallengeResponse {
  readonly challengeId: string;
  /** The exact text to sign. Signing it moves no funds. */
  readonly message: string;
  readonly expiresAt: string;
}

export interface WebhookEndpointDto {
  readonly id: string;
  readonly url: string;
  readonly active: boolean;
  /** True while a rotated-out secret is still accepted — the overlap window. */
  readonly rotatedSecretActive: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface WebhookEndpointListResponse {
  readonly endpoints: readonly WebhookEndpointDto[];
}

/** The secret is returned exactly once, on create and on rotate. */
export interface WebhookEndpointResponse {
  readonly endpoint: WebhookEndpointDto;
  readonly secret?: string;
}

export interface WebhookDeliveryDto {
  readonly id: string;
  readonly eventId: string;
  readonly endpointId: string;
  readonly status: string;
  readonly attempts: number;
  /** What the receiver answered — the first thing a merchant debugging needs. */
  readonly lastStatusCode: number | null;
  readonly lastError: string | null;
  readonly nextAttemptAt: string;
  readonly deliveredAt: string | null;
  /** The exact bytes that were signed and sent, so a merchant can verify locally. */
  readonly body: string;
  readonly createdAt: string;
}

export interface WebhookDeliveryListResponse {
  readonly deliveries: readonly WebhookDeliveryDto[];
  readonly nextCursor: string | null;
}

export interface WebhookDeliveryListFilter {
  readonly limit?: number;
  readonly q?: string;
  readonly status?: "PENDING" | "DELIVERED" | "DEAD";
  readonly sort?: "created" | "-created";
  readonly from?: string;
  readonly to?: string;
}

export interface WebhookDeliveryResponse {
  readonly delivery: WebhookDeliveryDto;
}
