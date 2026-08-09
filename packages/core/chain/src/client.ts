/**
 * Chain ports.
 *
 * Narrow interfaces, deliberately: reading the chain, deriving an address, and
 * telling something that value arrived or that a payment settled. Keeping them
 * apart is what lets `core/chain` stay free of both viem and the clearing
 * engine.
 */

import type { AssetCode } from "@mayarin/shared";
import type { BlockRef, ChainId, SettlementLog, TransferLog } from "./types.ts";

export interface TransferQuery {
  readonly chain: ChainId;
  readonly asset: AssetCode;
  readonly fromBlock: bigint;
  readonly toBlock: bigint;
  /** Only transfers *to* these addresses. Empty means the query is skipped. */
  readonly addresses: readonly string[];
}

/**
 * A scan for `PaymentCompleted` logs.
 *
 * Unlike `TransferQuery` this needs no address list. The router is a single
 * known contract, so the filter is one address and one topic — which is why
 * this path needs no indexer service to make it tractable, unlike per-intent
 * deposit addresses that are created continuously.
 */
export interface SettlementQuery {
  readonly chain: ChainId;
  /** The deployed `PaymentRouter` whose logs are read. */
  readonly router: string;
  readonly fromBlock: bigint;
  readonly toBlock: bigint;
}

export interface ChainClient {
  head(chain: ChainId): Promise<BlockRef>;
  /** Canonical hash at a height, or `null` past the head. Drives the reorg probe. */
  blockHash(chain: ChainId, number: bigint): Promise<string | null>;
  transfers(query: TransferQuery): Promise<TransferLog[]>;
  /** `PaymentCompleted` logs emitted by the router in the range. */
  settlements(query: SettlementQuery): Promise<SettlementLog[]>;
}

/**
 * Derives a deposit address from a BIP-32 index.
 *
 * A port so that secp256k1 and BIP-32 stay out of `core`. The implementation
 * holds a watch-only extended public key and cannot sign.
 */
export interface DepositAddressDeriver {
  derive(index: number): string;
}

/**
 * What the watcher calls once a payment is fully funded.
 *
 * A port rather than a direct dependency: `core/chain` must not import
 * `@mayarin/clearing`. The composition root wires this to
 * `ClearingEngine.recordAssetReceived`.
 */
export interface AssetReceiptSink {
  fund(clearingTransactionId: string): Promise<void>;
}

/**
 * What the indexer calls once a `PaymentCompleted` log is final.
 *
 * Takes the **on-chain** `intentId` rather than a clearing transaction id:
 * resolving one to the other means reading a clearing transaction, and
 * `core/chain` must not import `@mayarin/clearing`. The composition root does
 * the lookup and calls `ClearingEngine.recordPaymentCompleted`.
 *
 * Returns whether a payment was found, so the indexer can tell "settled" from
 * "this log belongs to no payment we know about" — which is a reconciliation
 * finding, not a no-op.
 */
export interface PaymentCompletionSink {
  complete(intentId: string, completion: PaymentCompletion): Promise<boolean>;
}

/**
 * What the chain says a settlement actually moved.
 *
 * Raw minor units, not `Money`: the chain layer reads a log and has no opinion
 * about which asset the deployment settles in. Naming the asset is the clearing
 * engine's job, and it already knows.
 *
 * Carried through rather than dropped because the quoted figures and the
 * settled ones can differ, and a payment where they do is the signal that a
 * route behaved unexpectedly. Booking the quote and discarding the truth is how
 * that signal disappears.
 */
export interface PaymentCompletion {
  readonly txHash: string;
  /** Paid to `merchantSafe`. */
  readonly settledAmount: bigint;
  /** Taken to the treasury. */
  readonly fee: bigint;
  /** Returned to `refundTo`. */
  readonly refundAmount: bigint;
}
