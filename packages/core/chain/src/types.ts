/**
 * Chain layer types.
 *
 * A deposit is an *observation*, not a posting. Nothing here touches a ledger
 * account: the ledger entry for a funded payment is the clearing engine's
 * existing `assetReceivedPosting`, unchanged.
 */

import type { AssetCode, Money } from "@mayarin/shared";

/** EVM chains Mayarin runs on. Widening this is what adds a network. */
export const CHAIN_IDS = [
  "base",
  "base-sepolia",
  "arbitrum",
  "arbitrum-sepolia",
  "robinhood-testnet",
  "arc-testnet",
  "hedera",
  "hedera-testnet",
] as const;

export type ChainId = (typeof CHAIN_IDS)[number];

export function isChainId(value: unknown): value is ChainId {
  return typeof value === "string" && (CHAIN_IDS as readonly string[]).includes(value);
}

/**
 * Numeric EVM chain ids. A chain fact, not deployment configuration — the
 * EIP-155 id of a chain is the same everywhere Mayarin runs, so it belongs
 * beside `CHAIN_IDS` rather than in any one deployment's config.
 */
export const EVM_CHAIN_IDS: Readonly<Record<ChainId, bigint>> = {
  base: 8_453n,
  "base-sepolia": 84_532n,
  arbitrum: 42_161n,
  "arbitrum-sepolia": 421_614n,
  "robinhood-testnet": 46_630n,
  // Read off each chain with `cast chain-id` rather than taken from a docs page.
  // Arc mainnet is absent on purpose: it does not launch until 16 Sep 2026, so
  // no endpoint can confirm its id and a chain fact nobody can check is worse
  // than a missing one. Add it when the network answers.
  "arc-testnet": 5_042_002n,
  hedera: 295n,
  "hedera-testnet": 296n,
};

/**
 * What a chain is called when a person reads it.
 *
 * A chain fact like `EVM_CHAIN_IDS`, for the same reason: "base-sepolia" is an
 * identifier, and a payer choosing which network to send funds on is entitled
 * to see the name the network calls itself. Every surface that shows a chain to
 * a human reads this, so a chain cannot be labelled two ways in two places.
 */
export const CHAIN_LABELS: Readonly<Record<ChainId, string>> = {
  base: "Base",
  "base-sepolia": "Base Sepolia",
  arbitrum: "Arbitrum One",
  "arbitrum-sepolia": "Arbitrum Sepolia",
  "robinhood-testnet": "Robinhood Testnet",
  "arc-testnet": "Arc Testnet",
  hedera: "Hedera",
  "hedera-testnet": "Hedera Testnet",
};

/** The label for a chain, falling back to the identifier for an unknown one. */
export function chainLabel(chain: string): string {
  return isChainId(chain) ? CHAIN_LABELS[chain] : chain;
}

const BASE_LOGO = "https://assets-cdn.trustwallet.com/blockchains/base/info/logo.png";

/**
 * The network mark shown beside a chain name.
 *
 * Arc is local because it is not in Trust Wallet's registry yet. Its argument
 * lets each frontend hand Vite or Astro the public URL it actually serves.
 */
export function chainLogoUrl(chain: string, arcLogo = "/chains/arc.svg"): string | undefined {
  if (chain === "base" || chain === "base-sepolia") return BASE_LOGO;
  if (chain === "arc-testnet") return arcLogo;
  return undefined;
}

/**
 * Which chains carry real value. Also a chain fact rather than configuration:
 * a deployment can choose which chains it enables, but not whether Arbitrum One
 * is a mainnet.
 *
 * Guards read this instead of comparing against a chain name, so adding a
 * mainnet cannot silently slip past a check written when Base was the only one.
 */
export const MAINNET_CHAIN_IDS: ReadonlySet<ChainId> = new Set<ChainId>([
  "base",
  "arbitrum",
  "hedera",
]);

export function isMainnetChain(chain: ChainId): boolean {
  return MAINNET_CHAIN_IDS.has(chain);
}

/**
 * The CAIP-2 identifier for a chain — `eip155:<EIP-155 id>`.
 *
 * A chain fact, derived from `EVM_CHAIN_IDS` rather than written out a second
 * time, so a chain added above cannot arrive here with a different number. x402
 * names networks this way on the wire; nothing else in the domain does yet.
 */
export function caip2Of(chain: ChainId): string {
  return `eip155:${EVM_CHAIN_IDS[chain]}`;
}

/**
 * The chain a CAIP-2 identifier names, or `undefined` for one this deployment
 * does not know. Undefined rather than a throw: an unknown network arriving off
 * the wire is a rejected request, not a bug.
 */
