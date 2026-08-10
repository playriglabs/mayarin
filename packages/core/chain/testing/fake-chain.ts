/**
 * Scriptable in-memory chain.
 *
 * Models a reorg the way a chain does: blocks past the fork point are replaced
 * by new blocks with new hashes, and the transfers that were only in the
 * replaced blocks are gone. A fake that merely renumbered blocks would let
 * reorg tests pass without the policy ever being exercised.
 */

import type { AssetCode } from "@mayarin/shared";
import type {
  BalanceQuery,
  BlockRef,
  ChainClient,
  ChainId,
  NativeBalance,
  SettlementLog,
  SettlementQuery,
  TransferLog,
  TransferQuery,
} from "../src/index.ts";

interface PendingTransfer {
  readonly asset: AssetCode;
  readonly from: string;
  readonly to: string;
  readonly amount: bigint;
}

interface PendingSettlement {
  readonly intentId: string;
  readonly merchantSafe: string;
  readonly settledAmount: bigint;
  readonly fee: bigint;
  readonly refundAmount: bigint;
}

interface Block {
  readonly number: bigint;
  readonly hash: string;
  readonly transfers: readonly PendingTransfer[];
  readonly settlements: readonly PendingSettlement[];
}

export interface FakeTransferInput {
  readonly asset: AssetCode;
  readonly to: string;
  readonly amount: bigint;
  readonly from?: string;
}

export interface FakeSettlementInput {
  readonly intentId: string;
  readonly merchantSafe?: string;
  readonly settledAmount?: bigint;
  readonly fee?: bigint;
  readonly refundAmount?: bigint;
}

const DEFAULT_SENDER = "0x00000000000000000000000000000000000000ff";
const DEFAULT_MERCHANT_SAFE = "0x00000000000000000000000000000000000000aa";

export class FakeChainClient implements ChainClient {
  readonly #blocks: Block[] = [];
  #pending: PendingTransfer[] = [];
  #pendingSettlements: PendingSettlement[] = [];
  /** Value that arrived without a visible transfer, per address. */
  readonly #internal = new Map<string, bigint>();
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

  /**
   * Credits an address without a transfer anyone can see.
   *
   * What an internal transaction looks like from the outside: the balance is
   * there, and no block body mentions it. This is how a smart-contract wallet
   * pays, so it is how the balance path has to be exercised.
   */
  creditInternally(address: string, amount: bigint): this {
    const key = address.toLowerCase();
    this.#internal.set(key, (this.#internal.get(key) ?? 0n) + amount);
    return this;
  }

  /** Queues a `PaymentCompleted` for the next mined block. */
  settle(input: FakeSettlementInput): this {
    this.#pendingSettlements.push({
      intentId: input.intentId,
      merchantSafe: input.merchantSafe ?? DEFAULT_MERCHANT_SAFE,
      settledAmount: input.settledAmount ?? 2_990_000n,
      fee: input.fee ?? 10_000n,
      refundAmount: input.refundAmount ?? 0n,
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
        settlements: this.#pendingSettlements,
      });
      this.#pending = [];
      this.#pendingSettlements = [];
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
      this.#blocks.push({
        number,
        hash: this.#hashFor(number),
        transfers: [],
        settlements: [],
      });
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

  async nativeBalances(query: BalanceQuery): Promise<NativeBalance[]> {
    if (query.addresses.length === 0) return [];
    const block = this.#blocks.find((candidate) => candidate.number === query.block);
    if (block === undefined) return [];

    return query.addresses.map((address) => {
      const key = address.toLowerCase();
      // A balance is everything that landed however it landed: the transfers a
      // block body shows plus whatever arrived internally.
      const visible = this.#blocks
        .filter((candidate) => candidate.number <= query.block)
        .flatMap((candidate) => candidate.transfers)
        .filter((transfer) => transfer.to === key && transfer.asset === query.asset)
        .reduce((total, transfer) => total + transfer.amount, 0n);

      return {
        address: key,
        amount: visible + (this.#internal.get(key) ?? 0n),
        blockNumber: block.number,
        blockHash: block.hash,
      };
    });
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

  async settlements(query: SettlementQuery): Promise<SettlementLog[]> {
    const logs: SettlementLog[] = [];

    for (const block of this.#blocks) {
      if (block.number < query.fromBlock || block.number > query.toBlock) continue;

      block.settlements.forEach((settlement, logIndex) => {
        logs.push({
          chain: query.chain,
          txHash: `0xstl${block.number}-${logIndex}-${this.#epoch}`,
          logIndex,
          blockNumber: block.number,
          blockHash: block.hash,
          intentId: settlement.intentId,
          merchantSafe: settlement.merchantSafe,
          settledAmount: settlement.settledAmount,
          fee: settlement.fee,
          refundAmount: settlement.refundAmount,
        });
      });
    }

    return logs;
  }

  #hashFor(number: bigint): string {
    return `0xblock-${number}-epoch-${this.#epoch}`;
  }
}
