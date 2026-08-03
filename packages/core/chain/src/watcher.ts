/**
 * Wallet watcher.
 *
 * One `tick()` is one complete pass over one `(chain, asset)` pair: scan a
 * bounded block range for transfers to watched addresses, reclassify what is
 * already known against the current head, and fund any payment whose confirmed
 * deposits now cover what it is owed.
 *
 * Ordering matters in one place: the cursor is written last. A crash mid-pass
 * therefore re-scans its range rather than skipping it, and re-scanning is free
 * because deposits are keyed by `(chain, txHash, logIndex)`.
 *
 * Funding needs no guard of its own — `recordAssetReceived` returns early for a
 * transaction that is no longer PAYMENT_PENDING, so a second tick over a funded
 * address does nothing.
 */

import {
  type AssetCode,
  type Clock,
  type EventPublisher,
  type Money,
  noopEventPublisher,
} from "@mayarin/shared";
import type { AssetReceiptSink, ChainClient } from "./client.ts";
import { depositOrphanedEvent } from "./events.ts";
import {
  type ConfirmationPolicy,
  classifyDeposit,
  confirmationsOf,
  isWithinReorgWatch,
} from "./policy.ts";
import type {
  DepositAddressRepository,
  DepositRepository,
  DepositStatusUpdate,
  WatcherCursorRepository,
} from "./repository.ts";
import type { ChainId, Deposit, WatchedAddress } from "./types.ts";

export interface WalletWatcherOptions {
  readonly client: ChainClient;
  readonly addresses: DepositAddressRepository;
  readonly deposits: DepositRepository;
  readonly cursors: WatcherCursorRepository;
  readonly sink: AssetReceiptSink;
  readonly clock: Clock;
  readonly policy: ConfirmationPolicy;
  /** Maximum blocks scanned in one pass. Keeps `eth_getLogs` inside provider limits. */
  readonly blockRange: number;
  /** How long a terminal payment's address stays in the watch set. */
  readonly retentionSeconds: number;
  readonly events?: EventPublisher;
  /** Block to start from when a chain has no cursor yet. */
  readonly startBlocks?: Readonly<Partial<Record<ChainId, bigint>>>;
  /** Cap on deposits re-probed per pass. */
  readonly probeLimit?: number;
}

export interface TickResult {
  readonly chain: ChainId;
  readonly asset: AssetCode;
  readonly scannedFrom: bigint;
  readonly scannedTo: bigint;
  readonly recorded: number;
  readonly confirmed: number;
  readonly orphaned: number;
  readonly funded: number;
}

export class WalletWatcher {
  readonly #client: ChainClient;
  readonly #addresses: DepositAddressRepository;
  readonly #deposits: DepositRepository;
  readonly #cursors: WatcherCursorRepository;
  readonly #sink: AssetReceiptSink;
  readonly #clock: Clock;
  readonly #policy: ConfirmationPolicy;
  readonly #blockRange: bigint;
  readonly #retentionSeconds: number;
  readonly #events: EventPublisher;
  readonly #startBlocks: Readonly<Partial<Record<ChainId, bigint>>>;
  readonly #probeLimit: number;

  constructor(options: WalletWatcherOptions) {
    this.#client = options.client;
    this.#addresses = options.addresses;
    this.#deposits = options.deposits;
    this.#cursors = options.cursors;
    this.#sink = options.sink;
    this.#clock = options.clock;
    this.#policy = options.policy;
    this.#blockRange = BigInt(options.blockRange);
    this.#retentionSeconds = options.retentionSeconds;
    this.#events = options.events ?? noopEventPublisher;
    this.#startBlocks = options.startBlocks ?? {};
    this.#probeLimit = options.probeLimit ?? 500;
  }

