/**
 * Scriptable in-memory chain.
 *
 * Models a reorg the way a chain does: blocks past the fork point are replaced
 * by new blocks with new hashes, and the transfers that were only in the
 * replaced blocks are gone. A fake that merely renumbered blocks would let
 * reorg tests pass without the policy ever being exercised.
 */

import type { BlockRef, ChainClient, ChainId, TransferLog, TransferQuery } from "@mayarin/chain";
import type { AssetCode } from "@mayarin/shared";

interface PendingTransfer {
  readonly asset: AssetCode;
  readonly from: string;
  readonly to: string;
  readonly amount: bigint;
}

interface Block {
  readonly number: bigint;
  readonly hash: string;
  readonly transfers: readonly PendingTransfer[];
}

export interface FakeTransferInput {
  readonly asset: AssetCode;
  readonly to: string;
  readonly amount: bigint;
  readonly from?: string;
}

const DEFAULT_SENDER = "0x00000000000000000000000000000000000000ff";

export class FakeChainClient implements ChainClient {
  readonly #blocks: Block[] = [];
  #pending: PendingTransfer[] = [];
  #epoch = 0;

  /** Queues a transfer for the next mined block. */
  transfer(input: FakeTransferInput): this {
    this.#pending.push({
      asset: input.asset,
      from: input.from ?? DEFAULT_SENDER,
      to: input.to.toLowerCase(),
      amount: input.amount,
    });
    return this;
  }

  /** Mines `count` blocks; queued transfers all land in the first of them. */
  mine(count = 1): this {
    for (let i = 0; i < count; i += 1) {
      const number = BigInt(this.#blocks.length + 1);
      this.#blocks.push({
        number,
        hash: this.#hashFor(number),
        transfers: this.#pending,
      });
      this.#pending = [];
    }
    return this;
  }

  /**
   * Replaces the top `depth` blocks with fresh empty ones at the same heights.
   * Bumping the epoch is what changes their hashes.
   */
  reorg({ depth }: { depth: number }): this {
    const keep = Math.max(0, this.#blocks.length - depth);
    const replaced = this.#blocks.length - keep;
    this.#blocks.length = keep;
    this.#epoch += 1;
    for (let i = 0; i < replaced; i += 1) {
      const number = BigInt(this.#blocks.length + 1);
      this.#blocks.push({ number, hash: this.#hashFor(number), transfers: [] });
    }
    return this;
  }

  async head(_chain: ChainId): Promise<BlockRef> {
    const last = this.#blocks.at(-1);
    if (last === undefined) return { number: 0n, hash: this.#hashFor(0n) };
    return { number: last.number, hash: last.hash };
  }

  async blockHash(_chain: ChainId, number: bigint): Promise<string | null> {
    const block = this.#blocks.find((candidate) => candidate.number === number);
    return block?.hash ?? null;
  }

  async transfers(query: TransferQuery): Promise<TransferLog[]> {
    if (query.addresses.length === 0) return [];
    const wanted = new Set(query.addresses.map((address) => address.toLowerCase()));
    const logs: TransferLog[] = [];

    for (const block of this.#blocks) {
      if (block.number < query.fromBlock || block.number > query.toBlock) continue;

      block.transfers.forEach((transfer, logIndex) => {
        if (transfer.asset !== query.asset) return;
        if (!wanted.has(transfer.to)) return;
        logs.push({
          chain: query.chain,
          asset: transfer.asset,
          txHash: `0xtx${block.number}-${logIndex}-${this.#epoch}`,
          logIndex,
          blockNumber: block.number,
          blockHash: block.hash,
          from: transfer.from,
          to: transfer.to,
          amount: transfer.amount,
        });
      });
    }

    return logs;
  }

  #hashFor(number: bigint): string {
    return `0xblock-${number}-epoch-${this.#epoch}`;
  }
}
