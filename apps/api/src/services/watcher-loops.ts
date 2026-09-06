import type { ChainId, TickResult, WalletWatcher } from "@mayarin/chain";
import { type AssetCode, isMayarinError } from "@mayarin/shared";

export interface WatchedPair {
  readonly chain: ChainId;
  readonly asset: AssetCode;
}

interface WatcherPort {
  tick(chain: ChainId, asset: AssetCode): Promise<TickResult>;
}

interface IndexerPort {
  tick(chain: ChainId): Promise<unknown>;
}

interface WatcherLogger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

export interface TimerPort {
  /** Schedules a callback and returns its cancellation effect. */
  schedule(run: () => void, delayMs: number): () => void;
}

export interface WatcherLoopOptions {
  readonly pairs: readonly WatchedPair[];
  readonly watchers: ReadonlyMap<ChainId, WalletWatcher | WatcherPort>;
  readonly intervalMs: number;
  readonly catchUpIntervalMs: number;
  readonly rangeOf: (pair: WatchedPair) => number;
  readonly logger?: WatcherLogger;
  readonly timers?: TimerPort;
}

export interface IndexerLoopOptions {
  readonly indexers: ReadonlyMap<ChainId, IndexerPort>;
  readonly intervalMs: number;
  /**
   * Ceiling for the backoff a failing pass falls into.
   *
   * A hosted subgraph counts queries, so a pass that fails on a quota keeps its
   * own quota spent if the next pass arrives on the normal interval.
   */
  readonly maxBackoffMs?: number;
  readonly logger?: WatcherLogger;
  readonly timers?: TimerPort;
}

const systemTimers: TimerPort = {
  schedule: (run, delayMs) => {
    const timer = setTimeout(run, delayMs);
    return () => clearTimeout(timer);
  },
};

const consoleLogger: WatcherLogger = {
  info: (message) => console.log(message),
  warn: (message) => console.warn(message),
  error: (message) => console.error(message),
};

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function nameOf(pair: WatchedPair): string {
  return `${pair.chain}/${pair.asset}`;
}

/**
 * Starts one completion-driven loop per `(chain, asset)` pair.
 *
 * Every pair runs immediately. A lagging pair schedules another pass after the
 * shorter catch-up delay; a synchronized pair sleeps for the normal interval.
 * Scheduling only after `tick()` settles makes overlap impossible even when an
 * RPC pass takes longer than either delay.
 */
export function startWatcherLoops(options: WatcherLoopOptions): () => void {
  const timers = options.timers ?? systemTimers;
  const logger = options.logger ?? consoleLogger;
  const stops = options.pairs.map((pair) => {
    const watcher = options.watchers.get(pair.chain);
    if (watcher === undefined) return () => {};

    let stopped = false;
    let cancelTimer: (() => void) | undefined;
    let lagging = false;

    const schedule = (delayMs: number, run: () => Promise<void>): void => {
      if (stopped) return;
      cancelTimer = timers.schedule(() => void run(), delayMs);
    };

    const run = async (): Promise<void> => {
      try {
        const result = await watcher.tick(pair.chain, pair.asset);
        const lag = result.headNumber - result.scannedTo;
        const materiallyBehind = lag > BigInt(options.rangeOf(pair));

        if (materiallyBehind && !lagging) {
          logger.warn(
            `[watcher] ${nameOf(pair)} is ${lag} block(s) behind the head; catching up without waiting for the normal interval`,
          );
        } else if (!materiallyBehind && lagging) {
          logger.info(`[watcher] ${nameOf(pair)} caught up to the chain head`);
        }
        lagging = materiallyBehind;

        schedule(lag > 0n ? options.catchUpIntervalMs : options.intervalMs, run);
      } catch (error) {
        logger.error(`[watcher] ${nameOf(pair)} tick failed: ${reasonOf(error)}`);
        schedule(options.intervalMs, run);
      }
    };

    void run();

    return () => {
      stopped = true;
      cancelTimer?.();
    };
  });

  return () => {
    for (const stop of stops) stop();
  };
}

/**
 * Milliseconds a failed pass asked to be left alone for, when it said so.
 *
 * `Retry-After` is the only number in the system that comes from the far side
 * of the rate limit; guessing when the limiter has forgotten about us is worse
 * than being told.
 */
function retryAfterOf(error: unknown): number | undefined {
  if (!isMayarinError(error)) return undefined;
  const hint = error.details.retryAfterMs;
  return typeof hint === "number" && Number.isFinite(hint) && hint >= 0 ? hint : undefined;
}

/**
 * Starts one non-overlapping, completion-driven loop per settlement indexer.
 *
 * A failing pass backs off, doubling up to `maxBackoffMs`, and honours a
 * `Retry-After` the source sent instead when that is longer. A success resets
 * the delay to the normal interval — the indexer is not a retry queue, and a
 * chain that recovers should not stay slow because it was once throttled.
 *
 * An interval of zero starts nothing, the way `WATCHER_INTERVAL_MS=0` leaves
 * only the admin route. Read as a delay it would mean a pass with no gap at
 * all, which is the opposite of what an operator typing zero is asking for.
 */
export function startIndexerLoops(options: IndexerLoopOptions): () => void {
  const timers = options.timers ?? systemTimers;
  const logger = options.logger ?? consoleLogger;
  if (options.intervalMs <= 0) {
    if (options.indexers.size > 0) {
      logger.info("[indexer] INDEXER_INTERVAL_MS is 0; settlement indexing is off");
    }
    return () => {};
  }
  const maxBackoffMs = Math.max(options.maxBackoffMs ?? 300_000, options.intervalMs);
  const stops = [...options.indexers].map(([chain, indexer]) => {
    let stopped = false;
    let cancelTimer: (() => void) | undefined;
    let backoffMs = options.intervalMs;

    const run = async (): Promise<void> => {
      let delayMs = options.intervalMs;
      try {
        await indexer.tick(chain);
        backoffMs = options.intervalMs;
      } catch (error) {
        backoffMs = Math.min(Math.max(backoffMs * 2, options.intervalMs), maxBackoffMs);
        delayMs = Math.max(backoffMs, retryAfterOf(error) ?? 0);
        logger.error(
          `[indexer] ${chain} tick failed: ${reasonOf(error)}; next pass in ${delayMs}ms`,
        );
      }

      if (!stopped) {
        cancelTimer = timers.schedule(() => void run(), delayMs);
      }
    };

    void run();

    return () => {
      stopped = true;
      cancelTimer?.();
    };
  });

  return () => {
    for (const stop of stops) stop();
  };
}
