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
  port: config.port,
  fetch: app.fetch,
};
