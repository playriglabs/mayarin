/**
 * Payment routes — merchant/admin scoped reads.
 *
 * Mounted behind `require-auth`, so a verified session and its `Scope` are
 * present. The scope decides what the caller sees; the service enforces the
 * per-payment visibility split. Thin: parse query → call service → map DTO.
 */

import { UnauthorizedError } from "@mayarin/shared";
import { Hono } from "hono";
import { z } from "zod";
import type { Container } from "../container.ts";
import { toPaymentDetailDto, toPaymentIntentDto } from "../dto/payment.ts";
import type { AuthVars } from "../middleware/types.ts";

const listQuerySchema = z.object({
  limit: z.coerce.number().int().positive().optional(),
});

export function paymentRoutes(container: Container): Hono<{ Variables: AuthVars }> {
  const app = new Hono<{ Variables: AuthVars }>();

  app.get("/", async (c) => {
    const scope = c.get("scope");
    if (scope === undefined) throw new UnauthorizedError("Authentication required");
    const { limit } = listQuerySchema.parse(c.req.query());
    const intents = await container.payments.list(scope, limit);
    return c.json({ payments: intents.map(toPaymentIntentDto) });
  });

  app.get("/:id", async (c) => {
    const scope = c.get("scope");
    if (scope === undefined) throw new UnauthorizedError("Authentication required");
    const { intent, transaction, events } = await container.payments.get(scope, c.req.param("id"));
    return c.json(toPaymentDetailDto(intent, transaction, events));
  });

  /**
   * What the payer must send, for rendering as a QR (#15).
   *
   * Its own route rather than a field on the detail above: the address is
   * allocated at price lock, so it arrives later than the payment does, and a
   * deposit lookup crosses to the payment API — which owns the token registry
   * that decides an EIP-681 URI's form. Merging the two would make every
   * payment read wait on a second service to answer a question most of them are
   * not asking.
   *
   * Scoped through the same read service as the detail, so another merchant's
   * payment is a 404 here exactly as it is there — and the payment API, which
   * has no session, is only ever asked about an id already checked.
   */
  app.get("/:id/deposit", async (c) => {
    const scope = c.get("scope");
    if (scope === undefined) throw new UnauthorizedError("Authentication required");
    const { intent } = await container.payments.get(scope, c.req.param("id"));
    const deposit = await container.paymentApi.deposit(intent.id);

    return c.json({
      deposit,
      /**
       * Where to fetch the rendered code, assembled here rather than in the
       * browser: the renderer lives on the payment API, and a page that builds
       * that address itself has to be told the origin separately — and gets it
       * wrong in exactly the deployment where the two apps are not on one host.
       */
      qrUrl:
        deposit?.uri == null
          ? null
          : `${container.config.checkoutBaseUrl}/checkout/qr?value=${encodeURIComponent(deposit.uri)}`,
    });
  });

  return app;
}
