/**
 * Re-seals every webhook signing secret under the current encryption key (SEC-12).
 *
 * `bun run db:rotate-webhook-secrets` from the repo root, after setting the new
 * `WEBHOOK_SECRET_ENCRYPTION_KEY` and moving the old one to
 * `WEBHOOK_SECRET_PREVIOUS_KEYS`. Rows already under the current key are left
 * alone, so it is safe to run twice. Once it reports nothing left, the previous
 * key can be dropped from every service.
 */

import { eq } from "drizzle-orm";
import { createDatabase } from "./client.ts";
import { webhookEndpoints } from "./schema.ts";
import { SecretBox } from "./secret-box.ts";

const url = process.env.DATABASE_URL;
const key = process.env.WEBHOOK_SECRET_ENCRYPTION_KEY;
if (url === undefined || key === undefined) {
  console.error("DATABASE_URL and WEBHOOK_SECRET_ENCRYPTION_KEY must be set");
  process.exit(1);
}

const box = new SecretBox(
  key,
  (process.env.WEBHOOK_SECRET_PREVIOUS_KEYS ?? "").split(",").filter((previous) => previous !== ""),
);
const handle = createDatabase({ url, maxConnections: 1 });

try {
  let rewritten = 0;
  for (const row of await handle.db.select().from(webhookEndpoints)) {
    const secret = box.isCurrent(row.secret) ? row.secret : box.seal(box.open(row.secret));
    const previous =
      row.previousSecret === null || box.isCurrent(row.previousSecret)
        ? row.previousSecret
        : box.seal(box.open(row.previousSecret));
    if (secret === row.secret && previous === row.previousSecret) continue;
    await handle.db
      .update(webhookEndpoints)
      .set({ secret, previousSecret: previous })
      .where(eq(webhookEndpoints.id, row.id));
    rewritten += 1;
  }
  console.log(`Re-sealed ${rewritten} webhook endpoint(s) under the current key`);
} finally {
  await handle.close();
}
