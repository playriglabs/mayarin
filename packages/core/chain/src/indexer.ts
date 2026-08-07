/**
 * Settlement indexer (RFC #8).
 *
 * One `tick()` is one complete pass over one chain's `PaymentRouter`: scan a
 * bounded block range for `PaymentCompleted` logs, reclassify what is already
 * known against the current head, and complete any payment whose settlement is
 * now past the confirmation depth.
 *
 * **Why this is not a Ponder deployment.** The argument against an indexer in
 * `docs/chain.md` was about deposit addresses: they are derived continuously
 * off-chain, so no static filter covers them and indexing every `Transfer` on a
 * token means backfilling millions to find the tens that matter. None of that
 * holds here. The router is **one known address** emitting **one event**, so a
 * pass is `eth_blockNumber`, one cursor-bounded `eth_getLogs`, and
 * `eth_getBlockByNumber` for the reorg probe — the same three calls the wallet
 * watcher already makes. A separate service with its own datastore would add
 * infrastructure without adding capability, and would put the reorg policy in
 * two places.
 *
 * Three properties, shared with the wallet watcher and for the same reasons:
 *
 * - **The cursor is written last.** A crash mid-pass re-scans its range rather
 *   than skipping it, and re-scanning is free because settlements are keyed by
 *   `(chain, txHash, logIndex)` — the key the log envelope itself provides.
 * - **Confirmation depth is the finality line.** A settlement below it has told
 *   the engine nothing and can vanish freely. Only at depth does it complete a
 *   payment. Settling at one confirmation would mean a reorg could unsettle a
 *   payment the merchant has already been told about.
 * - **A reorg after completion is recorded, never reversed.** `SETTLED →
 *   unsettled` is not a legal transition, and by then the merchant has been paid
 *   on-chain. It is published for a human, like an orphaned-after-confirmed
 *   deposit.
 *
 * Completion is at-most-once by `completedAt`, and idempotent underneath
 * anyway: `recordPaymentCompleted` returns early for a transaction that is no
 * longer `PAYMENT_PENDING`.
 */

import { type Clock, type EventPublisher, noopEventPublisher } from "@mayarin/shared";
import type { ChainClient, PaymentCompletionSink } from "./client.ts";
import { settlementOrphanedEvent, settlementUnmatchedEvent } from "./events.ts";
import {
  type ConfirmationPolicy,
  classifyDeposit,
  confirmationsOf,
  isWithinReorgWatch,
} from "./policy.ts";
import type {
  SettlementEventRepository,
  SettlementStatusUpdate,
  WatcherCursorRepository,
} from "./repository.ts";
import type { ChainId, SettlementEvent } from "./types.ts";

export interface SettlementIndexerOptions {
  readonly client: ChainClient;
  readonly settlements: SettlementEventRepository;
  readonly cursors: WatcherCursorRepository;
  readonly sink: PaymentCompletionSink;
  readonly clock: Clock;
  readonly policy: ConfirmationPolicy;
  /** Deployed `PaymentRouter` per chain. A chain without one is not scanned. */
  readonly routers: Readonly<Partial<Record<ChainId, string>>>;
  /** Maximum blocks scanned in one pass. Keeps `eth_getLogs` inside provider limits. */
  readonly blockRange: number;
  readonly events?: EventPublisher;
  /** Block to start from when a chain has no cursor yet. */
  readonly startBlocks?: Readonly<Partial<Record<ChainId, bigint>>>;
  /** Cap on settlements re-probed per pass. */
  readonly probeLimit?: number;
}

export interface IndexerTickResult {
  readonly chain: ChainId;
  readonly scannedFrom: bigint;
  readonly scannedTo: bigint;
  readonly recorded: number;
  readonly confirmed: number;
  readonly orphaned: number;
  readonly completed: number;
  /** Confirmed logs that matched no known payment — a reconciliation finding. */
  readonly unmatched: number;
}

export class SettlementIndexer {
  readonly #client: ChainClient;
  readonly #settlements: SettlementEventRepository;
  readonly #cursors: WatcherCursorRepository;
  readonly #sink: PaymentCompletionSink;
  readonly #clock: Clock;
  readonly #policy: ConfirmationPolicy;
  readonly #routers: Readonly<Partial<Record<ChainId, string>>>;
  readonly #blockRange: bigint;
  readonly #events: EventPublisher;
  readonly #startBlocks: Readonly<Partial<Record<ChainId, bigint>>>;
  readonly #probeLimit: number;

  constructor(options: SettlementIndexerOptions) {
    this.#client = options.client;
    this.#settlements = options.settlements;
    this.#cursors = options.cursors;
    this.#sink = options.sink;
    this.#clock = options.clock;
    this.#policy = options.policy;
    this.#routers = options.routers;
    this.#blockRange = BigInt(options.blockRange);
    this.#events = options.events ?? noopEventPublisher;
    this.#startBlocks = options.startBlocks ?? {};
    this.#probeLimit = options.probeLimit ?? 500;
  }

