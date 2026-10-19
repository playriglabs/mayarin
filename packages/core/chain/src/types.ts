/**
 * Chain layer types.
 *
 * A deposit is an *observation*, not a posting. Nothing here touches a ledger
 * account: the ledger entry for a funded payment is the clearing engine's
 * existing `assetReceivedPosting`, unchanged.
 */

import type { AssetCode, Money } from "@mayarin/shared";

/** EVM chains Mayarin runs on. */
export const EVM_CHAINS = [
  "ethereum-sepolia",
  "base",
  "base-sepolia",
  "arbitrum",
  "arbitrum-sepolia",
  "arc-testnet",
  "polygon-amoy",
  "bsc-testnet",
] as const;

/** Solana clusters Mayarin runs on. */
export const SOLANA_CHAINS = ["solana-devnet", "solana-localnet"] as const;

/** Every chain family understood by the platform. */
export const CHAIN_IDS = [...EVM_CHAINS, ...SOLANA_CHAINS] as const;

export type ChainId = (typeof CHAIN_IDS)[number];
export type EvmChainId = (typeof EVM_CHAINS)[number];
export type SolanaChainId = (typeof SOLANA_CHAINS)[number];

export function isChainId(value: unknown): value is ChainId {
  return typeof value === "string" && (CHAIN_IDS as readonly string[]).includes(value);
}

export function isEvmChainId(value: unknown): value is EvmChainId {
  return typeof value === "string" && (EVM_CHAINS as readonly string[]).includes(value);
}

export function isSolanaChainId(value: unknown): value is SolanaChainId {
  return typeof value === "string" && (SOLANA_CHAINS as readonly string[]).includes(value);
}

const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const SOLANA_PUBLIC_KEY = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/** Lightweight wire validation; adapters still parse addresses canonically. */
export function isChainAddress(chain: ChainId, address: string): boolean {
  return isEvmChainId(chain) ? EVM_ADDRESS.test(address) : SOLANA_PUBLIC_KEY.test(address);
}

/** EVM addresses compare case-insensitively; Solana base58 public keys do not. */
export function normaliseChainAddress(chain: ChainId, address: string): string {
  return isEvmChainId(chain) ? address.toLowerCase() : address;
}

/**
 * Numeric EVM chain ids. A chain fact, not deployment configuration — the
 * EIP-155 id of a chain is the same everywhere Mayarin runs, so it belongs
 * beside `CHAIN_IDS` rather than in any one deployment's config.
 */
export const EVM_CHAIN_IDS: Readonly<Record<EvmChainId, bigint>> = {
  "ethereum-sepolia": 11_155_111n,
  base: 8_453n,
  "base-sepolia": 84_532n,
  arbitrum: 42_161n,
  "arbitrum-sepolia": 421_614n,
  // Read off each chain with `cast chain-id` rather than taken from a docs page.
  // Arc mainnet is absent on purpose: it does not launch until 16 Sep 2026, so
  // no endpoint can confirm its id and a chain fact nobody can check is worse
  // than a missing one. Add it when the network answers.
  "arc-testnet": 5_042_002n,
  "polygon-amoy": 80_002n,
  "bsc-testnet": 97n,
};

/** Returns the EIP-155 id, refusing a non-EVM chain at the adapter boundary. */
export function evmChainIdOf(chain: ChainId): bigint {
  if (!isEvmChainId(chain)) throw new Error(`${chain} is not an EVM chain`);
  return EVM_CHAIN_IDS[chain];
}

/**
 * What a chain is called when a person reads it.
 *
 * A chain fact like `EVM_CHAIN_IDS`, for the same reason: "base-sepolia" is an
 * identifier, and a payer choosing which network to send funds on is entitled
 * to see the name the network calls itself. Every surface that shows a chain to
 * a human reads this, so a chain cannot be labelled two ways in two places.
 */
