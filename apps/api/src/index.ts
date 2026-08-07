/**
 * API entry point.
 *
 * Boots the composition root, then resumes anything the previous process left
 * mid-flight before accepting traffic — a restart must not strand a payment.
 */

import { createApp } from "./app.ts";
import { loadConfig } from "./config.ts";
import { createContainer, watchedPairs } from "./container.ts";

const config = loadConfig();
const container = createContainer({ config });

const recovered = await container.engine.resumeStuck();
if (recovered.length > 0) {
  console.log(`[api] resumed ${recovered.length} clearing transaction(s) on startup`);
}

const chain = config.chain;
const pairs = watchedPairs(config);
if (chain !== undefined && chain.intervalMs > 0 && container.watchers.size > 0) {
  setInterval(() => {
    void (async () => {
      for (const pair of pairs) {
        const watcher = container.watchers.get(pair.chain);
        if (watcher === undefined) continue;
        try {
          await watcher.tick(pair.chain, pair.asset);
        } catch (error) {
          // A failed pass is not fatal: the cursor was not advanced, so the next
          // tick re-scans the same range.
          console.error(`[watcher] ${pair.chain}/${pair.asset} tick failed`, error);
        }
      }
    })();
  }, chain.intervalMs);
  console.log(`[watcher] polling ${pairs.length} pair(s) every ${chain.intervalMs}ms`);
}

// The indexer runs on the same interval and for the same reason: a failed pass
// leaves the cursor where it was, so the next one re-scans the same range.
if (chain !== undefined && chain.intervalMs > 0 && container.indexers.size > 0) {
  setInterval(() => {
    void (async () => {
      for (const [indexedChain, indexer] of container.indexers) {
        try {
          await indexer.tick(indexedChain);
        } catch (error) {
          console.error(`[indexer] ${indexedChain} tick failed`, error);
        }
      }
    })();
  }, chain.intervalMs);
  console.log(`[indexer] polling ${container.indexers.size} router(s) every ${chain.intervalMs}ms`);
}

const app = createApp(container);

console.log(`[api] listening on http://localhost:${config.port}`);

export default {
  port: config.port,
  fetch: app.fetch,
};
