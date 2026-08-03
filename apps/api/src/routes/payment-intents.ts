/**
 * Payment intent routes.
 *
 * `POST /payment-intents` accepts either a QR payload or an explicit merchant
 * and amount; both produce the same immutable intent. `POST
 * /payment-intents/:id/confirm` hands the intent to the clearing engine.
 */

import { CHAIN_IDS } from "@mayarin/chain";
import {
  amountFromParsedQr,
  type CreatePaymentIntentCommand,
  merchantFromParsedQr,
  sourceFromParsedQr,
} from "@mayarin/payment-intent";
import { parseQr } from "@mayarin/qr-parser";
import { assetCodeSchema, decimalMoneySchema, ValidationError } from "@mayarin/shared";
import { Hono } from "hono";
import { z } from "zod";
import type { Container } from "../container.ts";
import { toPaymentDto, toPaymentIntentDto } from "../serialization.ts";

const merchantSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  city: z.string().min(1),
  countryCode: z.string().length(2),
  categoryCode: z.string().optional(),
});

const createBodySchema = z
  .object({
    /** Raw EMVCo/QRIS payload as scanned. */
    qr: z.string().min(1).optional(),
    merchant: merchantSchema.optional(),
    /** Human decimal amount, e.g. `{ "amount": "50000.00", "asset": "IDR" }`. */
    amount: decimalMoneySchema.optional(),
    /** The rail the payer intends to pay on, e.g. USDC on Base. */
    payment: z.object({ asset: assetCodeSchema, chain: z.enum(CHAIN_IDS) }).optional(),
    settlementAsset: assetCodeSchema.optional(),
    provider: z.string().min(1).optional(),
    metadata: z.record(z.string(), z.string()).optional(),
    ttlSeconds: z.number().int().positive().optional(),
  })
  .refine((body) => body.qr !== undefined || body.merchant !== undefined, {
    message: "Either a QR payload or merchant details must be supplied",
  });

export function paymentIntentRoutes(container: Container): Hono {
  const app = new Hono();

  app.post("/", async (c) => {
    const body = createBodySchema.parse(await c.req.json());
    const idempotencyKey = c.req.header("Idempotency-Key");

    const command: CreatePaymentIntentCommand = {
      ...resolveMerchantAndAmount(body),
      ...(body.payment === undefined ? {} : { payment: body.payment }),
      ...(body.settlementAsset === undefined ? {} : { settlementAsset: body.settlementAsset }),
      ...(body.provider === undefined ? {} : { provider: body.provider }),
      ...(body.metadata === undefined ? {} : { metadata: body.metadata }),
      ...(body.ttlSeconds === undefined ? {} : { ttlSeconds: body.ttlSeconds }),
      ...(idempotencyKey === undefined ? {} : { idempotencyKey }),
    };

    const intent = await container.intents.create(command);
    return c.json({ paymentIntent: toPaymentIntentDto(intent) }, 201);
  });

  /**
   * Confirms an intent and starts clearing.
   *
   * Safe to retry: confirming an intent that is already clearing returns its
   * current position rather than starting a second payment.
   */
  app.post("/:id/confirm", async (c) => {
    const intent = await container.intents.confirm(c.req.param("id"));
    const transaction = await container.engine.start(intent);
    const [current, events] = await Promise.all([
      container.intents.getById(intent.id),
      container.engine.history(transaction.id),
    ]);

    return c.json(toPaymentDto(current, transaction, events));
  });

  app.get("/:id", async (c) => {
    const intent = await container.intents.getById(c.req.param("id"));
    return c.json({ paymentIntent: toPaymentIntentDto(intent) });
  });

  return app;
}

type CreateBody = z.infer<typeof createBodySchema>;

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
