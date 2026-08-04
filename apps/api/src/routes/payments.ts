/**
 * Payment status route.
 *
 * One view of a payment, assembled by the payment application service. Accepts
 * either the intent id or the clearing transaction id, since callers hold
 * whichever they were handed.
 */

import { Hono } from "hono";
import type { Container } from "../container.ts";
import { toDepositDto } from "../dto/deposit.ts";
import { toPaymentDto } from "../dto/payment.ts";

export function paymentRoutes(container: Container): Hono {
  const app = new Hono();

  app.get("/:id", async (c) => {
    const { intent, transaction, events, deposit } = await container.paymentApp.getPayment(
      c.req.param("id"),
    );
    const depositDto =
      deposit === null || transaction === null
        ? null
        : toDepositDto(
            transaction,
            deposit.deposits,
            deposit.headNumber,
            deposit.requiredConfirmations,
          );
    return c.json(toPaymentDto(intent, transaction, events, depositDto));
  });

  return app;
}
