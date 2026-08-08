/**
 * API entry point.
 *
 * Boots the composition root, then resumes anything the previous process left
 * mid-flight before accepting traffic — a restart must not strand a payment.
 */

import { CHAIN_IDS } from "@mayarin/chain";
import { createApp } from "./app.ts";
import { loadConfig } from "./config.ts";
import { createContainer, watchedPairs } from "./container.ts";

const config = loadConfig();
const container = createContainer({ config });

// Market data moves out of the environment into the database (#95). Seeded
// once, per key, and never overwritten afterwards — a plain write on every boot
// would undo an operator's change and make the whole feature a no-op that looks
// like it works.
const seeded = await container.market.seedFromEnvironment();
if (seeded.length > 0) {
  console.log(`[api] seeded market config from the environment: ${seeded.join(", ")}`);
}

// A fee destination that is also somebody's payout wallet pays that merchant
// twice and shows one payment in the ledger (#11, RFC #6). The signer refuses
// the other direction per payment; this direction can only be caught here,
// because nothing about it looks wrong at request time.
await container.walletGuard.assertTreasuryUnclaimed(CHAIN_IDS);

// One LISTEN connection for the process, opened before traffic: a payer whose
// page loads first and pays second must not miss the change in between.
if (container.stream !== undefined) {
  await container.stream.start();
  console.log("[api] live payment status enabled");
}

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

// The dispatcher runs on its own timer, in the watcher's shape: a failed pass
// leaves the cursor and the due deliveries where they were, so the next pass
// repeats them. The guard skips a beat rather than overlapping a slow one —
// two concurrent passes would race the same due deliveries.
const webhooks = container.webhooks;
if (webhooks !== undefined && config.webhookIntervalMs > 0) {
  let delivering = false;
  setInterval(() => {
    if (delivering) return;
    delivering = true;
    void webhooks
      .tick()
      .catch((error) => {
        console.error("[webhooks] dispatch tick failed", error);
      })
      .finally(() => {
        delivering = false;
      });
  }, config.webhookIntervalMs);
  console.log(`[webhooks] dispatching every ${config.webhookIntervalMs}ms`);
}

const app = createApp(container);

console.log(`[api] listening on http://localhost:${config.port}`);

export default {
  port: config.port,
  fetch: app.fetch,
};
