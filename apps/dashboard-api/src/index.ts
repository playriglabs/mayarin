/**
 * Dashboard API entry point.
 *
 * Boots the composition root and serves. Accounts are NOT seeded at boot —
 * creation is backend-only tooling via the `seed:merchant` CLI, which creates a
 * merchant tenant + its first account. Run it after migrating an empty
 * database.
 */

import { bodyCeilingFor } from "@mayarin/http";
import { initErrorReporting } from "@mayarin/observability";
import { createApp } from "./app.ts";
import { loadConfig } from "./config.ts";
import { createContainer } from "./container.ts";
import { MAX_LOGO_BYTES } from "./services/logo-storage.ts";

initErrorReporting("dashboard-api");

const config = loadConfig();
const container = createContainer({ config });

const app = createApp(container);

/**
 * The subscription billing tick (#296). In this process because it holds what
 * a cycle needs — invoices, customers and the email sender. Safe to run on more
 * than one instance: a cycle's invoice and email are keyed by the cycle, and
 * the subscription advances under its optimistic lock.
 */
const TICK_MS = 60_000;
let ticking = false;
setInterval(() => {
  if (ticking) return;
  ticking = true;
  container.subscriptions
    .tick()
    .then(({ billed, failed }) => {
      if (billed > 0 || failed > 0) {
        console.log(`[subscriptions] billed ${billed} cycle(s), ${failed} failed`);
      }
    })
    .catch((error: unknown) => console.error("[subscriptions] tick failed", error))
    .finally(() => {
      ticking = false;
    });
}, TICK_MS);

// Pricing every rail takes a payment API round trip per pair, and the settings screen waits
// for all of them. Do it now, in the background, and again before the answers go stale, so the
// first screen after a restart does not pay for it.
const RAIL_WARM_INTERVAL_MS = 4 * 60_000;
const warmRails = () =>
  container.warmRailPricing().catch((error: unknown) => {
    console.warn("[dashboard-api] could not warm rail pricing", error);
  });
void warmRails();
setInterval(() => void warmRails(), RAIL_WARM_INTERVAL_MS).unref();

console.log(`[dashboard-api] listening on http://localhost:${config.port}`);

export default {
  // Local deposit detail may cross a public testnet RPC and take longer than
  // Bun's default. Railway runs with NODE_ENV=production and keeps the existing
  // server default; this allowance belongs only to the local development path.
  ...(process.env.NODE_ENV === "development" ? { idleTimeout: 30 } : {}),
  // JSON everywhere except the logo upload, which has its own cap (SEC-08).
  maxRequestBodySize: bodyCeilingFor(MAX_LOGO_BYTES),
  port: config.port,
  fetch: app.fetch,
};
