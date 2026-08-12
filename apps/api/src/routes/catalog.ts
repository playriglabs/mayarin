/**
 * Catalog routes (#10).
 *
 * Products and carts. Optional by construction: nothing under `/payment-intents`
 * calls anything here, so a merchant who never writes a product row still takes
 * every payment the API can take.
 *
 * Thin by design: validate input, call an application service, shape a response.
 */

import { NotFoundError } from "@mayarin/shared";
import { Hono } from "hono";
import type { Container } from "../container.ts";
import {
  checkoutCartBodySchema,
  createProductBodySchema,
  toIntentOptions,
  toProductDto,
  updateProductBodySchema,
} from "../dto/catalog.ts";
import { toMerchantSnapshot, toPaymentIntentDto } from "../dto/payment-intent.ts";
import {
  type ApiKeyAuthEnv,
  assertMerchant,
  requireApiKey,
  requirePublishableKey,
} from "../middleware/api-key.ts";

export function catalogRoutes(container: Container): Hono<ApiKeyAuthEnv> {
  const app = new Hono<ApiKeyAuthEnv>();
  // Reads take a publishable key (#113): a storefront lists its own catalog
  // from the browser. Writes stay secret-key + `catalog:manage`.
  const read = requirePublishableKey(container.verifyApiKey);
  const manage = requireApiKey(container.verifyApiKey, "catalog:manage");

  app.post("/products", manage, async (c) => {
    const body = createProductBodySchema.parse(await c.req.json());
    assertMerchant(c.get("scope"), body.merchantId);
    const product = await container.catalog.createProduct({
      merchantId: body.merchantId,
      sku: body.sku,
      name: body.name,
      prices: body.prices,
      ...(body.description === undefined ? {} : { description: body.description }),
      ...(body.metadata === undefined ? {} : { metadata: body.metadata }),
    });
    return c.json({ product: toProductDto(product) }, 201);
  });

  // A listing keyed by a guessable merchant id enumerates a whole catalog, so
  // it requires a key — and only for the merchant the key belongs to. An
  // omitted `merchantId` means the key's own merchant.
  app.get("/products", read, async (c) => {
    const scope = c.get("scope");
    const merchantId = c.req.query("merchantId") ?? scope.merchantId;
    assertMerchant(scope, merchantId);
    const active = c.req.query("active");
    const products = await container.catalog.listProducts({
      merchantId,
      ...(active === undefined ? {} : { active: active === "true" }),
    });
    return c.json({ products: products.map(toProductDto) });
  });

  app.get("/products/:id", async (c) => {
    const product = await container.catalog.getProduct(c.req.param("id"));
    return c.json({ product: toProductDto(product) });
  });

  app.patch("/products/:id", manage, async (c) => {
    const body = updateProductBodySchema.parse(await c.req.json());
    // A foreign product answers 404, not 403 — the id was not the caller's to
    // know, so the response does not say whether it exists.
    const existing = await container.catalog.getProduct(c.req.param("id"));
    if (existing.merchantId !== c.get("scope").merchantId) {
      throw new NotFoundError(`Product ${existing.id} not found`, { id: existing.id });
    }
    const product = await container.catalog.updateProduct(c.req.param("id"), {
      ...(body.name === undefined ? {} : { name: body.name }),
      ...(body.description === undefined ? {} : { description: body.description }),
      ...(body.prices === undefined ? {} : { prices: body.prices }),
      ...(body.active === undefined ? {} : { active: body.active }),
      ...(body.metadata === undefined ? {} : { metadata: body.metadata }),
    });
    return c.json({ product: toProductDto(product) });
  });

  return app;
}

/**
 * Cart checkout.
 *
 * A cart is not stored: lines come in, one Payment Intent goes out, and the
 * lines survive only as an immutable snapshot on that intent. There is
 * deliberately no `GET /carts/:id` to add later without saying so — a mutable
 * cart behind an existing intent could move the price after `PRICE_LOCKED`.
 */
export function cartRoutes(container: Container): Hono<ApiKeyAuthEnv> {
  const app = new Hono<ApiKeyAuthEnv>();

  // A cart checkout is a sale being rung up — by the POS with a secret key, or
  // by a storefront in the browser with a publishable one (#113). Either way
  // the key names the merchant, and minting commits nobody: the intent still
  // has to be confirmed and paid. The buyer-facing mints live under
  // `/payment-links/:id/checkout` and `/invoices/:id/checkout`, which stay open.
  app.post("/checkout", requirePublishableKey(container.verifyApiKey), async (c) => {
    const body = checkoutCartBodySchema.parse(await c.req.json());
    assertMerchant(c.get("scope"), body.merchant.id);
    const idempotencyKey = c.req.header("Idempotency-Key");

    const { merchant, currency, lines, ...options } = body;
    const intent = await container.commerce.checkoutCart({
      merchant: toMerchantSnapshot(merchant),
      currency,
      lines,
      ...toIntentOptions(options),
      ...(idempotencyKey === undefined ? {} : { idempotencyKey }),
    });

    return c.json({ paymentIntent: toPaymentIntentDto(intent) }, 201);
  });

  return app;
}
