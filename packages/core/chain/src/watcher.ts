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
import type { ChainId, Deposit, TransferLog, WatchedAddress } from "./types.ts";

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
  /**
   * The same bound for the chain's own currency, which is scanned differently
   * and costs differently.
   *
   * A token pass is one `eth_getLogs` over the whole range; a native pass reads
   * every block *body* in it, one call each. One number for both forces a
   * choice between a token scan that cannot keep up and a native scan that
   * exhausts a metered endpoint — which is exactly how a watcher ends up 141
   * blocks behind a payment that already confirmed.
   *
   * Defaults to `blockRange`, so a deployment that has not thought about it
   * behaves as before.
   */
  readonly nativeBlockRange?: number;
  /** How long a terminal payment's address stays in the watch set. */
  readonly retentionSeconds: number;
  readonly events?: EventPublisher;
  /** Block to start from when a chain has no cursor yet. */
  readonly startBlocks?: Readonly<Partial<Record<ChainId, bigint>>>;
  /** Cap on deposits re-probed per pass. */
  readonly probeLimit?: number;
  /**
   * The chain's own currency, per chain (#15).
   *
   * Only a native asset gets the balance reconciliation: an ERC-20 emits a
   * `Transfer` log however it moves, internal call or not, so `eth_getLogs`
   * already sees everything and a balance would add nothing. Native value moved
   * by a contract emits nothing at all, which is the gap this closes.
   *
   * Absent, the reconciliation never runs and the watcher behaves exactly as it
   * did before.
   */
  readonly nativeAssets?: Readonly<Partial<Record<ChainId, AssetCode>>>;
}

export interface TickResult {
  readonly chain: ChainId;
  readonly asset: AssetCode;
  readonly scannedFrom: bigint;
  readonly scannedTo: bigint;
  /**
   * The chain's head at this pass.
   *
   * Reported so a caller can see the gap between it and `scannedTo`. A watcher
   * behind the head is not an error and raises nothing — it simply has not read
   * the block a payer's deposit is in yet, and the payment reads as unpaid
   * until it does. Silent, that lag looks exactly like a payment that failed.
   */
  readonly headNumber: bigint;
  readonly recorded: number;
  readonly confirmed: number;
  readonly orphaned: number;
  readonly funded: number;
}

/** No sender to name: a balance says what arrived, never who sent it. */
const ZERO_ADDRESS = `0x${"0".repeat(40)}`;

export class WalletWatcher {
  readonly #client: ChainClient;
  readonly #addresses: DepositAddressRepository;
  readonly #deposits: DepositRepository;
  readonly #cursors: WatcherCursorRepository;
  readonly #sink: AssetReceiptSink;
  readonly #clock: Clock;
  readonly #policy: ConfirmationPolicy;
  readonly #blockRange: bigint;
  readonly #nativeBlockRange: bigint;
  readonly #retentionSeconds: number;
  readonly #events: EventPublisher;
  readonly #startBlocks: Readonly<Partial<Record<ChainId, bigint>>>;
  readonly #probeLimit: number;
  readonly #nativeAssets: Readonly<Partial<Record<ChainId, AssetCode>>>;

  constructor(options: WalletWatcherOptions) {
    this.#client = options.client;
    this.#addresses = options.addresses;
    this.#deposits = options.deposits;
    this.#cursors = options.cursors;
    this.#sink = options.sink;
    this.#clock = options.clock;
    this.#policy = options.policy;
    this.#blockRange = BigInt(options.blockRange);
    this.#nativeBlockRange = BigInt(options.nativeBlockRange ?? options.blockRange);
    this.#retentionSeconds = options.retentionSeconds;
    this.#events = options.events ?? noopEventPublisher;
    this.#startBlocks = options.startBlocks ?? {};
    this.#probeLimit = options.probeLimit ?? 500;
    this.#nativeAssets = options.nativeAssets ?? {};
  }