export const CHAIN_LABELS: Readonly<Record<ChainId, string>> = {
  "ethereum-sepolia": "Ethereum Sepolia",
  base: "Base",
  "base-sepolia": "Base Sepolia",
  arbitrum: "Arbitrum One",
  "arbitrum-sepolia": "Arbitrum Sepolia",
  "arc-testnet": "Arc Testnet",
  "polygon-amoy": "Polygon Amoy",
  "bsc-testnet": "BNB Smart Chain Testnet",
  "solana-devnet": "Solana Devnet",
  "solana-localnet": "Solana Localnet",
};

/** The label for a chain, falling back to the identifier for an unknown one. */
export function chainLabel(chain: string): string {
  return isChainId(chain) ? CHAIN_LABELS[chain] : chain;
}

const TRUST_WALLET_CHAIN_LOGOS: Readonly<Record<string, string>> = {
  ethereum: "https://assets-cdn.trustwallet.com/blockchains/ethereum/info/logo.png",
  base: "https://assets-cdn.trustwallet.com/blockchains/base/info/logo.png",
  arbitrum: "https://assets-cdn.trustwallet.com/blockchains/arbitrum/info/logo.png",
  solana: "https://assets-cdn.trustwallet.com/blockchains/solana/info/logo.png",
  polygon: "https://assets-cdn.trustwallet.com/blockchains/polygon/info/logo.png",
  bnb: "https://assets-cdn.trustwallet.com/blockchains/smartchain/info/logo.png",
};

/** A testnet wears its mainnet's mark; Trust Wallet registers only the mainnet. */
const MAINNET_OF: Readonly<Record<string, string>> = {
  "ethereum-sepolia": "ethereum",
  "base-sepolia": "base",
  "arbitrum-sepolia": "arbitrum",
  "polygon-amoy": "polygon",
  "bsc-testnet": "bnb",
  "solana-devnet": "solana",
  "solana-localnet": "solana",
};

/**
 * The network mark shown beside a chain name.
 *
 * Arc is local because it is not in Trust Wallet's registry. The argument lets
 * each frontend hand Vite or Astro the public URL it actually serves.
 */
export function chainLogoUrl(chain: string, arcLogo = "/chains/arc.svg"): string | undefined {
  if (chain === "arc-testnet") return arcLogo;
  return TRUST_WALLET_CHAIN_LOGOS[MAINNET_OF[chain] ?? chain];
}

/**
 * Which chains carry real value. Also a chain fact rather than configuration:
 * a deployment can choose which chains it enables, but not whether Arbitrum One
 * is a mainnet.
 *
 * Guards read this instead of comparing against a chain name, so adding a
 * mainnet cannot silently slip past a check written when Base was the only one.
 */
export const MAINNET_CHAIN_IDS: ReadonlySet<ChainId> = new Set<ChainId>(["base", "arbitrum"]);

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
const SOLANA_CAIP2: Readonly<Record<SolanaChainId, string>> = {
  "solana-devnet": "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
  "solana-localnet": "solana:localnet",
};

export function caip2Of(chain: ChainId): string {
  return isEvmChainId(chain) ? `eip155:${EVM_CHAIN_IDS[chain]}` : SOLANA_CAIP2[chain];
}

/**
 * The chain a CAIP-2 identifier names, or `undefined` for one this deployment
 * does not know. Undefined rather than a throw: an unknown network arriving off
 * the wire is a rejected request, not a bug.
 */
export function chainOfCaip2(id: string): ChainId | undefined {
  return CHAIN_IDS.find((chain) => caip2Of(chain) === id);
}

/**
 * A block identified by height and, where the client has it, hash. The hash is
 * what detects a reorg, but that probe asks `blockHash` for it; nothing reads
 * the hash of a head. A client for which the hash costs a call (Solana's is a
 * `getBlock`) leaves it out of `head`.
 */
export interface BlockRef {
  readonly number: bigint;
  readonly hash?: string;
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
