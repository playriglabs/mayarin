/**
 * Mayarin Resolution's console (#313).
 *
 * Mounted behind `disputes:arbitrate`, a platform permission no merchant can
 * grant. Lists and reads every dispute this deployment's arbiter decides —
 * across merchants, which is the point — and appends the arbiter's messages.
 * The decision itself is a transaction the arbiter's wallet sends to the
 * escrow factory; nothing here signs.
 */

import { Hono } from "hono";
import type { Container } from "../container.ts";
import {
  disputeMessageBodySchema,
  toDisputeCaseDto,
  toDisputeDto,
  toDisputeMessageDto,
} from "../dto/disputes.ts";
import { csrfMiddleware } from "../middleware/csrf.ts";
import type { AuthVars } from "../middleware/types.ts";

export function disputeRoutes(container: Container): Hono<{ Variables: AuthVars }> {
  const app = new Hono<{ Variables: AuthVars }>();

  app.get("/", async (c) => {
    const disputes = await container.disputes.queue();
    return c.json({ disputes: disputes.map(toDisputeDto) });
  });

  app.get("/:id", async (c) => {
    return c.json(toDisputeCaseDto(await container.disputes.case(c.req.param("id"))));
  });

  /** The split call (#315); the arbiter's wallet sends it, nothing here signs. */
  app.get("/:id/resolve", async (c) => {
    const payeeBps = Number(c.req.query("payeeBps"));
    return c.json(await container.disputes.resolveCall(c.req.param("id"), payeeBps));
  });

  app.post("/:id/messages", csrfMiddleware(), async (c) => {
    const { body } = disputeMessageBodySchema.parse(await c.req.json());
    const message = await container.disputes.postArbiterMessage(c.req.param("id"), body);
    return c.json({ message: toDisputeMessageDto(message) }, 201);
  });

  return app;
}
