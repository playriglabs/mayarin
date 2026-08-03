/**
 * API entry point.
 *
 * Boots the composition root, then resumes anything the previous process left
 * mid-flight before accepting traffic — a restart must not strand a payment.
 */

import { pairsOf } from "@mayarin/stablecoin";
import { createApp } from "./app.ts";
import { loadConfig } from "./config.ts";
import { createContainer } from "./container.ts";

const config = loadConfig();
const container = createContainer({ config });

const recovered = await container.engine.resumeStuck();
if (recovered.length > 0) {
  console.log(`[api] resumed ${recovered.length} clearing transaction(s) on startup`);
}

const chain = config.chain;
const pairs = pairsOf(config.stablecoins);
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

const app = createApp(container);

console.log(`[api] listening on http://localhost:${config.port}`);

export default {
  port: config.port,
  fetch: app.fetch,
};
