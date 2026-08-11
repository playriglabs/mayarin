import type { ChainId, TickResult, WalletWatcher } from "@mayarin/chain";
import type { AssetCode } from "@mayarin/shared";

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

/** Starts one non-overlapping, completion-driven loop per settlement indexer. */
export function startIndexerLoops(options: IndexerLoopOptions): () => void {
  const timers = options.timers ?? systemTimers;
  const logger = options.logger ?? consoleLogger;
  const stops = [...options.indexers].map(([chain, indexer]) => {
    let stopped = false;
    let cancelTimer: (() => void) | undefined;

    const run = async (): Promise<void> => {
      try {
        await indexer.tick(chain);
      } catch (error) {
        logger.error(`[indexer] ${chain} tick failed: ${reasonOf(error)}`);
      }

      if (!stopped) {
        cancelTimer = timers.schedule(() => void run(), options.intervalMs);
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
