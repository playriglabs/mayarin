/**
 * Payment link routes (#10).
 *
 * A link is a template: `POST /payment-links/:id/checkout` mints a fresh
 * Payment Intent every time, each with its own price lock and expiry. That is
 * what lets one printed QR on a counter serve every sale of the day.
 */

import { Hono } from "hono";
import type { Container } from "../container.ts";
import {
  checkoutLinkBodySchema,
  createPaymentLinkBodySchema,
  toIntentOptions,
  toPaymentLinkDto,
} from "../dto/catalog.ts";
import { toMerchantSnapshot, toPaymentIntentDto } from "../dto/payment-intent.ts";

export function paymentLinkRoutes(container: Container): Hono {
  const app = new Hono();
  const baseUrl = container.config.publicBaseUrl;

  app.post("/", async (c) => {
    const body = createPaymentLinkBodySchema.parse(await c.req.json());
    const idempotencyKey = c.req.header("Idempotency-Key");

    const link = await container.catalog.createLink({
      kind: body.kind,
      merchant: toMerchantSnapshot(body.merchant),
      ...(body.amount === undefined ? {} : { amount: body.amount }),
      ...(body.currency === undefined ? {} : { currency: body.currency }),
      ...(body.lines === undefined ? {} : { lines: body.lines }),
      ...(body.title === undefined ? {} : { title: body.title }),
      ...(body.merchantReference === undefined
        ? {}
        : { merchantReference: body.merchantReference }),
      ...(body.metadata === undefined ? {} : { metadata: body.metadata }),
      ...(body.expiresAt === undefined ? {} : { expiresAt: body.expiresAt }),
      ...(idempotencyKey === undefined ? {} : { idempotencyKey }),
    });

    return c.json({ paymentLink: toPaymentLinkDto(link, baseUrl, new Date()) }, 201);
  });

  app.get("/", async (c) => {
    const links = await container.catalog.listLinks({
      merchantId: c.req.query("merchantId") ?? "",
    });
    const now = new Date();
    return c.json({ paymentLinks: links.map((link) => toPaymentLinkDto(link, baseUrl, now)) });
  });

  app.get("/:id", async (c) => {
    const link = await container.catalog.getLink(c.req.param("id"));
    return c.json({ paymentLink: toPaymentLinkDto(link, baseUrl, new Date()) });
  });

  app.post("/:id/disable", async (c) => {
    const link = await container.catalog.disableLink(c.req.param("id"));
    return c.json({ paymentLink: toPaymentLinkDto(link, baseUrl, new Date()) });
  });

  app.post("/:id/checkout", async (c) => {
    // A buyer opening a link with an empty POST body is the common case for a
    // fixed link, so an absent body is not an error.
    const raw = await c.req.json().catch(() => ({}));
    const body = checkoutLinkBodySchema.parse(raw);
    const idempotencyKey = c.req.header("Idempotency-Key");
    const { amount, ...options } = body;

    const intent = await container.commerce.checkoutLink(c.req.param("id"), {
      ...toIntentOptions(options),
      ...(amount === undefined ? {} : { amount }),
      ...(idempotencyKey === undefined ? {} : { idempotencyKey }),
    });

    return c.json({ paymentIntent: toPaymentIntentDto(intent) }, 201);
  });

  return app;
}
