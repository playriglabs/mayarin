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
  /**
   * Accepted assets narrowed per chain (#244). A chain absent inherits
   * `acceptedAssets`, which is where every merchant starts.
   */
  readonly acceptedAssetsByChain: Readonly<Record<string, readonly string[]>>;
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
  /** The whole per-chain matrix, replaced as one (#244). */
  readonly acceptedAssetsByChain?: Readonly<Record<string, readonly string[]>>;
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
  /** The chain this deployment links, provisions and settles on by default. */
  readonly chain: string;
  /**
   * Every chain it can provision on (#244). A managed wallet has one address on
   * all of them, deployed on each.
   */
  readonly chains: readonly string[];
}

export interface WalletResponse {
  readonly wallet: WalletDto;
}

/** Creating the managed wallet on every chain: what was made, and where it failed. */
export interface ProvisionEverywhereResponse {
  readonly wallets: readonly WalletDto[];
  readonly failed: readonly { readonly chain: string; readonly reason: string }[];
}

/** What the merchant's settlement address holds on one chain, per asset. */
export interface ChainBalanceDto {
  readonly chain: string;
  /** `null` when the merchant has neither configured an address nor been provisioned one. */
  readonly address: string | null;
  /** Whether Mayarin can move this balance — true only for a wallet it provisioned. */
  readonly withdrawable: boolean;
  readonly balances: readonly MoneyDto[];
}

/**
 * One row per chain this deployment settles on (#244).
 *
 * Chains the merchant has no address on are present with a `null` address
 * rather than omitted: a missing row and an empty one read the same, and only
 * one of them says there is something to do.
 */
export interface WalletBalanceResponse {
  readonly balances: readonly ChainBalanceDto[];
}

/** One rail this merchant can be paid on. */
export interface MerchantRailDto {
  readonly chain: string;
  readonly asset: string;
  readonly contract: string | null;
  readonly payTo: string | null;
}

/** Why a chain, or a pair on it, is not offered to a payer. */
export interface RailExclusionDto {
  readonly kind: string;
  readonly chain: string;
  readonly asset: string | null;
  readonly reason: string;
}

/** What one chain can receive at all, before the merchant's own choices narrow it. */
export interface SupportedChainDto {
  readonly chain: string;
  readonly assets: readonly string[];
}

export interface MerchantRailsResponse {
  readonly settlementAsset: string;
  /** The matrix the settings screen is drawn from: assets per chain, not unioned. */
  readonly supported: readonly SupportedChainDto[];
  readonly rails: readonly MerchantRailDto[];
  readonly unavailable: readonly RailExclusionDto[];
}

export interface WithdrawRequest {
  /** Which chain's wallet to move from. A merchant has one per chain. */
  readonly chain: string;
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
