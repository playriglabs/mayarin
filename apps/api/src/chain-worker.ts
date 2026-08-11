/** Railway entry point for continuous chain ingestion. */

import { CHAIN_IDS } from "@mayarin/chain";
import { ConfigurationError } from "@mayarin/shared";
import { loadConfig } from "./config.ts";
import { createContainer, watchedPairs } from "./container.ts";
import { startIndexerLoops, startWatcherLoops } from "./services/watcher-loops.ts";

const config = loadConfig();
const chain = config.chain;

if (chain === undefined || chain.intervalMs <= 0) {
  throw new ConfigurationError(
    "The chain worker needs CHAIN_ENABLED=true and WATCHER_INTERVAL_MS greater than zero",
    {},
  );
}

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
  intervalMs: chain.intervalMs,
});

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
  await container.close();
  process.exit(0);
};

process.once("SIGTERM", () => void shutdown("SIGTERM"));
process.once("SIGINT", () => void shutdown("SIGINT"));
