/**
 * Admin routes.
 *
 * Registered only when `ADMIN_TOKEN` is set — an unconfigured deployment returns
 * 404 rather than exposing an unauthenticated trigger.
 */

import { ValidationError } from "@mayarin/shared";
import { pairsOf } from "@mayarin/stablecoin";
import { Hono } from "hono";
import type { Container } from "../container.ts";
import { toPaymentIntentDto } from "../dto/payment-intent.ts";
import { adminTokenMiddleware } from "../middleware/admin-token.ts";

export function adminRoutes(container: Container, token: string): Hono {
  const app = new Hono();

  app.use("*", adminTokenMiddleware(token));

  /** Forces one watcher pass over every configured pair. */
  app.post("/watcher/tick", async (c) => {
    const chain = container.config.chain;
    if (chain === undefined || container.watchers.size === 0) {
      throw new ValidationError("The chain layer is not enabled on this deployment");
    }

    const results = [];
    for (const pair of pairsOf(container.config.stablecoins)) {
      const watcher = container.watchers.get(pair.chain);
      if (watcher === undefined) continue;
      const result = await watcher.tick(pair.chain, pair.asset);
      results.push({
        chain: result.chain,
        asset: result.asset,
        scannedFrom: result.scannedFrom.toString(),
        scannedTo: result.scannedTo.toString(),
        recorded: result.recorded,
        confirmed: result.confirmed,
        orphaned: result.orphaned,
        funded: result.funded,
      });
    }

    return c.json({ passes: results });
  });

  /**
   * Looks payments up by the merchant's own order id.
   *
   * Behind the admin token rather than on the public surface: an intent id is
   * an unguessable ULID, but a merchant reference is `INV-1042`, so an
   * unauthenticated lookup would enumerate every payment a merchant ever took.
   */
  app.get("/payment-intents", async (c) => {
    const merchantId = c.req.query("merchantId");
    const merchantReference = c.req.query("merchantReference");
    if (merchantId === undefined) {
      throw new ValidationError("merchantId is required");
    }

    const intents = await container.intents.list({
      merchantId,
      ...(merchantReference === undefined ? {} : { merchantReference }),
    });

    return c.json({ paymentIntents: intents.map(toPaymentIntentDto) });
  });

  return app;
}
