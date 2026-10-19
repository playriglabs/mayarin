/**
 * What the fraud rules flagged on this merchant's payments (FDS).
 *
 * Read-only, scoped by the key's merchant. A flagged payment is announced by the
 * `payment.flagged` webhook; this is the list to catch up from.
 */

import { Hono } from "hono";
import { z } from "zod";
import type { Container } from "../container.ts";
import { type ApiKeyAuthEnv, requireApiKey } from "../middleware/api-key.ts";

const querySchema = z.object({ limit: z.coerce.number().int().min(1).max(100).default(50) });

export function riskRoutes(container: Container): Hono<ApiKeyAuthEnv> {
  const app = new Hono<ApiKeyAuthEnv>();

  app.get("/flags", requireApiKey(container.verifyApiKey, "payments:read"), async (c) => {
    const { merchantId } = c.get("scope");
    const { limit } = querySchema.parse(c.req.query());
    const flagged = await container.riskAssessments.listFlagged(merchantId, limit);
    return c.json({
      flags: flagged.map((assessment) => ({
        id: assessment.id,
        paymentIntentId: assessment.paymentIntentId,
        outcome: assessment.outcome,
        payer: assessment.payer ?? null,
        signals: assessment.signals.map(({ rule, detail }) => ({ rule, detail })),
        assessedAt: assessment.assessedAt.toISOString(),
      })),
    });
  });

  return app;
}