  async tick(chain: ChainId): Promise<IndexerTickResult> {
    const router = this.#routers[chain];
    if (router === undefined) {
      throw new Error(`No PaymentRouter configured on ${chain}`);
    }

    const now = this.#clock.now();
    const head = await this.#client.head(chain);

    const cursor = await this.#cursors.get(chain, router);
    const start = cursor ?? this.#startBlocks[chain] ?? 0n;
    const from = start + 1n;
    const to = min(head.number, start + this.#blockRange);
    // A reorg replaces blocks without advancing the head, so there can be
    // nothing new to scan and still be everything to reclassify. Only the scan
    // is skipped — returning early would make the indexer blind to exactly the
    // case it exists to catch.
    const hasNewBlocks = from <= to;

    const recorded = hasNewBlocks ? await this.#scan(chain, router, from, to, now) : 0;
    const { confirmed, orphaned } = await this.#reclassify(chain, head.number, now);
    const { completed, unmatched } = await this.#complete(chain, now);

    // Written last: a crash before this line re-scans the same range, which the
    // log key makes harmless.
    if (hasNewBlocks) await this.#cursors.set(chain, router, to);

    return {
      chain,
      scannedFrom: from,
      scannedTo: hasNewBlocks ? to : start,
      recorded,
      confirmed,
      orphaned,
      completed,
      unmatched,
    };
  }

  async #scan(
    chain: ChainId,
    router: string,
    fromBlock: bigint,
    toBlock: bigint,
    now: Date,
  ): Promise<number> {
    const logs = await this.#client.settlements({ chain, router, fromBlock, toBlock });
    if (logs.length === 0) return 0;

    await this.#settlements.record(logs, now);
    return logs.length;
  }

  /** Re-reads canonical hashes and moves settlements between statuses. */
  async #reclassify(
    chain: ChainId,
    headNumber: bigint,
    now: Date,
  ): Promise<{ confirmed: number; orphaned: number }> {
    const probable = await this.#settlements.listProbable(chain, this.#probeLimit);
    const inWatch = probable.filter((event) =>
      isWithinReorgWatch(confirmationsOf(event.blockNumber, headNumber), this.#policy),
    );
    if (inWatch.length === 0) return { confirmed: 0, orphaned: 0 };

    // One probe per distinct height: N settlements in one block cost one call.
    const hashes = new Map<bigint, string | null>();
    for (const event of inWatch) {
      if (hashes.has(event.blockNumber)) continue;
      hashes.set(event.blockNumber, await this.#client.blockHash(chain, event.blockNumber));
    }

    const updates: SettlementStatusUpdate[] = [];
    const orphans: SettlementEvent[] = [];

    for (const event of inWatch) {
      const next = classifyDeposit({
        current: event.status,
        blockNumber: event.blockNumber,
        blockHash: event.blockHash,
        headNumber,
        canonicalHash: hashes.get(event.blockNumber) ?? undefined,
        policy: this.#policy,
      });

      if (next === event.status) continue;
      updates.push({ id: event.id, status: next, at: now });
      if (next === "ORPHANED") orphans.push(event);
    }

    if (updates.length > 0) await this.#settlements.updateStatuses(updates);

    if (orphans.length > 0) {
      await this.#events.publish(orphans.map((event) => settlementOrphanedEvent(event, now)));
    }

    return {
      confirmed: updates.filter((update) => update.status === "CONFIRMED").length,
      orphaned: updates.filter((update) => update.status === "ORPHANED").length,
    };
  }

  /** Tells the engine about settlements that are past the depth and not yet handed over. */
  async #complete(chain: ChainId, now: Date): Promise<{ completed: number; unmatched: number }> {
    const completable = await this.#settlements.listCompletable(chain, this.#probeLimit);

    let completed = 0;
    let unmatched = 0;
    for (const event of completable) {
      const matched = await this.#sink.complete(event.intentId, { txHash: event.txHash });
      // Marked either way. An unmatched log is not a transient miss to retry —
      // the router only emits `PaymentCompleted` for an `intentId` this backend
      // signed, so no match means the two records disagree, and repeating the
      // lookup every pass would bury the finding rather than surface it.
      await this.#settlements.markCompleted(event.id, now);
      if (matched) {
        completed++;
      } else {
        unmatched++;
        await this.#events.publish([settlementUnmatchedEvent(event, now)]);
      }
    }

    return { completed, unmatched };
  }
}

function min(a: bigint, b: bigint): bigint {
  return a < b ? a : b;
}
