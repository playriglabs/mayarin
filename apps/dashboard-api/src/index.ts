/**
 * Dashboard API entry point.
 *
 * Boots the composition root and serves. Accounts are NOT seeded at boot —
 * creation is backend-only tooling via the `seed:merchant` CLI, which creates a
 * merchant tenant + its first account. Run it after migrating an empty
 * database.
 */

import { createApp } from "./app.ts";
import { loadConfig } from "./config.ts";
import { createContainer } from "./container.ts";

const config = loadConfig();
const container = createContainer({ config });

const app = createApp(container);

console.log(`[dashboard-api] listening on http://localhost:${config.port}`);

export default {
  // Local deposit detail may cross a public testnet RPC and take longer than
  // Bun's default. Railway runs with NODE_ENV=production and keeps the existing
  // server default; this allowance belongs only to the local development path.
  ...(process.env.NODE_ENV === "development" ? { idleTimeout: 30 } : {}),
  port: config.port,
  fetch: app.fetch,
};
