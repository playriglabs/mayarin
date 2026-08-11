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

/** One line, and the whole message when there is one worth reading. */
function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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
          const result = await watcher.tick(pair.chain, pair.asset);
          // A watcher behind the head reads as a payment that never arrived:
          // the deposit is on chain, in a block this pass has not reached. It
          // is not an error and nothing throws, so without this line the only
          // symptom is a payer staring at "awaiting payment" while the explorer
          // shows their transfer confirmed.
          const lag = result.headNumber - result.scannedTo;
          if (lag > BigInt(chain.blockRange)) {
            console.warn(
              `[watcher] ${pair.chain}/${pair.asset} is ${lag} block(s) behind the head; deposits in that gap are not seen yet`,
            );
          }
        } catch (error) {
          // A failed pass is not fatal: the cursor was not advanced, so the next
          // tick re-scans the same range. A rate limit is the expected failure
          // on a metered endpoint, so it prints as one line — the full viem
          // error is thirty, and thirty lines of stack reads as a crash.
          console.error(`[watcher] ${pair.chain}/${pair.asset} tick failed: ${reasonOf(error)}`);
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
          console.error(`[indexer] ${indexedChain} tick failed: ${reasonOf(error)}`);
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
  idleTimeout: 30,
  port: config.port,
  fetch: app.fetch,
};
