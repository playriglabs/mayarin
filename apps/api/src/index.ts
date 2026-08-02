/**
 * API entry point.
 *
 * Boots the composition root, then resumes anything the previous process left
 * mid-flight before accepting traffic — a restart must not strand a payment.
 */

import { createApp } from "./app.ts";
import { loadConfig } from "./config.ts";
import { createContainer } from "./container.ts";

const config = loadConfig();
const container = createContainer({ config });

const recovered = await container.engine.resumeStuck();
if (recovered.length > 0) {
  console.log(`[api] resumed ${recovered.length} clearing transaction(s) on startup`);
}

const app = createApp(container);

console.log(`[api] listening on http://localhost:${config.port}`);

export default {
  port: config.port,
  fetch: app.fetch,
};
