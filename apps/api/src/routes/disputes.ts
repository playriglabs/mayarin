/**
 * Escrow disputes over the merchant API (#313).
 *
 * The dashboard has always shown a merchant their disputes and let them answer.
 * This is the same case file for an integration: read the disputes and their
 * threads with a key, post an answer, and learn of each step by webhook
 * (`escrow.disputed`, `escrow.dispute.message`, `escrow.dispute.resolved`), so a
 * merchant can answer or refund before an arbiter has to decide.
 *
 * Scoped by the key's merchant: another merchant's dispute is a 404, the same as
 * one that does not exist. Reading needs `payments:read`; posting needs
 * `disputes:manage`, which is not `refunds:manage`: replying in a thread moves no
 * money, and an integration that can refund is not thereby allowed to speak for
 * the merchant in front of an arbiter.
 */

import { Hono } from "hono";
import type { Container } from "../container.ts";
import { disputeListQuerySchema, merchantDisputeMessageSchema } from "../dto/dispute.ts";
import { toDisputeCaseDto, toDisputeDto, toDisputeMessageDto } from "../dto/escrow-mapper.ts";
import { type ApiKeyAuthEnv, requireApiKey } from "../middleware/api-key.ts";

export function disputeRoutes(container: Container): Hono<ApiKeyAuthEnv> {
  const app = new Hono<ApiKeyAuthEnv>();

  app.get("/", requireApiKey(container.verifyApiKey, "payments:read"), async (c) => {
    const { merchantId } = c.get("scope");
    const query = disputeListQuerySchema.parse(c.req.query());
    // Newest first, up to the cap, then filtered: a merchant has few disputes.
    const all = await container.escrow.disputesOf(merchantId, 100);
    const matching =
      query.status === undefined ? all : all.filter((d) => d.status === query.status);
    return c.json({
      disputes: matching.slice(0, query.limit).map(toDisputeDto),
      open: all.filter((dispute) => dispute.status === "open").length,
    });
  });

  app.get("/:id", requireApiKey(container.verifyApiKey, "payments:read"), async (c) => {
    const { merchantId } = c.get("scope");
    const { dispute, messages } = await container.escrow.disputeCase(merchantId, c.req.param("id"));
    return c.json({ dispute: toDisputeCaseDto(dispute, messages) });
  });

  app.post("/:id/messages", requireApiKey(container.verifyApiKey, "disputes:manage"), async (c) => {
    const { merchantId } = c.get("scope");
    const { body } = merchantDisputeMessageSchema.parse(await c.req.json().catch(() => ({})));
    const message = await container.escrow.postMerchantMessage(merchantId, c.req.param("id"), body);
    return c.json({ message: toDisputeMessageDto(message) }, 201);
  });

  return app;
}
