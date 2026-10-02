/**
 * A merchant's own escrow disputes (#313) — the list that tells them there is
 * one to answer. Scoped by the session's merchant; the answer itself is posted
 * on the payment (`POST /payments/:id/escrow/dispute/messages`).
 */

import { UnauthorizedError } from "@mayarin/shared";
import { Hono } from "hono";
import type { Container } from "../container.ts";
import { toDisputeCaseDto, toDisputeDto } from "../dto/disputes.ts";
import type { AuthVars } from "../middleware/types.ts";

export function merchantDisputeRoutes(container: Container): Hono<{ Variables: AuthVars }> {
  const app = new Hono<{ Variables: AuthVars }>();

  app.get("/", async (c) => {
    const scope = c.get("scope");
    if (scope === undefined) throw new UnauthorizedError("Authentication required");
    const disputes = await container.disputes.forMerchant(scope.merchantId);
    return c.json({
      disputes: disputes.map(toDisputeDto),
      open: disputes.filter((dispute) => dispute.status === "open").length,
    });
  });

  app.get("/:id", async (c) => {
    const scope = c.get("scope");
    if (scope === undefined) throw new UnauthorizedError("Authentication required");
    return c.json(
      toDisputeCaseDto(await container.disputes.merchantCase(scope.merchantId, c.req.param("id"))),
    );
  });

  return app;
}
