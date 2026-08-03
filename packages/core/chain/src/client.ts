/**
 * Chain ports.
 *
 * Three narrow interfaces, deliberately: reading the chain, deriving an
 * address, and telling something that money arrived. Keeping them apart is what
 * lets `core/chain` stay free of both viem and the clearing engine.
 */

import type { AssetCode } from "@mayarin/shared";
import type { BlockRef, ChainId, TransferLog } from "./types.ts";

export interface TransferQuery {
  readonly chain: ChainId;
  readonly asset: AssetCode;
  readonly fromBlock: bigint;
  readonly toBlock: bigint;
  /** Only transfers *to* these addresses. Empty means the query is skipped. */
  readonly addresses: readonly string[];
}

export interface ChainClient {
  head(chain: ChainId): Promise<BlockRef>;
  /** Canonical hash at a height, or `null` past the head. Drives the reorg probe. */
  blockHash(chain: ChainId, number: bigint): Promise<string | null>;
  transfers(query: TransferQuery): Promise<TransferLog[]>;
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
