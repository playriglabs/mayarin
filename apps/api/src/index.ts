/**
 * API entry point.
 *
 * Boots the composition root, then resumes anything the previous process left
 * mid-flight before accepting traffic — a restart must not strand a payment.
 */

import { CHAIN_IDS } from "@mayarin/chain";
import { createApp } from "./app.ts";
import { loadConfig } from "./config.ts";
import { createContainer } from "./container.ts";

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

// A payer who scanned the QR and walked away leaves the clearing transaction
// at PAYMENT_PENDING past the intent's deadline; nothing else fails it, since
// `isExpired` excludes PROCESSING to keep a late-funded payment from wedging.
// Sweep once at startup, then periodically — a payment that expires while the
// process runs must not sit at "awaiting payment" until a restart.
const swept = await container.engine.sweepExpired();
if (swept.length > 0) {
  console.log(`[api] swept ${swept.length} expired payment(s) on startup`);
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

// The expiry sweep runs on its own timer in the watcher's shape: a failed pass
// leaves the abandoned transactions where they were, so the next pass repeats
// them. Independent of the chain layer — a chainless deployment still expires.
const EXPIRY_SWEEP_INTERVAL_MS = 60_000;
setInterval(() => {
  void container.engine
    .sweepExpired()
    .then((swept) => {
      if (swept.length > 0) console.log(`[clearing] swept ${swept.length} expired payment(s)`);
    })
    .catch((error) => {
      console.error("[clearing] expiry sweep tick failed", error);
    });
}, EXPIRY_SWEEP_INTERVAL_MS);
console.log(`[clearing] sweeping expired payments every ${EXPIRY_SWEEP_INTERVAL_MS}ms`);

const app = createApp(container);

console.log(`[api] listening on http://localhost:${config.port}`);

export default {
  idleTimeout: 30,
  port: config.port,
  fetch: app.fetch,
};
