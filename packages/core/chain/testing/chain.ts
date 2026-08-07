/**
 * In-memory chain repositories.
 *
 * They enforce the same invariants as the Postgres adapters — one address per
 * clearing transaction, one deposit row per `(chain, txHash, logIndex)` — so a
 * test that passes here is not passing for the wrong reason.
 */

import { type AssetCode, generateId, type Money, zero } from "@mayarin/shared";
import type {
  AllocateDepositAddress,
  ChainId,
  Deposit,
  DepositAddress,
  DepositAddressRepository,
  DepositRepository,
  DepositStatusUpdate,
  SettlementEvent,
  SettlementEventRepository,
  SettlementLog,
  SettlementStatusUpdate,
  TransferLog,
  WatchedAddress,
  WatcherCursorRepository,
} from "../src/index.ts";

/** What the address repository needs to know about a clearing transaction. */
export interface WatchedTransactionState {
  readonly fundable: boolean;
  readonly requiredAmount: Money;
  /** Set once the transaction is terminal. */
  readonly terminalAt?: Date;
}

export type ResolveWatchedTransaction = (
  clearingTransactionId: string,
) => WatchedTransactionState | undefined;

export class InMemoryDepositAddressRepository implements DepositAddressRepository {
  readonly #byTransaction = new Map<string, DepositAddress>();
  readonly #resolve: ResolveWatchedTransaction;
  #nextIndex = 0;

  constructor(resolve: ResolveWatchedTransaction = () => undefined) {
    this.#resolve = resolve;
  }

  async allocate(input: AllocateDepositAddress): Promise<DepositAddress> {
    const existing = this.#byTransaction.get(input.clearingTransactionId);
    if (existing !== undefined) return existing;

    const derivationIndex = this.#nextIndex;
    this.#nextIndex += 1;

    const address: DepositAddress = {
      id: generateId("dad", input.now.getTime()),
      clearingTransactionId: input.clearingTransactionId,
      derivationIndex,
      chain: input.chain,
      asset: input.asset,
      address: input.deriver.derive(derivationIndex).toLowerCase(),
      createdAt: new Date(input.now),
    };

    this.#byTransaction.set(input.clearingTransactionId, address);
    return address;
  }

  async findByClearingTransactionId(clearingTransactionId: string): Promise<DepositAddress | null> {
    return this.#byTransaction.get(clearingTransactionId) ?? null;
  }

  async listWatched(chain: ChainId, retainTerminalSince: Date): Promise<WatchedAddress[]> {
    const watched: WatchedAddress[] = [];

    for (const address of this.#byTransaction.values()) {
      if (address.chain !== chain) continue;

      const state = this.#resolve(address.clearingTransactionId);
      if (state === undefined) continue;
      // Terminal and older than the retention cutoff: stop scanning for it.
      if (state.terminalAt !== undefined && state.terminalAt < retainTerminalSince) continue;

      watched.push({
        clearingTransactionId: address.clearingTransactionId,
        chain: address.chain,
        asset: address.asset,
        address: address.address,
        requiredAmount: state.requiredAmount,
        fundable: state.fundable,
      });
    }

    return watched;
  }
}

export class InMemoryDepositRepository implements DepositRepository {
  readonly #byKey = new Map<string, Deposit>();

  async record(transfers: readonly TransferLog[], now: Date): Promise<Deposit[]> {
    const recorded: Deposit[] = [];

    for (const transfer of transfers) {
      const key = depositKey(transfer.chain, transfer.txHash, transfer.logIndex);
      const existing = this.#byKey.get(key);
      if (existing !== undefined) {
        recorded.push(existing);
        continue;
      }

      const deposit: Deposit = {
        id: generateId("dep", now.getTime()),
        chain: transfer.chain,
        txHash: transfer.txHash,
        logIndex: transfer.logIndex,
        address: transfer.to.toLowerCase(),
        amount: { amount: transfer.amount, asset: transfer.asset },
        blockNumber: transfer.blockNumber,
        blockHash: transfer.blockHash,
        status: "PENDING",
        firstSeenAt: new Date(now),
      };

      this.#byKey.set(key, deposit);
      recorded.push(deposit);
    }

    return recorded;
  }

