/** Railway entry point for continuous chain ingestion. */

import { CHAIN_IDS } from "@mayarin/chain";
import { acquireWorkerLease } from "@mayarin/db";
import { ConfigurationError } from "@mayarin/shared";
import { loadConfig } from "./config.ts";
import { createContainer, watchedPairs } from "./container.ts";
import { startEscrowKeeper } from "./services/escrow-keeper.ts";
import { startIndexerLoops, startWatcherLoops } from "./services/watcher-loops.ts";

const config = loadConfig();
const chain = config.chain;

if (chain === undefined || chain.intervalMs <= 0) {
  throw new ConfigurationError(
    "The chain worker needs CHAIN_ENABLED=true and WATCHER_INTERVAL_MS greater than zero",
    {},
  );
}

// One worker at a time, enforced by the database. A second instance waits here
// until the first is gone instead of racing it on nonces and cursors.
const lease = await acquireWorkerLease(config.databaseUrl, {
  onWaiting: () => console.log("[chain-worker] another worker holds the lease; waiting"),
  // Without the lease a second worker may be running; stop and let the platform restart.
  onLost: () => {
    console.error("[chain-worker] lost the worker lease; exiting");
    process.exit(1);
  },
});

const container = createContainer({ config });

const seeded = await container.market.seedFromEnvironment();
if (seeded.length > 0) {
  console.log(`[chain-worker] seeded market config: ${seeded.join(", ")}`);
}

await container.walletGuard.assertTreasuryUnclaimed(CHAIN_IDS);

const recovered = await container.engine.resumeStuck();
if (recovered.length > 0) {
  console.log(`[chain-worker] resumed ${recovered.length} clearing transaction(s)`);
}

const finishedRefunds = await container.refunds.resumePending();
if (finishedRefunds.length > 0) {
  console.log(`[chain-worker] finished ${finishedRefunds.length} pending refund(s)`);
}

// A refund can crash between "rail confirmed" and "ledger posted" while the
// worker keeps running; finishing it only at start would leave it pending until
// the next restart. Same call, on a timer, with no overlap (SEC-02).
const REFUND_RECOVERY_INTERVAL_MS = 5 * 60_000;
let recoveringRefunds = false;
const refundRecoveryTimer = setInterval(() => {
  if (recoveringRefunds) return;
  recoveringRefunds = true;
  void container.refunds
    .resumePending()
    .then((finished) => {
      if (finished.length > 0) {
        console.log(`[chain-worker] finished ${finished.length} pending refund(s)`);
      }
    })
    .catch((error: unknown) => console.error("[chain-worker] refund recovery failed", error))
    .finally(() => {
      recoveringRefunds = false;
    });
}, REFUND_RECOVERY_INTERVAL_MS);

const pairs = watchedPairs(config);
if (pairs.length === 0 && container.indexers.size === 0) {
  await container.close();
  throw new ConfigurationError("The chain worker has no watcher pairs or settlement indexers", {});
}

const stopWatcherLoops = startWatcherLoops({
  pairs,
  watchers: container.watchers,
  intervalMs: chain.intervalMs,
  catchUpIntervalMs: chain.catchUpIntervalMs,
  rangeOf: (pair) =>
    config.chainNativeAssets[pair.chain] === pair.asset ? chain.nativeBlockRange : chain.blockRange,
});
const stopIndexerLoops = startIndexerLoops({
  indexers: container.indexers,
  intervalMs: chain.indexerIntervalMs,
  maxBackoffMs: chain.indexerMaxBackoffMs,
});

// Releases an escrow once its hold ends, and refunds a dispute nobody decided
// by `resolveBy` (#304). Needs the operator key, so only with treasury execution.
const stopEscrowKeeper =
  container.escrowKeeper === undefined ? () => {} : startEscrowKeeper(container.escrowKeeper);

console.log(
  `[chain-worker] watching ${pairs.length} chain/asset pair(s) and ${container.indexers.size} router(s)`,
);

let stopping = false;
const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
  if (stopping) return;
  stopping = true;
  console.log(`[chain-worker] received ${signal}; stopping`);
  stopWatcherLoops();
  stopIndexerLoops();
  stopEscrowKeeper();
  clearInterval(refundRecoveryTimer);
  await container.close();
  await lease.release();
  process.exit(0);
};

process.once("SIGTERM", () => void shutdown("SIGTERM"));
process.once("SIGINT", () => void shutdown("SIGINT"));
