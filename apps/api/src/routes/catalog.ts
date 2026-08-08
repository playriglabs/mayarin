/**
 * Catalog routes (#10).
 *
 * Products and carts. Optional by construction: nothing under `/payment-intents`
 * calls anything here, so a merchant who never writes a product row still takes
 * every payment the API can take.
 *
 * Thin by design: validate input, call an application service, shape a response.
 */

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

export function catalogRoutes(container: Container): Hono {
  const app = new Hono();

  app.post("/products", async (c) => {
    const body = createProductBodySchema.parse(await c.req.json());
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

  app.get("/products", async (c) => {
    const merchantId = c.req.query("merchantId") ?? "";
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

  app.patch("/products/:id", async (c) => {
    const body = updateProductBodySchema.parse(await c.req.json());
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
export function cartRoutes(container: Container): Hono {
  const app = new Hono();

  app.post("/checkout", async (c) => {
    const body = checkoutCartBodySchema.parse(await c.req.json());
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
