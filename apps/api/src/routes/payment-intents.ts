/**
 * Payment intent routes.
 *
 * `POST /payment-intents` accepts either a QR payload or an explicit merchant
 * and amount; both produce the same immutable intent. `POST
 * /payment-intents/:id/confirm` hands the intent to the clearing engine.
 *
 * Thin by design: validate input, call an application service, shape a response.
 * No payment logic lives here.
 */

import {
  amountFromParsedQr,
  type CreatePaymentIntentCommand,
  merchantFromParsedQr,
  sourceFromParsedQr,
} from "@mayarin/payment-intent";
import { parseQr } from "@mayarin/qr-parser";
import { ValidationError } from "@mayarin/shared";
import { Hono } from "hono";
import type { Container } from "../container.ts";
import { toPaymentDto } from "../dto/payment.ts";
import { type CreateBody, createBodySchema, toPaymentIntentDto } from "../dto/payment-intent.ts";

export function paymentIntentRoutes(container: Container): Hono {
  const app = new Hono();

  app.post("/", async (c) => {
    const body = createBodySchema.parse(await c.req.json());
    const idempotencyKey = c.req.header("Idempotency-Key");

    const command: CreatePaymentIntentCommand = {
      ...resolveMerchantAndAmount(body),
      ...(body.payment === undefined ? {} : { payment: body.payment }),
      ...(body.settlementAsset === undefined ? {} : { settlementAsset: body.settlementAsset }),
      ...(body.executionPath === undefined ? {} : { executionPath: body.executionPath }),
      ...(body.provider === undefined ? {} : { provider: body.provider }),
      ...(body.metadata === undefined ? {} : { metadata: body.metadata }),
      ...(body.merchantReference === undefined
        ? {}
        : { merchantReference: body.merchantReference }),
      ...(body.ttlSeconds === undefined ? {} : { ttlSeconds: body.ttlSeconds }),
      ...(idempotencyKey === undefined ? {} : { idempotencyKey }),
    };

    const intent = await container.intents.create(command);
    return c.json({ paymentIntent: toPaymentIntentDto(intent) }, 201);
  });

  app.post("/:id/confirm", async (c) => {
    const { intent, transaction, events } = await container.paymentApp.confirm(c.req.param("id"));
    return c.json(toPaymentDto(intent, transaction, events));
  });

  app.get("/:id", async (c) => {
    const intent = await container.intents.getById(c.req.param("id"));
    return c.json({ paymentIntent: toPaymentIntentDto(intent) });
  });

  return app;
}

/**
 * A QR payload is authoritative for merchant identity and, when dynamic, for
 * the amount. Without one, the caller must supply both.
 */
function resolveMerchantAndAmount(
  body: CreateBody,
): Pick<CreatePaymentIntentCommand, "merchant" | "amount" | "source"> {
  if (body.qr !== undefined) {
    const parsed = parseQr(body.qr);
    return {
      merchant: merchantFromParsedQr(parsed),
      amount: amountFromParsedQr(parsed, body.amount),
      source: sourceFromParsedQr(parsed),
    };
  }

  if (body.merchant === undefined || body.amount === undefined) {
    throw new ValidationError("Merchant details and an amount are required without a QR payload");
  }

  const { categoryCode, ...merchant } = body.merchant;
  return {
    merchant: { ...merchant, ...(categoryCode === undefined ? {} : { categoryCode }) },
    amount: body.amount,
    source: { type: "manual" },
  };
}