  async tick(chain: ChainId, asset: AssetCode): Promise<TickResult> {
    const now = this.#clock.now();
    const head = await this.#client.head(chain);

    const cursor = await this.#cursors.get(chain, asset);
    const start = cursor ?? this.#startBlocks[chain] ?? 0n;
    const from = start + 1n;
    const to = min(head.number, start + this.#blockRange);
    // A reorg replaces blocks without advancing the head, so there can be
    // nothing new to scan and still be everything to reclassify. Only the scan
    // is skipped here — returning early would make the watcher blind to exactly
    // the case it exists to catch.
    const hasNewBlocks = from <= to;

    const watched = await this.#addresses.listWatched(chain, this.#retentionCutoff(now));

    const recorded = hasNewBlocks ? await this.#scan(chain, asset, from, to, watched, now) : 0;
    const { confirmed, orphaned } = await this.#reclassify(chain, head.number, watched, now);
    const funded = await this.#fund(chain, asset, watched);

    // Written last: a crash before this line re-scans the same range, which the
    // deposit key makes harmless.
    if (hasNewBlocks) await this.#cursors.set(chain, asset, to);

    return {
      chain,
      asset,
      scannedFrom: from,
      scannedTo: hasNewBlocks ? to : start,
      recorded,
      confirmed,
      orphaned,
      funded,
    };
  }

  async #scan(
    chain: ChainId,
    asset: AssetCode,
    fromBlock: bigint,
    toBlock: bigint,
    watched: readonly WatchedAddress[],
    now: Date,
  ): Promise<number> {
    const addresses = watched
      .filter((entry) => entry.asset === asset)
      .map((entry) => entry.address);
    if (addresses.length === 0) return 0;

    const logs = await this.#client.transfers({
      chain,
      asset,
      fromBlock,
      toBlock,
      addresses,
    });
    if (logs.length === 0) return 0;

    await this.#deposits.record(logs, now);
    return logs.length;
  }

  /** Re-reads canonical hashes and moves deposits between statuses. */
  async #reclassify(
    chain: ChainId,
    headNumber: bigint,
    watched: readonly WatchedAddress[],
    now: Date,
  ): Promise<{ confirmed: number; orphaned: number }> {
    const probable = await this.#deposits.listProbable(chain, this.#probeLimit);
    const inWatch = probable.filter((deposit) =>
      isWithinReorgWatch(confirmationsOf(deposit.blockNumber, headNumber), this.#policy),
    );
    if (inWatch.length === 0) return { confirmed: 0, orphaned: 0 };

    // One probe per distinct height: N deposits in one block cost one call.
    const hashes = new Map<bigint, string | null>();
    for (const deposit of inWatch) {
      if (hashes.has(deposit.blockNumber)) continue;
      hashes.set(deposit.blockNumber, await this.#client.blockHash(chain, deposit.blockNumber));
    }

    const updates: DepositStatusUpdate[] = [];
    const orphans: Deposit[] = [];

    for (const deposit of inWatch) {
      const next = classifyDeposit({
        current: deposit.status,
        blockNumber: deposit.blockNumber,
        blockHash: deposit.blockHash,
        headNumber,
        canonicalHash: hashes.get(deposit.blockNumber) ?? undefined,
        policy: this.#policy,
      });

      if (next === deposit.status) continue;
      updates.push({ id: deposit.id, status: next, at: now });
      if (next === "ORPHANED") orphans.push(deposit);
    }

    if (updates.length > 0) await this.#deposits.updateStatuses(updates);

    await this.#publishOrphans(orphans, watched, now);

    return {
      confirmed: updates.filter((update) => update.status === "CONFIRMED").length,
      orphaned: updates.filter((update) => update.status === "ORPHANED").length,
    };
  }

  async #publishOrphans(
    orphans: readonly Deposit[],
    watched: readonly WatchedAddress[],
    now: Date,
  ): Promise<void> {
    if (orphans.length === 0) return;

    const owners = new Map(watched.map((entry) => [entry.address, entry.clearingTransactionId]));
    const events = orphans.flatMap((deposit) => {
      const owner = owners.get(deposit.address);
      return owner === undefined ? [] : [depositOrphanedEvent(deposit, owner, now)];
    });

    if (events.length > 0) await this.#events.publish(events);
  }

  async #fund(
    chain: ChainId,
    asset: AssetCode,
    watched: readonly WatchedAddress[],
  ): Promise<number> {
    let funded = 0;

    for (const entry of watched) {
      if (!entry.fundable || entry.asset !== asset) continue;

      const total = await this.#deposits.confirmedTotal(chain, entry.address, asset);
      if (!covers(total, entry.requiredAmount)) continue;

      await this.#sink.fund(entry.clearingTransactionId);
      funded += 1;
    }

    return funded;
  }

  #retentionCutoff(now: Date): Date {
    return new Date(now.getTime() - this.#retentionSeconds * 1_000);
  }
}

/** Accumulate-and-confirm: the total must reach what is owed, not equal it. */
function covers(total: Money, required: Money): boolean {
  return total.asset === required.asset && total.amount >= required.amount;
}

function min(a: bigint, b: bigint): bigint {
  return a < b ? a : b;
}