  async tick(chain: ChainId, asset: AssetCode): Promise<TickResult> {
    const now = this.#clock.now();
    const head = await this.#client.head(chain);

    const cursor = await this.#cursors.get(chain, asset);
    const start = cursor ?? this.#startBlocks[chain] ?? 0n;
    const from = start + 1n;
    const range = this.#nativeAssets[chain] === asset ? this.#nativeBlockRange : this.#blockRange;
    const to = min(head.number, start + range);
    // A reorg replaces blocks without advancing the head, so there can be
    // nothing new to scan and still be everything to reclassify. Only the scan
    // is skipped here — returning early would make the watcher blind to exactly
    // the case it exists to catch.
    const hasNewBlocks = from <= to;

    const watched = await this.#addresses.listWatched(chain, this.#retentionCutoff(now));

    const recorded = hasNewBlocks ? await this.#scan(chain, asset, from, to, watched, now) : 0;
    // Balances are read every tick, not only when there are new blocks: value
    // that arrived internally leaves nothing in a block body to scan, so a pass
    // that skipped the scan is exactly a pass that must still look.
    const reconciled =
      this.#nativeAssets[chain] === asset
        ? await this.#reconcileBalances(chain, asset, head.number, watched, now)
        : 0;
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
      headNumber: head.number,
      recorded: recorded + reconciled,
      confirmed,
      orphaned,
      funded,
    };
  }

  /**
   * Records value an address holds that no transfer accounted for.
   *
   * The block scan sees top-level transactions. A smart-contract wallet, an
   * exchange sweeping through a router, any contract forwarding value — all of
   * those arrive as internal calls, which appear in no block body. Left there,
   * a payer who paid is told they did not.
   *
   * The reconciliation is a subtraction: what the address holds at a settled
   * height, minus what has already been recorded for it. A positive difference
   * is value that arrived unseen and is recorded as a deposit of exactly that
   * difference — so a transfer the scan already caught is never counted twice,
   * whichever pass runs first.
   *
   * Read at `head - confirmations`, so what it reports is already past the
   * depth this deployment requires. The synthetic deposit still carries the
   * block's real hash, which is what lets the reorg probe treat it like any
   * other.
   */
  async #reconcileBalances(
    chain: ChainId,
    asset: AssetCode,
    headNumber: bigint,
    watched: readonly WatchedAddress[],
    now: Date,
  ): Promise<number> {
    const addresses = watched
      .filter((entry) => entry.fundable && entry.asset === asset)
      .map((entry) => entry.address);
    if (addresses.length === 0) return 0;

    // Read one confirmation depth back, so the balance reported is already past
    // the depth this deployment requires and cannot un-happen under it.
    const depth = BigInt(this.#policy.depth);
    if (headNumber < depth) return 0;
    const block = headNumber - depth;

    const balances = await this.#client.nativeBalances({ chain, asset, addresses, block });

    const logs: TransferLog[] = [];
    for (const balance of balances) {
      const recorded = await this.#deposits.recordedTotal(chain, balance.address, asset);
      const unaccounted = balance.amount - recorded.amount;
      if (unaccounted <= 0n) continue;

      logs.push({
        chain,
        asset,
        // No transaction to name — the value arrived inside someone else's. The
        // key is the address and the height it was observed at, which makes a
        // re-read of the same block idempotent rather than a second deposit.
        txHash: `balance:${balance.address}:${balance.blockNumber}`,
        // -1 is the native scan's marker; -2 says "seen as a balance, not as a
        // transfer", so the two can never collide on the uniqueness key.
        logIndex: -2,
        blockNumber: balance.blockNumber,
        blockHash: balance.blockHash,
        // Unknowable from a balance. The zero address is the honest answer:
        // nobody is claimed to have sent it.
        from: ZERO_ADDRESS,
        to: balance.address,
        amount: unaccounted,
      });
    }

    if (logs.length === 0) return 0;
    await this.#deposits.record(logs, now);
    return logs.length;
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
    const inWatch: Deposit[] = [];
    // Past the reorg-watch window a deposit is final — that is what the window
    // means. For a CONFIRMED one that just means stop probing. For one still
    // PENDING it has to mean confirm it, or it never confirms at all and the
    // payment it funds never advances.
    //
    // A deposit reaches that state whenever it is first *seen* deep rather than
    // first *arriving* deep: catch-up after downtime, a wide `blockRange`, or a
    // tick interval longer than the window. Dropping those silently stranded
    // every deposit that arrived while the watcher was not running.
    const finalPending: Deposit[] = [];

    for (const deposit of probable) {
      if (isWithinReorgWatch(confirmationsOf(deposit.blockNumber, headNumber), this.#policy)) {
        inWatch.push(deposit);
      } else if (deposit.status === "PENDING") {
        finalPending.push(deposit);
      }
    }

    if (inWatch.length === 0 && finalPending.length === 0) {
      return { confirmed: 0, orphaned: 0 };
    }

    // One probe per distinct height: N deposits in one block cost one call.
    const hashes = new Map<bigint, string | null>();
    for (const deposit of inWatch) {
      if (hashes.has(deposit.blockNumber)) continue;
      hashes.set(deposit.blockNumber, await this.#client.blockHash(chain, deposit.blockNumber));
    }

    const updates: DepositStatusUpdate[] = finalPending.map((deposit) => ({
      id: deposit.id,
      status: "CONFIRMED" as const,
      at: now,
    }));
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