export function chainOfCaip2(id: string): ChainId | undefined {
  return CHAIN_IDS.find((chain) => caip2Of(chain) === id);
}

/** A block identified by both height and hash — the hash is what detects a reorg. */
export interface BlockRef {
  readonly number: bigint;
  readonly hash: string;
}

/** An ERC-20 `Transfer` as read from the chain, before any policy is applied. */
export interface TransferLog {
  readonly chain: ChainId;
  readonly asset: AssetCode;
  readonly txHash: string;
  readonly logIndex: number;
  readonly blockNumber: bigint;
  readonly blockHash: string;
  readonly from: string;
  readonly to: string;
  /** Raw token amount, in the asset's minor units. */
  readonly amount: bigint;
}

/**
 * Deposit lifecycle.
 *
 * `PENDING` has touched nothing and can still disappear. `CONFIRMED` is past
 * the configured depth and is the only status that can fund a payment.
 * `ORPHANED` was reorged away.
 */
export const DEPOSIT_STATUSES = ["PENDING", "CONFIRMED", "ORPHANED"] as const;

export type DepositStatus = (typeof DEPOSIT_STATUSES)[number];

export interface Deposit {
  readonly id: string;
  readonly chain: ChainId;
  readonly txHash: string;
  readonly logIndex: number;
  readonly address: string;
  readonly amount: Money;
  readonly blockNumber: bigint;
  readonly blockHash: string;
  readonly status: DepositStatus;
  readonly firstSeenAt: Date;
  readonly confirmedAt?: Date;
  readonly orphanedAt?: Date;
}

/** A deposit that was counted and then reorged away — the case needing a human. */
export function isOrphanedAfterConfirmed(deposit: Deposit): boolean {
  return deposit.confirmedAt !== undefined && deposit.orphanedAt !== undefined;
}

/**
 * A `PaymentCompleted` log as read from the chain, before any policy is applied.
 *
 * The settlement signal `PaymentRouter` emits once it has received, swapped and
 * paid the merchant. Unlike a transfer, it names the payment it belongs to:
 * `intentId` is the value the backend derived from the clearing transaction id,
 * so no address matching is involved.
 *
 * `settledAmount` and the rest are carried because they are the on-chain truth
 * the ledger reconciles against — the amount the merchant was actually paid,
 * not the amount that was quoted.
 */
export interface SettlementLog {
  readonly chain: ChainId;
  readonly txHash: string;
  readonly logIndex: number;
  readonly blockNumber: bigint;
  readonly blockHash: string;
  /** `bytes32` hex; matches `clearing_transactions.contract_intent_id`. */
  readonly intentId: string;
  readonly merchantSafe: string;
  /** Raw minor units of the settlement asset paid to the merchant. */
  readonly settledAmount: bigint;
  readonly fee: bigint;
  readonly refundAmount: bigint;
}

/**
 * A recorded settlement observation.
 *
 * Shares `DepositStatus` with deposits on purpose: the vocabulary is the same
 * because the finality question is the same — below the confirmation depth it
 * has touched nothing, at depth it may complete a payment, and a reorg after
 * that is a fact to record rather than a state to undo.
 */
export interface SettlementEvent {
  readonly id: string;
  readonly chain: ChainId;
  readonly txHash: string;
  readonly logIndex: number;
  readonly blockNumber: bigint;
  readonly blockHash: string;
  readonly intentId: string;
  readonly merchantSafe: string;
  readonly settledAmount: bigint;
  readonly fee: bigint;
  readonly refundAmount: bigint;
  readonly status: DepositStatus;
  readonly firstSeenAt: Date;
  readonly confirmedAt?: Date;
  readonly orphanedAt?: Date;
  /** Set once the clearing engine has been told; keeps completion at-most-once. */
  readonly completedAt?: Date;
}

/** A settlement that was acted on and then reorged away — the case needing a human. */
export function isSettlementReversed(event: SettlementEvent): boolean {
  return event.completedAt !== undefined && event.orphanedAt !== undefined;
}

export interface DepositAddress {
  readonly id: string;
  readonly clearingTransactionId: string;
  /** BIP-32 index. Persisting it is what makes the address re-derivable. */
  readonly derivationIndex: number;
  readonly chain: ChainId;
  readonly asset: AssetCode;
  readonly address: string;
  readonly createdAt: Date;
}

/** An address the watcher scans for, joined to what its payment expects. */
export interface WatchedAddress {
  readonly clearingTransactionId: string;
  readonly chain: ChainId;
  readonly asset: AssetCode;
  readonly address: string;
  readonly requiredAmount: Money;
  /** False once the clearing transaction is terminal: still recorded, never funds. */
  readonly fundable: boolean;
}