  async listProbable(chain: ChainId, limit: number): Promise<Deposit[]> {
    return [...this.#byKey.values()]
      .filter((deposit) => deposit.chain === chain && deposit.status !== "ORPHANED")
      .sort((a, b) => (a.blockNumber < b.blockNumber ? -1 : a.blockNumber > b.blockNumber ? 1 : 0))
      .slice(0, limit);
  }

  async updateStatuses(updates: readonly DepositStatusUpdate[]): Promise<void> {
    for (const update of updates) {
      for (const [key, deposit] of this.#byKey) {
        if (deposit.id !== update.id) continue;
        this.#byKey.set(key, applyStatus(deposit, update));
        break;
      }
    }
  }

  async listByAddress(chain: ChainId, address: string): Promise<Deposit[]> {
    const wanted = address.toLowerCase();
    return [...this.#byKey.values()].filter(
      (deposit) => deposit.chain === chain && deposit.address === wanted,
    );
  }

  async confirmedTotal(chain: ChainId, address: string, asset: AssetCode): Promise<Money> {
    const deposits = await this.listByAddress(chain, address);
    return deposits
      .filter((deposit) => deposit.status === "CONFIRMED" && deposit.amount.asset === asset)
      .reduce<Money>(
        (total, deposit) => ({ amount: total.amount + deposit.amount.amount, asset }),
        zero(asset),
      );
  }
}

export class InMemoryWatcherCursorRepository implements WatcherCursorRepository {
  readonly #cursors = new Map<string, bigint>();

  async get(chain: ChainId, stream: string): Promise<bigint | null> {
    return this.#cursors.get(`${chain}/${stream}`) ?? null;
  }

  async set(chain: ChainId, stream: string, block: bigint): Promise<void> {
    this.#cursors.set(`${chain}/${stream}`, block);
  }
}

/**
 * Enforces the same two invariants the Postgres adapter does: one row per
 * `(chain, txHash, logIndex)`, and a completion that is recorded once.
 */
export class InMemorySettlementEventRepository implements SettlementEventRepository {
  readonly #byKey = new Map<string, SettlementEvent>();

  async record(logs: readonly SettlementLog[], now: Date): Promise<SettlementEvent[]> {
    const recorded: SettlementEvent[] = [];

    for (const log of logs) {
      const key = `${log.chain}/${log.txHash}/${log.logIndex}`;
      const existing = this.#byKey.get(key);
      if (existing !== undefined) {
        recorded.push(existing);
        continue;
      }

      const event: SettlementEvent = {
        id: generateId("stl", now.getTime()),
        chain: log.chain,
        txHash: log.txHash,
        logIndex: log.logIndex,
        blockNumber: log.blockNumber,
        blockHash: log.blockHash,
        intentId: log.intentId,
        merchantSafe: log.merchantSafe,
        settledAmount: log.settledAmount,
        fee: log.fee,
        refundAmount: log.refundAmount,
        status: "PENDING",
        firstSeenAt: new Date(now),
      };

      this.#byKey.set(key, event);
      recorded.push(event);
    }

    return recorded;
  }

  async listProbable(chain: ChainId, limit: number): Promise<SettlementEvent[]> {
    return this.#sorted(chain, (event) => event.status !== "ORPHANED").slice(0, limit);
  }

  async updateStatuses(updates: readonly SettlementStatusUpdate[]): Promise<void> {
    for (const update of updates) {
      for (const [key, event] of this.#byKey) {
        if (event.id !== update.id) continue;
        this.#byKey.set(key, applySettlementStatus(event, update));
        break;
      }
    }
  }

  async listCompletable(chain: ChainId, limit: number): Promise<SettlementEvent[]> {
    return this.#sorted(
      chain,
      (event) => event.status === "CONFIRMED" && event.completedAt === undefined,
    ).slice(0, limit);
  }

  async markCompleted(id: string, at: Date): Promise<void> {
    for (const [key, event] of this.#byKey) {
      if (event.id !== id) continue;
      this.#byKey.set(key, { ...event, completedAt: new Date(at) });
      return;
    }
  }

  async findByIntentId(intentId: string): Promise<SettlementEvent | null> {
    return [...this.#byKey.values()].find((event) => event.intentId === intentId) ?? null;
  }

  #sorted(chain: ChainId, keep: (event: SettlementEvent) => boolean): SettlementEvent[] {
    return [...this.#byKey.values()]
      .filter((event) => event.chain === chain && keep(event))
      .sort((a, b) => (a.blockNumber < b.blockNumber ? -1 : a.blockNumber > b.blockNumber ? 1 : 0));
  }
}

function applySettlementStatus(
  event: SettlementEvent,
  update: SettlementStatusUpdate,
): SettlementEvent {
  return {
    ...event,
    status: update.status,
    ...(update.status === "CONFIRMED" ? { confirmedAt: new Date(update.at) } : {}),
    ...(update.status === "ORPHANED" ? { orphanedAt: new Date(update.at) } : {}),
  };
}

function depositKey(chain: ChainId, txHash: string, logIndex: number): string {
  return `${chain}:${txHash}:${logIndex}`;
}

/**
 * Status timestamps accumulate rather than replace: a deposit that was
 * confirmed and then orphaned keeps both, and that pair is how an
 * orphaned-after-confirmed deposit is identified.
 */
function applyStatus(deposit: Deposit, update: DepositStatusUpdate): Deposit {
  return {
    ...deposit,
    status: update.status,
    ...(update.status === "CONFIRMED" ? { confirmedAt: new Date(update.at) } : {}),
    ...(update.status === "ORPHANED" ? { orphanedAt: new Date(update.at) } : {}),
  };
}
