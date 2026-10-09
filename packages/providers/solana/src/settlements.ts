import { createHash } from "node:crypto";
import type {
  BlockRef,
  ChainId,
  SettlementChainClient,
  SettlementLog,
  SettlementQuery,
} from "@mayarin/chain";
import { Connection, PublicKey } from "@solana/web3.js";
import { intentIdToHex } from "./order.ts";

const EVENT_DISCRIMINATOR = createHash("sha256")
  .update("event:PaymentCompleted")
  .digest()
  .subarray(0, 8);

export function createSolanaConnection(rpcUrl: string): Connection {
  return new Connection(rpcUrl, "confirmed");
}

function readU64(bytes: Uint8Array, offset: number): bigint {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getBigUint64(offset, true);
}

export type SolanaConnection = Connection;

export function decodePaymentCompleted(bytes: Uint8Array):
  | {
      readonly intentId: string;
      readonly merchant: string;
      readonly settledAmount: bigint;
      readonly fee: bigint;
      readonly refundAmount: bigint;
    }
  | undefined {
  if (bytes.length !== 240 || !Buffer.from(bytes.subarray(0, 8)).equals(EVENT_DISCRIMINATOR)) {
    return undefined;
  }
  return {
    intentId: intentIdToHex(bytes.subarray(8, 40)),
    merchant: new PublicKey(bytes.subarray(72, 104)).toBase58(),
    settledAmount: readU64(bytes, 208),
    fee: readU64(bytes, 216),
    refundAmount: readU64(bytes, 224),
  };
}

export function paymentCompletedFromLogs(logs: readonly string[]):
  | {
      readonly intentId: string;
      readonly merchant: string;
      readonly settledAmount: bigint;
      readonly fee: bigint;
      readonly refundAmount: bigint;
    }
  | undefined {
  return logs.flatMap((line) => {
    const bytes = eventData(line);
    const decoded = bytes === undefined ? undefined : decodePaymentCompleted(bytes);
    return decoded === undefined ? [] : [decoded];
  })[0];
}

function eventData(log: string): Uint8Array | undefined {
  const prefix = "Program data: ";
  if (!log.startsWith(prefix)) return undefined;
  try {
    return Uint8Array.from(Buffer.from(log.slice(prefix.length), "base64"));
  } catch {
    return undefined;
  }
}

export class SolanaSettlementClient implements SettlementChainClient {
  readonly #connection: Connection;

  constructor(connection: Connection) {
    this.#connection = connection;
  }

  async head(_chain: ChainId): Promise<BlockRef> {
    const number = await this.#connection.getSlot("confirmed");
    const block = await this.#connection.getBlock(number, {
      commitment: "confirmed",
      transactionDetails: "none",
      rewards: false,
      maxSupportedTransactionVersion: 0,
    });
    return { number: BigInt(number), hash: block?.blockhash ?? "" };
  }

  async blockHash(_chain: ChainId, number: bigint): Promise<string | null> {
    const block = await this.#connection.getBlock(Number(number), {
      commitment: "confirmed",
      transactionDetails: "none",
      rewards: false,
      maxSupportedTransactionVersion: 0,
    });
    return block?.blockhash ?? null;
  }

  async settlements(query: SettlementQuery): Promise<SettlementLog[]> {
    const router = new PublicKey(query.router);
    const signatures = await this.#signaturesInRange(router, query.fromBlock, query.toBlock);
    const logs: SettlementLog[] = [];
    for (const signature of signatures) {
      const transaction = await this.#connection.getTransaction(signature.signature, {
        commitment: "confirmed",
        maxSupportedTransactionVersion: 0,
      });
      if (transaction === null || transaction.meta?.err !== null) continue;
      const blockHash = await this.#confirmedBlockHash(signature.slot);
      for (const [index, line] of (transaction.meta?.logMessages ?? []).entries()) {
        const bytes = eventData(line);
        const event = bytes === undefined ? undefined : decodePaymentCompleted(bytes);
        if (event === undefined) continue;
        logs.push({
          chain: query.chain,
          txHash: signature.signature,
          logIndex: index,
          blockNumber: BigInt(signature.slot),
          blockHash,
          intentId: event.intentId,
          merchantSafe: event.merchant,
          settledAmount: event.settledAmount,
          fee: event.fee,
          refundAmount: event.refundAmount,
        });
      }
    }
    return logs;
  }

  async #signaturesInRange(
    router: PublicKey,
    fromBlock: bigint,
    toBlock: bigint,
  ): Promise<readonly { readonly signature: string; readonly slot: number }[]> {
    const found: { signature: string; slot: number }[] = [];
    let before: string | undefined;
    for (;;) {
      const page = await this.#connection.getSignaturesForAddress(
        router,
        { ...(before === undefined ? {} : { before }), limit: 1_000 },
        "confirmed",
      );
      for (const entry of page) {
        const slot = BigInt(entry.slot);
        if (slot >= fromBlock && slot <= toBlock && entry.err === null) found.push(entry);
      }
      const last = page.at(-1);
      if (last === undefined || page.length < 1_000 || BigInt(last.slot) < fromBlock) break;
      before = last.signature;
    }
    return found;
  }

  async #confirmedBlockHash(slot: number): Promise<string> {
    for (let attempt = 0; attempt < 20; attempt++) {
      const block = await this.#connection.getBlock(slot, {
        commitment: "confirmed",
        transactionDetails: "none",
        rewards: false,
        maxSupportedTransactionVersion: 0,
      });
      if (block !== null) return block.blockhash;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(`confirmed Solana block ${slot} is not available from RPC`);
  }
}
