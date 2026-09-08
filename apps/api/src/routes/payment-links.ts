/**
 * Payment link routes (#10).
 *
 * A link is a template: `POST /payment-links/:id/checkout` mints a fresh
 * Payment Intent every time, each with its own price lock and expiry. That is
 * what lets one printed QR on a counter serve every sale of the day.
 */

import { NotFoundError } from "@mayarin/shared";
import { Hono } from "hono";
import type { Container } from "../container.ts";
import {
  checkoutLinkBodySchema,
  createPaymentLinkBodySchema,
  toIntentOptions,
  toPaymentLinkDto,
} from "../dto/catalog.ts";
import { toMerchantSnapshot, toPaymentIntentDto } from "../dto/payment-intent.ts";
import { type ApiKeyAuthEnv, assertMerchant, requireApiKey } from "../middleware/api-key.ts";
import { assertRailOffered, payerRails } from "../rails.ts";

export function paymentLinkRoutes(container: Container): Hono<ApiKeyAuthEnv> {
  const app = new Hono<ApiKeyAuthEnv>();
  const baseUrl = container.config.checkoutBaseUrl;
  const auth = requireApiKey(container.verifyApiKey);
  const manage = requireApiKey(container.verifyApiKey, "catalog:manage");

  app.post("/", manage, async (c) => {
    const body = createPaymentLinkBodySchema.parse(await c.req.json());
    assertMerchant(c.get("scope"), body.merchant.id);
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
      ...(body.listed === undefined ? {} : { listed: body.listed }),
      ...(idempotencyKey === undefined ? {} : { idempotencyKey }),
    });

    return c.json({ paymentLink: toPaymentLinkDto(link, baseUrl, new Date()) }, 201);
  });

  // Keyed by a guessable merchant id, so the listing requires a key — and only
  // for the key's own merchant. An omitted `merchantId` means that merchant.
  app.get("/", auth, async (c) => {
    const scope = c.get("scope");
    const merchantId = c.req.query("merchantId") ?? scope.merchantId;
    assertMerchant(scope, merchantId);
    const links = await container.catalog.listLinks({ merchantId });
    const now = new Date();
    return c.json({ paymentLinks: links.map((link) => toPaymentLinkDto(link, baseUrl, now)) });
  });

  app.get("/:id", async (c) => {
    const link = await container.catalog.getLink(c.req.param("id"));
    return c.json({ paymentLink: toPaymentLinkDto(link, baseUrl, new Date()) });
  });

  /**
   * The rails this link can be paid on (#244).
   *
   * Public, like `GET /:id`: it describes a link anyone holding the URL may
   * pay, and says nothing about the merchant beyond what the checkout page
   * built from the same list already shows.
   *
   * The same list the hosted checkout inlines — one implementation serving the
   * page, the embed and the SDK, so an embed cannot offer a rail the hosted
   * page would refuse, or an order it would not show (#260).
   */
  app.get("/:id/rails", async (c) => {
    const link = await container.catalog.getLink(c.req.param("id"));
    const report = await container.rails.describe(link.merchant.id);
    return c.json({
      rails: await payerRails(container, report),
      settlementAsset: report.settlementAsset,
    });
  });

  app.post("/:id/disable", manage, async (c) => {
    // A foreign link answers 404 before the disable runs — the id was not the
    // caller's to know, so the response does not say whether it exists.
    const existing = await container.catalog.getLink(c.req.param("id"));
    if (existing.merchant.id !== c.get("scope").merchantId) {
      throw new NotFoundError(`Payment link ${existing.id} not found`, { id: existing.id });
    }
    const link = await container.catalog.disableLink(c.req.param("id"));
    return c.json({ paymentLink: toPaymentLinkDto(link, baseUrl, new Date()) });
  });

  /**
   * The two halves of the discovery opt-in (#273): a listed link appears in
   * the public payable index, an unlisted one stops appearing. `manage`
   * scope, like `/disable` — being findable is a decision about the link,
   * and a foreign link answers 404 for the same reason.
   */
  app.post("/:id/list", manage, async (c) => {
    const existing = await container.catalog.getLink(c.req.param("id"));
    if (existing.merchant.id !== c.get("scope").merchantId) {
      throw new NotFoundError(`Payment link ${existing.id} not found`, { id: existing.id });
    }
    const link = await container.catalog.listLink(c.req.param("id"));
    return c.json({ paymentLink: toPaymentLinkDto(link, baseUrl, new Date()) });
  });

  app.post("/:id/unlist", manage, async (c) => {
    const existing = await container.catalog.getLink(c.req.param("id"));
    if (existing.merchant.id !== c.get("scope").merchantId) {
      throw new NotFoundError(`Payment link ${existing.id} not found`, { id: existing.id });
    }
    const link = await container.catalog.unlistLink(c.req.param("id"));
    return c.json({ paymentLink: toPaymentLinkDto(link, baseUrl, new Date()) });
  });

  app.post("/:id/checkout", async (c) => {
    // A buyer opening a link with an empty POST body is the common case for a
    // fixed link, so an absent body is not an error.
    const raw = await c.req.json().catch(() => ({}));
    const body = checkoutLinkBodySchema.parse(raw);
    const idempotencyKey = c.req.header("Idempotency-Key");
    const { amount, ...options } = body;

    // Refused here rather than at price-lock: by then the payer has chosen, a
    // deposit address has been issued, and the message names a merchant
    // setting they have never seen.
    const link = await container.catalog.getLink(c.req.param("id"));
    await assertRailOffered(container, link.merchant.id, options.payment);

    const intent = await container.commerce.checkoutLink(c.req.param("id"), {
      ...toIntentOptions(options),
      ...(amount === undefined ? {} : { amount }),
      ...(idempotencyKey === undefined ? {} : { idempotencyKey }),
    });

    return c.json({ paymentIntent: toPaymentIntentDto(intent) }, 201);
  });

  return app;
}
