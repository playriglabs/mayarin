import { UnauthorizedError } from "@mayarin/shared";
import { Hono } from "hono";
import type { Container } from "../container.ts";
import { toPaymentIntentDto } from "../dto/payment.ts";
import { toSettlementDto } from "../dto/settlement.ts";
import type { AuthVars } from "../middleware/types.ts";

export function analyticsRoutes(container: Container): Hono<{ Variables: AuthVars }> {
  const app = new Hono<{ Variables: AuthVars }>();

  app.get("/", async (c) => {
    const scope = c.get("scope");
    if (scope === undefined) throw new UnauthorizedError("Authentication required");
    const [payments, settlements] = await Promise.all([
      container.payments.listAll(scope),
      container.settlements.listAll(scope),
    ]);
    return c.json({
      payments: payments.map(toPaymentIntentDto),
      settlements: settlements.map(toSettlementDto),
    });
  });

  return app;
}
