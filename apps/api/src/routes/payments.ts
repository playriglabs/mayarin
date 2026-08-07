/**
 * Payment status route.
 *
 * One view of a payment, assembled by the payment application service. Accepts
 * either the intent id or the clearing transaction id, since callers hold
 * whichever they were handed.
 */

import { NotFoundError } from "@mayarin/shared";
import { Hono } from "hono";
import type { Container } from "../container.ts";
import { toContractCallDto } from "../dto/contract-call.ts";
import { toDepositDto } from "../dto/deposit.ts";
import { toPaymentDto } from "../dto/payment.ts";

export function paymentRoutes(container: Container): Hono {
  const app = new Hono();

  app.get("/:id", async (c) => {
    const { intent, transaction, events, deposit } = await container.paymentApp.getPayment(
      c.req.param("id"),
    );
    const rail = transaction?.deposit;
    // Resolved here rather than inside the DTO: the registry read is async, and
    // a native deposit has no token to look up.
    const token =
      rail === undefined ? undefined : await container.registry.address(rail.asset, rail.chain);
    const depositDto =
      deposit === null || transaction === null
        ? null
        : toDepositDto(
            transaction,
            deposit.deposits,
            deposit.headNumber,
            deposit.requiredConfirmations,
            token,
          );
    return c.json(toPaymentDto(intent, transaction, events, depositDto));
  });

  /**
   * The contract-path submit payload (#61): the signed order plus a fresh
   * executable route. Fetched per attempt — a route is perishable, so the
   * client asks again rather than reusing an old response.
   */
  app.get("/:id/contract-call", async (c) => {
    const checkout = container.checkout;
    if (checkout === undefined) {
      throw new NotFoundError("The contract execution path is not enabled on this deployment", {});
    }
    return c.json(toContractCallDto(await checkout.contractCall(c.req.param("id"))));
  });

  return app;
}
