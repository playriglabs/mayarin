/**
 * In-memory chain repositories.
 *
 * They enforce the same invariants as the Postgres adapters — one address per
 * clearing transaction, one deposit row per `(chain, txHash, logIndex)` — so a
 * test that passes here is not passing for the wrong reason.
 */

import type {
  AllocateDepositAddress,
  ChainId,
  Deposit,
  DepositAddress,
  DepositAddressRepository,
  DepositRepository,
  DepositStatusUpdate,
  TransferLog,
  WatchedAddress,
  WatcherCursorRepository,
} from "@mayarin/chain";
import { type AssetCode, generateId, type Money, zero } from "@mayarin/shared";

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

  async get(chain: ChainId, asset: AssetCode): Promise<bigint | null> {
    return this.#cursors.get(`${chain}/${asset}`) ?? null;
  }

  async set(chain: ChainId, asset: AssetCode, block: bigint): Promise<void> {
    this.#cursors.set(`${chain}/${asset}`, block);
  }
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
